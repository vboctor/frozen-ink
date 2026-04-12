import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchBar from "../components/SearchBar";

const FILES = [
  { path: "issues/1-fix-login-bug.md", title: "1: Fix login bug" },
  { path: "pull-requests/2-add-auth-feature.md", title: "2: Add auth feature" },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SearchBar", () => {
  it("renders input and focuses it", () => {
    render(<SearchBar files={[]} collection="my-repo" onClose={() => {}} onNavigate={() => {}} />);
    const input = screen.getByPlaceholderText("Search pages by title...");
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("calls onClose when overlay background is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<SearchBar files={[]} collection="my-repo" onClose={onClose} onNavigate={() => {}} />);

    const overlay = container.querySelector(".search-overlay")!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("displays search results after typing", async () => {
    const user = userEvent.setup();
    render(<SearchBar files={FILES} collection="my-repo" onClose={() => {}} onNavigate={() => {}} />);

    const input = screen.getByPlaceholderText("Search pages by title...");
    await user.type(input, "login");

    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });
  });

  it("calls onNavigate when a result is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<SearchBar files={FILES} collection="my-repo" onClose={() => {}} onNavigate={onNavigate} />);

    const input = screen.getByPlaceholderText("Search pages by title...");
    await user.type(input, "login");

    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });

    await user.click(screen.getAllByRole("option")[0]);
    expect(onNavigate).toHaveBeenCalledWith("my-repo", "issues/1-fix-login-bug.md", false);
  });

  it("shows empty state when no results", async () => {
    const user = userEvent.setup();
    render(<SearchBar files={FILES} collection="my-repo" onClose={() => {}} onNavigate={() => {}} />);

    const input = screen.getByPlaceholderText("Search pages by title...");
    await user.type(input, "zzz-nonexistent-xqq");

    await waitFor(() => {
      expect(screen.getByText("No results found")).toBeInTheDocument();
    });
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SearchBar files={[]} collection="my-repo" onClose={onClose} onNavigate={() => {}} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
