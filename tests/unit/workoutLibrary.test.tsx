// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkoutLibrary } from "@/components/library/WorkoutLibrary";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const status = (configured: boolean) => Response.json({ provider: "vast", enabled: configured, configured });
const key = "test-team-key-with-at-least-32-characters";

async function enterSearch() {
  await waitFor(() => expect(screen.getByLabelText("Team access key")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Team access key"), { target: { value: key } });
  fireEvent.change(screen.getByLabelText("Find a movement"), { target: { value: "side view of a squat" } });
  fireEvent.click(screen.getByRole("button", { name: "Search workout clips" }));
}

describe("indexed workout library", () => {
  it("disables search and explains setup when the server is unconfigured", async () => {
    const fetcher = vi.fn().mockResolvedValue(status(false));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkoutLibrary />);
    expect(await screen.findByRole("heading", { name: "Library not configured" })).toBeVisible();
    expect(screen.getByLabelText("Team access key")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Search workout clips" })).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows a retry when status cannot be read", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(status(false));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkoutLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry connection check" }));
    expect(await screen.findByRole("heading", { name: "Library not configured" })).toBeVisible();
  });

  it("sends the team key only in a header and renders real empty results", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(status(true)).mockResolvedValueOnce(Response.json({ provider: "vast", results: [], searchedAt: "2026-10-17T00:00:00Z" }));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkoutLibrary />);
    await enterSearch();
    expect(await screen.findByText(/No matching clips found/)).toBeVisible();
    const [url, request] = fetcher.mock.calls[1];
    expect(url).toBe("/api/vast/search");
    expect(request.headers["x-vast-access-key"]).toBe(key);
    expect(JSON.parse(request.body)).toEqual({ query: "side view of a squat", limit: 5 });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("does not show upstream error bodies or treat an auth failure as no matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status(true)).mockResolvedValueOnce(new Response("PRIVATE_UPSTREAM_ERROR", { status: 401 })));
    render(<WorkoutLibrary />);
    await enterSearch();
    expect(await screen.findByRole("alert")).toHaveTextContent("The team access key was not accepted");
    expect(screen.queryByText(/No matching clips/)).not.toBeInTheDocument();
    expect(screen.queryByText("PRIVATE_UPSTREAM_ERROR")).not.toBeInTheDocument();
  });

  it("renders matched footage and explains an expired playback link", async () => {
    const hit = { id: "clip-1", title: "Squat.mp4", description: "Side view", similarity: 0.8, playbackUrl: "/api/vast/clip?ticket=opaque", startSeconds: 5, endSeconds: 7 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status(true)).mockResolvedValueOnce(Response.json({ provider: "vast", results: [hit], searchedAt: "2026-10-17T00:00:00Z" })));
    render(<WorkoutLibrary />);
    await enterSearch();
    const video = await screen.findByLabelText("Squat.mp4");
    expect(video).toHaveAttribute("src", hit.playbackUrl);
    expect(screen.getByText("Match in original video: 5.0s to 7.0s")).toBeVisible();
    fireEvent.error(video);
    expect(await screen.findByRole("alert")).toHaveTextContent("Search again to refresh the link");
  });
});
