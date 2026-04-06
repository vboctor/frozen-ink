import { beforeEach, describe, expect, it } from "bun:test";
import { MantisBTCrawler } from "../crawler";
import type { MantisBTIssue } from "../types";

function sampleIssue(overrides: Partial<MantisBTIssue> = {}): MantisBTIssue {
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
    files: [],
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

describe("MantisBTCrawler", () => {
  let crawler: MantisBTCrawler;

  beforeEach(async () => {
    crawler = new MantisBTCrawler();
    await crawler.initialize(
      { baseUrl: "https://mantis.example.com" },
      { token: "test-token" },
    );
  });

  it("stores updatedSince cursor and filters incremental updates", async () => {
    let call = 0;
    crawler.setFetch(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          issues: [sampleIssue({ id: 1, updated_at: "2024-01-02T00:00:00Z" })],
        });
      }
      return jsonResponse({
        issues: [
          sampleIssue({ id: 2, updated_at: "2024-01-03T00:00:00Z" }),
          sampleIssue({ id: 1, updated_at: "2024-01-02T00:00:00Z" }),
          sampleIssue({ id: 3, updated_at: "2024-01-01T00:00:00Z" }),
        ],
      });
    });

    const first = await crawler.sync(null);
    expect(first.entities).toHaveLength(1);
    expect(first.nextCursor).toEqual({ updatedSince: "2024-01-02T00:00:00Z" });

    const second = await crawler.sync(first.nextCursor);
    expect(second.entities.map((e) => e.externalId)).toEqual(["issue:2", "issue:1"]);
    expect(second.nextCursor).toEqual({ updatedSince: "2024-01-03T00:00:00Z" });
  });

  it("includes entities with updated_at equal to updatedSince", async () => {
    crawler.setFetch(async () =>
      jsonResponse({
        issues: [sampleIssue({ id: 9, updated_at: "2024-02-01T12:00:00Z" })],
      }),
    );

    const result = await crawler.sync({ updatedSince: "2024-02-01T12:00:00Z" });
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

  it("stops paginating when the API repeats the same page", async () => {
    const repeatedPage = Array.from({ length: 50 }, (_, i) =>
      sampleIssue({
        id: i + 1,
        updated_at: "2024-02-01T00:00:00Z",
      }),
    );

    crawler.setFetch(async () => jsonResponse({ issues: repeatedPage }));

    const first = await crawler.sync({ updatedSince: "2024-01-01T00:00:00Z" });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const second = await crawler.sync(first.nextCursor);
    expect(second.hasMore).toBe(false);
    expect(second.entities).toHaveLength(0);
    expect(second.nextCursor).toEqual({ updatedSince: "2024-02-01T00:00:00Z" });
  });

  it("advances to page 2 with in-run cursor state", async () => {
    const requestedUrls: string[] = [];
    const repeatedPage = Array.from({ length: 50 }, (_, i) =>
      sampleIssue({
        id: i + 1,
        updated_at: "2024-03-01T00:00:00Z",
      }),
    );

    crawler.setFetch(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);
      return jsonResponse({ issues: repeatedPage });
    });

    const first = await crawler.sync(null);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    await crawler.sync(first.nextCursor);
    expect(requestedUrls[0]).toContain("page=1");
    expect(requestedUrls[1]).toContain("page=2");
  });
});
