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
    "page:1:onboarding-guide": "testproject/pages/onboarding-guide",
  };
  return map[externalId];
};

const titleLookup = (externalId: string): string | undefined => {
  const map: Record<string, string> = {
    "page:1:onboarding-guide": "Onboarding Guide for New Engineers",
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
      lookupEntityTitle: titleLookup,
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

  it("does not duplicate the page heading in markdown when content starts with H1", () => {
    const md = theme.render({
      entity: {
        externalId: "page:1:getting-started",
        entityType: "page",
        title: "Getting Started",
        data: {
          id: 1, name: "getting-started", title: "Getting Started",
          project: { id: 1, name: "TestProject" },
          content: "# Getting Started\n\nWelcome.",
        },
      },
      collectionName: "test",
      crawlerType: "mantishub",
      lookupEntityPath: lookup,
    });
    // Only one occurrence of the heading text in body (excluding frontmatter).
    const body = md.replace(/^---[\s\S]*?---\n/, "");
    const matches = body.match(/Getting Started/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does not render duplicate H1 when content starts with matching title", () => {
    const html = theme.renderHtml!(makePageContext("# Getting Started\n\nWelcome."));
    // Title H1 should appear exactly once
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    expect(h1Count).toBe(1);
    expect(html).toContain("Welcome.");
  });

  it("uses the content H1 when it differs from the stored title", () => {
    const html = theme.renderHtml!(makePageContext("# Onboarding Guide\n\nBody."));
    expect(html).toContain('class="mt-title">Onboarding Guide</h1>');
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    expect(h1Count).toBe(1);
  });

  it("uses the target page title as wiki-link label when available", () => {
    const html = theme.renderHtml!(makePageContext("See [[onboarding-guide]] for details."));
    expect(html).toContain('class="mt-page-link"');
    expect(html).toContain("Onboarding Guide for New Engineers");
    // The slug should not appear as the visible label (only inside the URL fragment).
    expect(html).not.toMatch(/>onboarding-guide</);
  });

  it("merges indented continuation lines into the previous list item", () => {
    const md = "* **Droplet**\n  Shut down the droplet.\n* **IP**\n  Release the reserved IP.";
    const html = theme.renderHtml!(makePageContext(md));
    expect(html).toContain("<li><strong>Droplet</strong><br>Shut down the droplet.</li>");
    expect(html).toContain("<li><strong>IP</strong><br>Release the reserved IP.</li>");
  });

  it("renders --- as a horizontal rule", () => {
    const html = theme.renderHtml!(makePageContext("Above\n\n---\n\n## Below"));
    expect(html).toContain('<hr class="mt-md-hr">');
    expect(html).toContain("<h2");
  });

  it("recognises NOTE admonition with leading whitespace before '>'", () => {
    const html = theme.renderHtml!(makePageContext(" > [!NOTE] \n> Legacy doco"));
    expect(html).toContain("mt-md-callout-note");
    expect(html).toContain("Legacy doco");
    expect(html).not.toContain("[!NOTE]");
  });

  it("tolerates malformed blockquote lines without splitting the quote", () => {
    const html = theme.renderHtml!(makePageContext("> First line\n>. \n> Third line"));
    expect((html.match(/<blockquote/g) ?? []).length).toBe(1);
    expect(html).toContain("First line");
    expect(html).toContain("Third line");
  });

  it("renders ![alt](url) as an <img> in HTML", () => {
    const html = theme.renderHtml!(makePageContext("![Screenshot](https://example.com/x.png)"));
    expect(html).toContain('<img class="mt-md-image" src="https://example.com/x.png" alt="Screenshot"');
    expect(html).not.toContain("!Screenshot");
    expect(html).not.toContain("!<a");
  });

  it("renders nested ordered lists with continuous numbering", () => {
    const md = "1. First\n\n2. Second\n   1. Sub a\n   2. Sub b\n\n3. Third\n4. Fourth";
    const html = theme.renderHtml!(makePageContext(md));
    // Single outer <ol>
    expect((html.match(/<ol[\s>]/g) ?? []).length).toBe(2); // outer + 1 nested
    expect((html.match(/<\/ol>/g) ?? []).length).toBe(2);
    // Outer should contain First, Second, Third, Fourth in one list
    expect(html).toMatch(/<ol class="mt-md-list">.*First.*Second.*Third.*Fourth.*<\/ol>/s);
    // Nested ol inside Second's <li>
    expect(html).toMatch(/Second<ol[^>]*><li>Sub a<\/li><li>Sub b<\/li><\/ol>/);
  });

  it("renders task list items as checkboxes", () => {
    const md = "- [x] Done thing\n- [ ] Open thing\n- Plain item";
    const html = theme.renderHtml!(makePageContext(md));
    expect(html).toContain('<input type="checkbox" disabled checked>');
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(html).toContain('class="mt-md-task mt-md-task-done"');
    expect(html).toContain('class="mt-md-task"');
    expect(html).toContain("mt-md-task-list");
    // Plain item retains no task class
    expect(html).toContain("<li>Plain item</li>");
    // No literal bracket prefix on task items
    expect(html).not.toMatch(/<li[^>]*>\[/);
  });

  it("renders GFM > [!NOTE] admonitions as styled callouts", () => {
    const md = "> [!NOTE]\n> Heads up.\n\n> [!WARNING]\n> Careful here.";
    const html = theme.renderHtml!(makePageContext(md));
    expect(html).toContain("mt-md-callout-note");
    expect(html).toContain('<div class="mt-md-callout-title">Note</div>');
    expect(html).toContain("Heads up.");
    expect(html).toContain("mt-md-callout-warning");
    expect(html).toContain("Careful here.");
    // Should not appear as literal blockquote text
    expect(html).not.toContain("[!NOTE]");
  });

  it("renders nested bullet lists with proper indentation", () => {
    const md = "- Top one\n  - Child A\n  - Child B\n    - Grand\n- Top two";
    const html = theme.renderHtml!(makePageContext(md));
    // Outer list with class, inner list without
    expect(html).toContain('<ul class="mt-md-list">');
    // Three <ul> opens (root + 2 nested) and three closes
    expect((html.match(/<ul/g) ?? []).length).toBe(3);
    expect((html.match(/<\/ul>/g) ?? []).length).toBe(3);
    // The grand-child should be nested inside Child B's <li>
    expect(html).toContain("Child B<ul><li>Grand</li></ul>");
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
