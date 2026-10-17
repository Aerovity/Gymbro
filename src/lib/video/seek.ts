// Exact frame seeking on a single <video> element (spec §7.1). Never call in parallel on one element.

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
};

export async function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 4000): Promise<void> {
  const dur = Number.isFinite(video.duration) ? video.duration : t;
  const target = Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
  if (Math.abs(video.currentTime - target) < 1e-3 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => {
      video.removeEventListener("seeked", done);
      reject(new Error("seek timeout"));
    }, timeoutMs);
    const done = () => {
      clearTimeout(to);
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = target;
  });
  // Ensure the decoded frame is actually presented (Chrome/Safari). rVFC may never
  // fire for a paused hidden element in some browsers, so race it with a short timer.
  const v = video as RvfcVideo;
  if (typeof v.requestVideoFrameCallback === "function") {
    await new Promise<void>((r) => {
      const to = setTimeout(r, 120);
      v.requestVideoFrameCallback!(() => {
        clearTimeout(to);
        r();
      });
    });
  }
}
