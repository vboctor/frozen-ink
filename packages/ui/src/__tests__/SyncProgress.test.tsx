import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SyncProgress from "../components/manage/SyncProgress";

describe("SyncProgress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes auto-republish failures to the parent when the job completes", async () => {
    const activeJob = {
      collectionName: "mantisbt",
      active: true,
      status: "republishing: uploading data",
      created: 0,
      updated: 1,
      deleted: 0,
      error: null,
      startedAt: 1,
      completedAt: null,
      full: false,
    };
    const completedJob = {
      ...activeJob,
      active: false,
      status: "completed",
      completedAt: 2,
      republishError: "Cloudflare authentication expired",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([activeJob])))
      .mockResolvedValueOnce(new Response(JSON.stringify([completedJob])));
    vi.stubGlobal("fetch", fetchMock);
    const onComplete = vi.fn();

    render(<SyncProgress collectionName="mantisbt" onComplete={onComplete} />);
    expect(await screen.findByText("republishing: uploading data")).toBeInTheDocument();

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        created: 0,
        updated: 1,
        deleted: 0,
        error: null,
        republishError: "Cloudflare authentication expired",
      });
    });
  });
});
