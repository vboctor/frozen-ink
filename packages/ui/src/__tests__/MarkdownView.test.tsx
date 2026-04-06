import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MarkdownView from "../components/MarkdownView";

describe("MarkdownView", () => {
  it("renders headings", () => {
    render(
      <MarkdownView content="# Hello World" collection="test" allFiles={[]} onWikilinkClick={() => {}} />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello World");
  });

  it("renders paragraphs", () => {
    render(
      <MarkdownView
        content="This is a paragraph."
        collection="test"
        allFiles={[]}
        onWikilinkClick={() => {}}
      />,
    );
    expect(screen.getByText("This is a paragraph.")).toBeInTheDocument();
  });

  it("renders code blocks", () => {
    const content = "```\nconst x = 1;\n```";
    render(
      <MarkdownView content={content} collection="test" allFiles={[]} onWikilinkClick={() => {}} />,
    );
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });

  it("renders tables with remark-gfm", () => {
    const content = "| Name | Value |\n| --- | --- |\n| foo | bar |";
    render(
      <MarkdownView content={content} collection="test" allFiles={[]} onWikilinkClick={() => {}} />,
    );
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("renders lists", () => {
    const content = "- Item one\n- Item two\n- Item three";
    render(
      <MarkdownView content={content} collection="test" allFiles={[]} onWikilinkClick={() => {}} />,
    );
    expect(screen.getByText("Item one")).toBeInTheDocument();
    expect(screen.getByText("Item two")).toBeInTheDocument();
  });

  it("strips frontmatter", () => {
    const content = "---\ntitle: Test\ntype: issue\n---\n\n# Test Heading";
    render(
      <MarkdownView content={content} collection="test" allFiles={[]} onWikilinkClick={() => {}} />,
    );
    expect(screen.queryByText("title: Test")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test Heading");
  });

  it("renders wikilinks as clickable links when file exists", async () => {
    const user = userEvent.setup();
    const onWikilinkClick = vi.fn();
    render(
      <MarkdownView
        content="See [[issues/123]] for details."
        collection="test"
        allFiles={["issues/123.md"]}
        onWikilinkClick={onWikilinkClick}
      />,
    );

    const link = screen.getByText("123");
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("A");
    expect(link).toHaveClass("wikilink");

    await user.click(link);
    expect(onWikilinkClick).toHaveBeenCalledWith("issues/123", false);
  });

  it("renders wikilinks as plain text when file does not exist", () => {
    render(
      <MarkdownView
        content="See [[issues/999]] for details."
        collection="test"
        allFiles={[]}
        onWikilinkClick={() => {}}
      />,
    );
    const span = screen.getByText("999");
    expect(span.tagName).toBe("SPAN");
    expect(span).toHaveClass("wikilink-missing");
  });

  it("renders wikilinks with labels", () => {
    render(
      <MarkdownView
        content="See [[issues/123|Issue #123]] for details."
        collection="test"
        allFiles={["issues/123.md"]}
        onWikilinkClick={() => {}}
      />,
    );
    const link = screen.getByText("Issue #123");
    expect(link).toBeInTheDocument();
    expect(link).toHaveClass("wikilink");
  });

  it("renders image embeds via attachment API", () => {
    render(
      <MarkdownView
        content="![[screenshot.png]]"
        collection="my-repo"
        allFiles={[]}
        onWikilinkClick={() => {}}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/api/attachments/my-repo/screenshot.png");
  });

  it("renders external links with target blank", () => {
    render(
      <MarkdownView
        content="[GitHub](https://github.com)"
        collection="test"
        allFiles={[]}
        onWikilinkClick={() => {}}
      />,
    );
    const link = screen.getByText("GitHub");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
