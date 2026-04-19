import { beforeEach, describe, expect, it } from "bun:test";
import { MantisHubCrawler } from "../crawler";
import type { MantisHubIssue } from "../types";

function sampleIssue(overrides: Partial<MantisHubIssue> = {}): MantisHubIssue {
  return {
    id: 1,
    summary: "Sample issue",
    description: "Issue description",
    sticky: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    project: { id: 10, name: "Sample Project" },
    status: { id: 10, name: "new", label: "new" },
    resolution: { id: 10, name: "open", label: "open" },
    priority: { id: 30, name: "normal", label: "normal" },
    severity: { id: 50, name: "minor", label: "minor" },
    attachments: [],
    notes: [],
    relationships: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Match /api/rest/issues/{id} (single issue fetch, no query string). */
const SINGLE_ISSUE_RE = /\/api\/rest\/issues\/(\d+)$/;

/**
 * Wrap a list-level fetch mock so that individual issue fetches
 * (GET /api/rest/issues/{id}) return the matching issue from the
 * most recently returned list page.
 */
function routingFetch(
  listFn: (url: string) => Promise<Response>,
): (input: string | URL | Request) => Promise<Response> {
  let lastPage: MantisHubIssue[] = [];
  return async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const singleMatch = url.match(SINGLE_ISSUE_RE);
    if (singleMatch) {
      const id = parseInt(singleMatch[1], 10);
      const issue = lastPage.find((i) => i.id === id) ?? sampleIssue({ id });
      return jsonResponse({ issues: [issue] });
    }
    const res = await listFn(url);
    // Clone and peek at the body to track the last page.
    // Skip lightweight scan responses (select=id,updated_at) — they lack full issue data.
    if (!url.includes("select=")) {
      const cloned = res.clone();
      try {
        const data = (await cloned.json()) as { issues?: MantisHubIssue[] };
        lastPage = data.issues ?? [];
      } catch { /* ignore */ }
    }
    return res;
  };
}

describe("MantisHubCrawler", () => {
  let crawler: MantisHubCrawler;

  beforeEach(async () => {
    crawler = new MantisHubCrawler();
    await crawler.initialize(
      { baseUrl: "https://mantis.example.com" },
      { token: "test-token" },
    );
  });

  it("stores updatedSince cursor and filters incremental updates", async () => {
    let call = 0;
    crawler.setFetch(routingFetch(async (url: string) => {
      call += 1;
      // Call 1: full sync — page 1 issues list
      if (call === 1) {
        return jsonResponse({
          issues: [sampleIssue({ id: 1, updated_at: "2024-01-02T00:00:00Z" })],
        });
      }
      // Call 3+: incremental scan (select=id,updated_at) and individual fetches
      if (url.includes("select=")) {
        return jsonResponse({
          issues: [
            { id: 2, updated_at: "2024-01-03T00:00:00Z" },
            { id: 1, updated_at: "2024-01-02T00:00:00Z" },
            { id: 3, updated_at: "2024-01-01T00:00:00Z" },
          ],
        });
      }
      // Individual issue fetches and full list fallback
      return jsonResponse({
        issues: [
          sampleIssue({ id: 2, updated_at: "2024-01-03T00:00:00Z" }),
          sampleIssue({ id: 1, updated_at: "2024-01-02T00:00:00Z" }),
          sampleIssue({ id: 3, updated_at: "2024-01-01T00:00:00Z" }),
        ],
      });
    }));

    // Issues phase: syncs 1 issue, then transitions to users phase.
    const first = await crawler.sync(null);
    expect(first.entities).toHaveLength(1);
    expect(first.entities[0].externalId).toBe("issue:1");
    expect((first.nextCursor as any).phase).toBe("users");
    expect((first.nextCursor as any).updatedSince).toBe("2024-01-02T00:00:00Z");

    // Users+projects phase: emits project entity, no users (sample issue has no reporter/handler).
    const usersPhase = await crawler.sync(first.nextCursor);
    expect(usersPhase.hasMore).toBe(false);
    expect(usersPhase.nextCursor).toEqual({ updatedSince: "2024-01-02T00:00:00Z" });

    // Incremental scan phase: lightweight scan identifies issues 2 and 1 as updated.
    const scan = await crawler.sync(usersPhase.nextCursor);
    expect(scan.entities).toHaveLength(0); // scan phase emits no entities
    expect(scan.hasMore).toBe(true);
    expect((scan.nextCursor as any)._incrementalIds).toEqual([2, 1]);

    // Incremental fetch phase: fetches full data for identified issues.
    const fetch = await crawler.sync(scan.nextCursor);
    expect(fetch.entities.filter((e) => e.entityType === "issue").map((e) => e.externalId))
      .toEqual(["issue:2", "issue:1"]);
    expect((fetch.nextCursor as any).phase).toBe("users");
    expect((fetch.nextCursor as any).updatedSince).toBe("2024-01-03T00:00:00Z");

    // Incremental users+projects phase.
    const incrUsers = await crawler.sync(fetch.nextCursor);
    expect(incrUsers.hasMore).toBe(false);
    expect(incrUsers.nextCursor).toEqual({ updatedSince: "2024-01-03T00:00:00Z" });
  });

  it("includes entities with updated_at equal to updatedSince", async () => {
    crawler.setFetch(routingFetch(async (url: string) => {
      if (url.includes("select=")) {
        return jsonResponse({
          issues: [{ id: 9, updated_at: "2024-02-01T12:00:00Z" }],
        });
      }
      return jsonResponse({
        issues: [sampleIssue({ id: 9, updated_at: "2024-02-01T12:00:00Z" })],
      });
    }));

    // Scan phase
    const scan = await crawler.sync({ updatedSince: "2024-02-01T12:00:00Z" });
    expect((scan.nextCursor as any)._incrementalIds).toEqual([9]);

    // Fetch phase
    const result = await crawler.sync(scan.nextCursor);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].externalId).toBe("issue:9");
  });

  it("ignores legacy page-only cursor and restarts from page 1", async () => {
    let requestedUrl = "";
    crawler.setFetch(async (input: string | URL | Request) => {
      requestedUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse({ issues: [] });
    });

    await crawler.sync({ page: 99, fetched: 500 });
    expect(requestedUrl).toContain("page=1");
  });

  it("skips incremental scan when no issues match updatedSince", async () => {
    crawler.setFetch(routingFetch(async (url: string) => {
      if (url.includes("select=")) {
        // All issues are older than updatedSince
        return jsonResponse({
          issues: [
            { id: 1, updated_at: "2024-01-01T00:00:00Z" },
            { id: 2, updated_at: "2024-01-01T00:00:00Z" },
          ],
        });
      }
      return jsonResponse({ issues: [] });
    }));

    // Scan finds no matching issues — transitions directly to users phase
    const result = await crawler.sync({ updatedSince: "2024-06-01T00:00:00Z" });
    expect(result.entities.filter((e) => e.entityType === "issue")).toHaveLength(0);
    expect((result.nextCursor as any).phase).toBe("users");
  });

  it("stops scanning once a full page has zero matches (last_updated DESC order)", async () => {
    const pageRequests: number[] = [];
    // Build 3 pages: page 1 & 2 have matches, page 3 has zero matches (all older)
    // The scan should stop after page 3 without fetching page 4.
    const matchingPage = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 - i,
      updated_at: "2024-06-01T00:00:00Z",
    }));
    const noMatchPage = Array.from({ length: 100 }, (_, i) => ({
      id: 500 - i,
      updated_at: "2023-01-01T00:00:00Z",
    }));

    crawler.setFetch(routingFetch(async (url: string) => {
      const pageMatch = url.match(/[?&]page=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1], 10) : 0;
      pageRequests.push(page);
      if (page <= 2) return jsonResponse({ issues: matchingPage });
      if (page === 3) return jsonResponse({ issues: noMatchPage });
      return jsonResponse({ issues: [] }); // would never reach
    }));

    await crawler.sync({ updatedSince: "2024-01-01T00:00:00Z" });
    expect(pageRequests.filter((p) => p > 0)).toEqual([1, 2, 3]);
  });

  it("uses select=id,updated_at with page_size=100 for incremental scan", async () => {
    const urls: string[] = [];
    crawler.setFetch(routingFetch(async (url: string) => {
      urls.push(url);
      return jsonResponse({ issues: [] });
    }));

    await crawler.sync({ updatedSince: "2024-01-01T00:00:00Z" });
    const scanUrl = urls.find((u) => u.includes("select="));
    expect(scanUrl).toBeTruthy();
    expect(scanUrl).toContain("select=id,updated_at");
    expect(scanUrl).toContain("page_size=100");
  });

  it("advances to page 2 with in-run cursor state", async () => {
    const listUrls: string[] = [];
    const repeatedPage = Array.from({ length: 25 }, (_, i) =>
      sampleIssue({
        id: i + 1,
        updated_at: "2024-03-01T00:00:00Z",
      }),
    );

    crawler.setFetch(routingFetch(async (url: string) => {
      listUrls.push(url);
      return jsonResponse({ issues: repeatedPage });
    }));

    const first = await crawler.sync(null);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    await crawler.sync(first.nextCursor);
    expect(listUrls[0]).toContain("page=1");
    expect(listUrls[1]).toContain("page=2");
  });
});
