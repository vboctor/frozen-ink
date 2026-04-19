/**
 * Adaptive budget-aware rate limiter for the GitHub REST API.
 *
 * Reads `X-RateLimit-*` headers after each response and paces subsequent
 * requests so the remaining budget covers the time until reset. Handles
 * 429, secondary rate limits (403 + retry-after), and transient 5xx with
 * exponential backoff. Waits longer than MAX_INLINE_WAIT_MS are surfaced as
 * `RateLimitPauseError` so the caller can persist its cursor and resume on
 * the next sync tick (important inside Cloudflare Workers, which cap CPU/
 * request wall time).
 *
 * State is keyed by token so multiple collections sharing a PAT share a
 * budget.
 */

const MAX_INLINE_WAIT_MS = 30_000;
const MAX_PRIMARY_RETRIES = 5;
const MAX_5XX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 4;
const LOW_BUDGET_RATIO = 0.1;
const HIGH_BUDGET_RATIO = 0.5;
const SAFETY_MARGIN = 0.9;

export class RateLimitPauseError extends Error {
  readonly waitSeconds: number;
  constructor(waitSeconds: number, message?: string) {
    super(message ?? `GitHub rate limit requires pause of ${waitSeconds}s`);
    this.name = "RateLimitPauseError";
    this.waitSeconds = waitSeconds;
  }
}

interface TokenState {
  concurrencyCap: number;
  inFlight: number;
  waiters: Array<() => void>;
  lastRequestAt: number;
  paceMs: number;
  remaining?: number;
  limit?: number;
  resetAtMs?: number;
  secondaryHit: boolean;
  debug: boolean;
}

const stateByToken = new Map<string, TokenState>();

function getState(token: string, debug: boolean, initialCap: number): TokenState {
  let s = stateByToken.get(token);
  if (!s) {
    s = {
      concurrencyCap: initialCap,
      inFlight: 0,
      waiters: [],
      lastRequestAt: 0,
      paceMs: 0,
      secondaryHit: false,
      debug,
    };
    stateByToken.set(token, s);
  } else {
    s.debug = s.debug || debug;
  }
  return s;
}

function acquire(state: TokenState): Promise<void> {
  if (state.inFlight < state.concurrencyCap) {
    state.inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    state.waiters.push(() => {
      state.inFlight++;
      resolve();
    });
  });
}

function release(state: TokenState): void {
  state.inFlight--;
  const next = state.waiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number): number {
  return Math.floor(ms * (0.75 + Math.random() * 0.5));
}

function recomputePace(state: TokenState): void {
  if (
    state.remaining === undefined ||
    state.resetAtMs === undefined ||
    state.limit === undefined
  ) {
    state.paceMs = 0;
    return;
  }
  const msUntilReset = Math.max(0, state.resetAtMs - Date.now());
  const usable = Math.max(1, Math.floor(state.remaining * SAFETY_MARGIN));
  // Full speed while the budget is abundant; start pacing only once we've
  // spent half of it so small repos on fresh tokens never pay latency.
  let pace =
    state.remaining >= state.limit * HIGH_BUDGET_RATIO
      ? 0
      : Math.ceil(msUntilReset / usable);

  if (state.remaining < state.limit * LOW_BUDGET_RATIO) {
    state.concurrencyCap = 1;
  }
  if (state.secondaryHit) {
    pace = Math.max(pace, 500) * 2;
    state.concurrencyCap = 1;
  }
  state.paceMs = pace;
}

function readHeaders(state: TokenState, res: Response): void {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  const limit = res.headers.get("x-ratelimit-limit");
  if (remaining !== null) state.remaining = Number(remaining);
  if (reset !== null) state.resetAtMs = Number(reset) * 1000;
  if (limit !== null) state.limit = Number(limit);
  recomputePace(state);
  if (state.debug) {
    const resetIn = state.resetAtMs ? state.resetAtMs - Date.now() : undefined;
    // eslint-disable-next-line no-console
    console.log(
      `[rate-limit] remaining=${state.remaining ?? "?"} resetMs=${resetIn ?? "?"} pace=${state.paceMs}ms cap=${state.concurrencyCap}`,
    );
  }
}

function isRateLimitResponse(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  if (res.headers.get("retry-after")) return true;
  if (res.headers.get("x-ratelimit-remaining") === "0") return true;
  return false;
}

async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore
  }
}

export interface RateLimitedFetchOptions {
  debug?: boolean;
  maxConcurrency?: number;
  /** Override wait cap for pause error — tests use this to exercise the path cheaply. */
  maxInlineWaitMs?: number;
}

export function createRateLimitedFetch(
  baseFetch: typeof fetch,
  token: string,
  options: RateLimitedFetchOptions = {},
): typeof fetch {
  const debug = options.debug === true;
  const cap = options.maxConcurrency ?? DEFAULT_CONCURRENCY;
  const maxInlineWait = options.maxInlineWaitMs ?? MAX_INLINE_WAIT_MS;
  const state = getState(token, debug, cap);

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    await acquire(state);
    try {
      let attempt = 0;
      let fiveXxAttempts = 0;
      while (true) {
        if (state.paceMs > 0) {
          const elapsed = Date.now() - state.lastRequestAt;
          const waitMs = state.paceMs - elapsed;
          if (waitMs > 0) {
            if (waitMs >= maxInlineWait) {
              throw new RateLimitPauseError(Math.ceil(waitMs / 1000));
            }
            await sleep(waitMs);
          }
        }

        state.lastRequestAt = Date.now();
        const res = await baseFetch(input, init);
        readHeaders(state, res);

        if (isRateLimitResponse(res)) {
          const retryAfter = res.headers.get("retry-after");
          let waitMs: number;
          if (retryAfter) {
            waitMs = Number(retryAfter) * 1000;
          } else if (state.resetAtMs) {
            waitMs = Math.max(0, state.resetAtMs - Date.now());
          } else {
            waitMs = Math.min(16_000, Math.pow(2, attempt) * 1000);
          }

          // 403 with budget left suggests secondary/abuse throttling — halve pace
          // for the rest of the run and clamp concurrency to 1.
          if (
            res.status === 403 &&
            state.remaining !== undefined &&
            state.remaining > 0
          ) {
            state.secondaryHit = true;
            state.concurrencyCap = 1;
            recomputePace(state);
          }

          await drain(res);

          if (waitMs >= maxInlineWait) {
            throw new RateLimitPauseError(Math.ceil(waitMs / 1000));
          }
          if (attempt >= MAX_PRIMARY_RETRIES) {
            // Hand back the last rate-limited response; caller will surface as error.
            return res;
          }
          await sleep(jitter(waitMs));
          attempt++;
          continue;
        }

        if (res.status >= 500 && res.status < 600) {
          if (fiveXxAttempts >= MAX_5XX_RETRIES) return res;
          await drain(res);
          await sleep(jitter(Math.pow(2, fiveXxAttempts) * 500));
          fiveXxAttempts++;
          continue;
        }

        return res;
      }
    } finally {
      release(state);
    }
  };

  return wrapped as unknown as typeof fetch;
}

/** Test-only: wipe per-token state so tests don't leak budgets into each other. */
export function __resetRateLimiter(): void {
  stateByToken.clear();
}
