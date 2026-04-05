import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchBar from "../components/SearchBar";

const mockResults = [
  {
    collection: "my-repo",
    entityId: 1,
    externalId: "1",
    entityType: "issue",
    title: "Fix login bug",
    markdownPath: "issues/1-fix-login-bug.md",
    rank: 1,
  },
  {
    collection: "my-repo",
    entityId: 2,
    externalId: "2",
    entityType: "pull_request",
    title: "Add auth feature",
    markdownPath: "pull-requests/2-add-auth-feature.md",
    rank: 2,
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SearchBar", () => {
  it("renders input and focuses it", () => {
    render(<SearchBar onClose={() => {}} onNavigate={() => {}} />);
    const input = screen.getByPlaceholderText("Search across all collections...");
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("calls onClose when overlay background is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<SearchBar onClose={onClose} onNavigate={() => {}} />);

    const overlay = container.querySelector(".search-overlay")!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("displays search results after typing", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResults), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<SearchBar onClose={() => {}} onNavigate={() => {}} />);

    const input = screen.getByPlaceholderText("Search across all collections...");
    await user.type(input, "login");
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.getByText("Add auth feature")).toBeInTheDocument();
    });
  });

  it("calls onNavigate when a result is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResults), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<SearchBar onClose={() => {}} onNavigate={onNavigate} />);

    const input = screen.getByPlaceholderText("Search across all collections...");
    await user.type(input, "login");
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Fix login bug"));
    expect(onNavigate).toHaveBeenCalledWith("my-repo", "issues/1-fix-login-bug.md");
  });

  it("shows empty state when no results", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<SearchBar onClose={() => {}} onNavigate={() => {}} />);

    const input = screen.getByPlaceholderText("Search across all collections...");
    await user.type(input, "nonexistent");
    await waitFor(() => {
      expect(screen.getByText("No results found")).toBeInTheDocument();
    });
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SearchBar onClose={onClose} onNavigate={() => {}} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
