import { describe, expect, it } from "bun:test";
import { MantisHubTheme } from "../theme";
import type { ThemeRenderContext } from "@frozenink/core/theme";

const theme = new MantisHubTheme();

/** Minimal lookup covering issues 100 and 200. */
const lookup = (externalId: string): string | undefined => {
  const map: Record<string, string> = {
    "issue:100": "issues/00100-linked-issue",
    "issue:200": "issues/00200-another-issue",
    "user:alice": "users/alice",
  };
  return map[externalId];
};

function makeIssueContext(overrides: Partial<ThemeRenderContext["entity"]["data"]> = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: "issue:42",
      entityType: "issue",
      title: "00042: Sample Issue",
      data: {
        id: 42,
        summary: "Sample issue summary",
        description: "Issue description",
        stepsToReproduce: "",
        additionalInformation: "",
        project: { id: 1, name: "TestProject" },
        category: { id: 1, name: "general" },
        reporter: { id: 1, name: "alice" },
        handler: null,
        status: { id: 10, name: "new", label: "New", color: "#aaa" },
        resolution: { id: 10, name: "open", label: "Open" },
        priority: { id: 30, name: "normal", label: "Normal" },
        severity: { id: 50, name: "minor", label: "Minor" },
        reproducibility: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        sticky: false,
        attachments: [],
        notes: [],
        relationships: [],
        customFields: [],
        ...overrides,
      },
      tags: [],
    },
    collectionName: "test",
    crawlerType: "mantishub",
    lookupEntityPath: lookup,
  };
}

describe("MantisHubTheme HTML issue-ref linkification", () => {
  it("linkifies #N in additional information", () => {
    const ctx = makeIssueContext({ additionalInformation: "Regression introduced by #100" });
    const html = theme.renderHtml!(ctx);
    expect(html).toContain('class="mt-issue-ref"');
    expect(html).toContain("#wikilink/issues%2F00100-linked-issue");
    expect(html).toContain("#00100");
  });

  it("does not linkify #N without a matching issue in lookup", () => {
    const ctx = makeIssueContext({ additionalInformation: "See #9999 for context" });
    const html = theme.renderHtml!(ctx);
    // #9999 has no entry in lookup → plain text
    expect(html).toContain("#9999");
    expect(html).not.toContain("#wikilink/issues%2F09999");
  });

  it("linkifies #N in description", () => {
    const ctx = makeIssueContext({ description: "Relates to #100 and #200" });
    const html = theme.renderHtml!(ctx);
    expect(html).toContain("#wikilink/issues%2F00100-linked-issue");
    expect(html).toContain("#wikilink/issues%2F00200-another-issue");
  });

  it("linkifies #N in steps to reproduce", () => {
    const ctx = makeIssueContext({ stepsToReproduce: "As described in #100, follow these steps." });
    const html = theme.renderHtml!(ctx);
    expect(html).toContain("#wikilink/issues%2F00100-linked-issue");
  });

  it("linkifies #N in summary title", () => {
    const ctx = makeIssueContext({ summary: "Regression from #100 fix" });
    const html = theme.renderHtml!(ctx);
    expect(html).toContain("mt-title");
    expect(html).toContain("#wikilink/issues%2F00100-linked-issue");
  });

  it("linkifies #N in text custom fields", () => {
    const ctx = makeIssueContext({
      customFields: [
        { id: 1, name: "Root Cause", value: "Introduced by #100 refactor" },
        { id: 2, name: "Fix Version", value: "2.5.0" },
      ],
    });
    const html = theme.renderHtml!(ctx);
    expect(html).toContain("Root Cause");
    expect(html).toContain("#wikilink/issues%2F00100-linked-issue");
    // Plain value with no issue ref renders as-is
    expect(html).toContain("2.5.0");
  });

  it("skips empty custom field values", () => {
    const ctx = makeIssueContext({
      customFields: [{ id: 1, name: "Empty Field", value: "" }],
    });
    const html = theme.renderHtml!(ctx);
    expect(html).not.toContain("Empty Field");
  });
});

