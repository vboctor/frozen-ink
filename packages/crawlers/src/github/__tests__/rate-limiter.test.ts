import { describe, it, expect, beforeEach } from "bun:test";
import {
  createRateLimitedFetch,
  RateLimitPauseError,
  __resetRateLimiter,
} from "../rate-limiter";

function respond(
  status: number,
  headers: Record<string, string> = {},
  body: string = "",
): Response {
  return new Response(body, { status, headers });
}

function futureUnix(seconds: number): string {
  return String(Math.floor(Date.now() / 1000) + seconds);
}

beforeEach(() => {
  __resetRateLimiter();
});

describe("rate-limiter", () => {
  it("passes through with no pacing when budget is plentiful", async () => {
    let calls = 0;
    const baseFetch = (async () => {
      calls++;
      return respond(200, {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4990",
        "x-ratelimit-reset": futureUnix(3600),
      });
    }) as unknown as typeof fetch;

    const f = createRateLimitedFetch(baseFetch, "tok-full");
    const t0 = Date.now();
    await f("https://api.github.com/x");
    await f("https://api.github.com/x");
    const elapsed = Date.now() - t0;
    expect(calls).toBe(2);
    // With 4990/5000 remaining for 3600s, pace is sub-second — definitely < 100ms.
    expect(elapsed).toBeLessThan(200);
  });

  it("paces requests when budget is low", async () => {
    // 10 remaining over 2s → ~222ms pace after safety margin (10*0.9 usable).
    const resetSec = futureUnix(2);
    const baseFetch = (async () =>
      respond(200, {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "10",
        "x-ratelimit-reset": resetSec,
      })) as unknown as typeof fetch;

    const f = createRateLimitedFetch(baseFetch, "tok-low");
    await f("https://api.github.com/x"); // primes pace from response headers
    const t0 = Date.now();
    await f("https://api.github.com/x");
    const elapsed = Date.now() - t0;
    // Pace is ~222ms (2s / 9 usable). elapsed-since-last eats some of it, so
    // the floor we can safely assert is ~100ms.
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it("retries after 429 with Retry-After", async () => {
    let calls = 0;
    const baseFetch = (async () => {
      calls++;
      if (calls === 1) {
        return respond(429, { "retry-after": "1" });
      }
      return respond(200, {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": futureUnix(3600),
      });
    }) as unknown as typeof fetch;

    const f = createRateLimitedFetch(baseFetch, "tok-429");
    const t0 = Date.now();
    const res = await f("https://api.github.com/x");
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(500); // at least ~0.75s (jitter of 1s)
  });

  it("throws RateLimitPauseError when wait exceeds inline cap", async () => {
    const baseFetch = (async () =>
      respond(403, {
        "retry-after": "120", // 2 minutes
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": futureUnix(120),
      })) as unknown as typeof fetch;

    const f = createRateLimitedFetch(baseFetch, "tok-pause", {
      maxInlineWaitMs: 5000,
    });

    await expect(f("https://api.github.com/x")).rejects.toBeInstanceOf(
      RateLimitPauseError,
    );
  });

  it("downshifts on secondary rate limit (403 with budget remaining)", async () => {
    let calls = 0;
    const baseFetch = (async () => {
      calls++;
      if (calls === 1) {
        return respond(403, {
          "retry-after": "1",
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4000", // budget left → secondary
          "x-ratelimit-reset": futureUnix(3600),
        });
      }
      return respond(200, {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "3999",
        "x-ratelimit-reset": futureUnix(3600),
      });
    }) as unknown as typeof fetch;

    const f = createRateLimitedFetch(baseFetch, "tok-secondary");
    const res = await f("https://api.github.com/x");
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    // Secondary bit is set; subsequent request should see doubled pace (≥1s floor).
    const t0 = Date.now();
    await f("https://api.github.com/x");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
  });

  it("retries on 5xx with exponential backoff", async () => {
    let calls = 0;
    const baseFetch = (async () => {
      calls++;
      if (calls < 3) return respond(502);
      return respond(200, {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": futureUnix(3600),
      });
    }) as unknown as typeof fetch;

    const f = createRateLimitedFetch(baseFetch, "tok-5xx");
    const res = await f("https://api.github.com/x");
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });
});
