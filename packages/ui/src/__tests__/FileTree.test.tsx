import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileTree from "../components/FileTree";
import type { TreeNode } from "../types";

const sampleTree: TreeNode[] = [
  {
    name: "issues",
    path: "issues",
    type: "directory",
    children: [
      { name: "1-first-issue.md", path: "issues/1-first-issue.md", type: "file" },
      { name: "2-second-issue.md", path: "issues/2-second-issue.md", type: "file" },
    ],
  },
  {
    name: "pull-requests",
    path: "pull-requests",
    type: "directory",
    children: [
      { name: "10-my-pr.md", path: "pull-requests/10-my-pr.md", type: "file" },
    ],
  },
];

describe("FileTree", () => {
  it("renders empty state when tree is empty", () => {
    render(<FileTree tree={[]} selectedFile={null} onSelect={() => {}} />);
    expect(screen.getByText("No files")).toBeInTheDocument();
  });

  it("renders directory names", () => {
    render(<FileTree tree={sampleTree} selectedFile={null} onSelect={() => {}} />);
    expect(screen.getByText("issues")).toBeInTheDocument();
    expect(screen.getByText("pull-requests")).toBeInTheDocument();
  });

  it("renders file names without .md extension", () => {
    render(<FileTree tree={sampleTree} selectedFile={null} onSelect={() => {}} />);
    expect(screen.getByText("1-first-issue")).toBeInTheDocument();
    expect(screen.getByText("2-second-issue")).toBeInTheDocument();
    expect(screen.getByText("10-my-pr")).toBeInTheDocument();
  });

  it("calls onSelect when a file is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FileTree tree={sampleTree} selectedFile={null} onSelect={onSelect} />);

    await user.click(screen.getByText("1-first-issue"));
    expect(onSelect).toHaveBeenCalledWith("issues/1-first-issue.md", false);
  });

  it("highlights the selected file", () => {
    render(
      <FileTree
        tree={sampleTree}
        selectedFile="issues/1-first-issue.md"
        onSelect={() => {}}
      />,
    );
    const button = screen.getByText("1-first-issue").closest("button");
    expect(button).toHaveClass("selected");
  });

  it("collapses and expands directories on click", async () => {
    const user = userEvent.setup();
    render(<FileTree tree={sampleTree} selectedFile={null} onSelect={() => {}} />);

    // Files visible initially (directories expanded by default)
    expect(screen.getByText("1-first-issue")).toBeInTheDocument();

    // Click the directory toggle to collapse
    const issuesToggle = screen.getByText("issues").closest("button")!;
    await user.click(issuesToggle);
    expect(screen.queryByText("1-first-issue")).not.toBeInTheDocument();

    // Click again to expand
    await user.click(issuesToggle);
    expect(screen.getByText("1-first-issue")).toBeInTheDocument();
  });
});