describe("MantisHubTheme HTML page rendering", () => {
  function makePageContext(content: string): ThemeRenderContext {
    return {
      entity: {
        externalId: "page:1:getting-started",
        entityType: "page",
        title: "Getting Started",
        data: {
          id: 99,
          name: "getting-started",
          title: "Getting Started",
          project: { id: 1, name: "TestProject" },
          content,
          files: [],
        },
      },
      collectionName: "test",
      crawlerType: "mantishub",
      lookupEntityPath: lookup,
    };
  }

  it("renders page content as markdown (headings)", () => {
    const html = theme.renderHtml!(makePageContext("## Section\n\nParagraph text."));
    expect(html).toContain("<h2");
    expect(html).toContain("Section");
  });

  it("renders page content as markdown (bold)", () => {
    const html = theme.renderHtml!(makePageContext("This is **important**."));
    expect(html).toContain("<strong>important</strong>");
  });

  it("linkifies #N issue references in page content", () => {
    const html = theme.renderHtml!(makePageContext("See #100 for details."));
    expect(html).toContain('class="mt-issue-ref"');
    expect(html).toContain("#wikilink/issues%2F00100-linked-issue");
  });

  it("renders unresolved [[wiki-link]] as a missing-page indicator (not literal)", () => {
    const html = theme.renderHtml!(makePageContext("See [[nonexistent-page]] for details."));
    expect(html).toContain("mt-page-missing");
    expect(html).toContain("nonexistent-page");
    expect(html).not.toContain("[[nonexistent-page]]");
  });

});

describe("MantisHubTheme getFilePath", () => {
  it("places issues under <project-slug>/issues/", () => {
    const ctx = makeIssueContext();
    expect(theme.getFilePath(ctx)).toBe("testproject/issues/00042-sample-issue-summary.md");
  });

  it("places pages under <project-slug>/pages/", () => {
    const ctx: ThemeRenderContext = {
      entity: {
        externalId: "page:1:getting-started",
        entityType: "page",
        title: "Getting Started",
        data: {
          id: 99,
          name: "getting-started",
          title: "Getting Started",
          project: { id: 1, name: "TestProject" },
        },
      },
      collectionName: "test",
      crawlerType: "mantishub",
    };
    expect(theme.getFilePath(ctx)).toBe("testproject/pages/getting-started.md");
  });

  it("places the project entity inside its own folder as <slug>/<slug>.md", () => {
    const ctx: ThemeRenderContext = {
      entity: {
        externalId: "project:1",
        entityType: "project",
        title: "TestProject",
        data: { id: 1, name: "TestProject" },
      },
      collectionName: "test",
      crawlerType: "mantishub",
    };
    expect(theme.getFilePath(ctx)).toBe("testproject/testproject.md");
  });

  it("places users at the top level under users/", () => {
    const ctx: ThemeRenderContext = {
      entity: {
        externalId: "user:alice",
        entityType: "user",
        title: "Alice",
        data: { name: "alice" },
      },
      collectionName: "test",
      crawlerType: "mantishub",
    };
    expect(theme.getFilePath(ctx)).toBe("users/alice.md");
  });
});

describe("MantisHubTheme folderConfigs", () => {
  it("marks issues/pages/users with showCount: true", () => {
    const configs = theme.folderConfigs!();
    expect(configs.issues.showCount).toBe(true);
    expect(configs.issues.sort).toBe("DESC");
    expect(configs.pages.showCount).toBe(true);
    expect(configs.users.showCount).toBe(true);
  });

  it("keeps assets folder hidden and without a count", () => {
    const configs = theme.folderConfigs!();
    expect(configs.assets.visible).toBe(false);
    expect(configs.assets.showCount).toBeUndefined();
  });
});

describe("MantisHubTheme markdown issue-ref linkification", () => {
  it("linkifies #N in additional information (markdown)", () => {
    const ctx = makeIssueContext({ additionalInformation: "Regression from #100" });
    const md = theme.render(ctx);
    expect(md).toContain("[[issues/00100-linked-issue|#00100]]");
  });

  it("linkifies #N in text custom fields (markdown)", () => {
    const ctx = makeIssueContext({
      customFields: [{ id: 1, name: "Root Cause", value: "See #100 for details" }],
    });
    const md = theme.render(ctx);
    expect(md).toContain("### Root Cause");
    expect(md).toContain("[[issues/00100-linked-issue|#00100]]");
  });

  it("skips empty custom field values (markdown)", () => {
    const ctx = makeIssueContext({
      customFields: [{ id: 1, name: "Empty", value: "" }],
    });
    const md = theme.render(ctx);
    expect(md).not.toContain("### Empty");
  });
});
