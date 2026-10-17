// Video file validation and metadata probing (browser only).
import type { AppError, VideoMeta } from "../types";

export const ACCEPTED_MIME = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const ACCEPTED_EXT = [".mp4", ".mov", ".m4v", ".webm"] as const;
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_DURATION_S = 60;
const CODEC_WAIT_MS = 3000;

/** Pure validation of a picked file (type and size). Returns null when OK. */
export function validateFile(file: { name: string; size: number; type: string }): AppError | null {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  const okType =
    (ACCEPTED_MIME as readonly string[]).includes(type) ||
    // Some OSes give an empty or odd MIME type; fall back to the extension.
    ((type === "" || type === "application/octet-stream" || type.startsWith("video/")) &&
      ACCEPTED_EXT.some((e) => name.endsWith(e)));
  if (!okType) {
    return {
      code: "bad_file_type",
      message: "That doesn't look like a video we can read. Use an MP4, MOV or WebM clip.",
      stage: "probing",
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      code: "file_too_large",
      message: "That file is over 200 MB. Trim to one set — 5–20 s works best.",
      stage: "probing",
    };
  }
  if (file.size <= 0) {
    return { code: "bad_file_type", message: "That file is empty.", stage: "probing" };
  }
  return null;
}

/** Pure duration check. */
export function validateDuration(duration: number): AppError | null {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { code: "unsupported_codec", message: "We couldn't read this video's length.", stage: "probing" };
  }
  if (duration > MAX_DURATION_S) {
    return {
      code: "video_too_long",
      message: "That clip is longer than 60 s. Trim to one set — 5–20 s works best.",
      stage: "probing",
    };
  }
  return null;
}

export function orientationOf(w: number, h: number): VideoMeta["orientation"] {
  if (Math.abs(w - h) <= Math.max(w, h) * 0.02) return "square";
  return w > h ? "landscape" : "portrait";
}

const CODEC_ERROR: AppError = {
  code: "unsupported_codec",
  message: "This video codec isn't supported by your browser. Try Safari, or export as H.264 MP4.",
  stage: "probing",
};

/** Throwable wrapper so callers can `catch (e) { if (isAppError(e)) … }`. */
export class AppErrorException extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message);
    this.name = "AppErrorException";
  }
}
export const isAppErrorException = (e: unknown): e is AppErrorException => e instanceof AppErrorException;

/**
 * Create a hidden <video>, wait for metadata and the first decodable frame, and read
 * the rendered (rotation-applied) size. Rejects with AppErrorException.
 */
export async function probeVideo(
  src: File | string,
): Promise<{ video: HTMLVideoElement; meta: VideoMeta; url: string }> {
  if (typeof src !== "string") {
    const err = validateFile(src);
    if (err) throw new AppErrorException(err);
  }
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  // Keep it in the DOM but invisible: some browsers throttle detached videos.
  Object.assign(video.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "2px",
    height: "2px",
    opacity: "0",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(video);

  const cleanup = () => {
    video.removeAttribute("src");
    video.load();
    video.remove();
    if (typeof src !== "string") URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => {
        off();
        // Metadata never arrived: almost always an unsupported container/codec.
        reject(new AppErrorException(CODEC_ERROR));
      }, CODEC_WAIT_MS + 7000);
      const onMeta = () => {
        off();
        resolve();
      };
      const onErr = () => {
        off();
        reject(new AppErrorException(CODEC_ERROR));
      };
      const off = () => {
        clearTimeout(to);
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
      };
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onErr);
      video.src = url;
    });

    // HEVC in desktop Chrome: metadata loads but videoWidth stays 0.
    const t0 = performance.now();
    while (video.videoWidth === 0 && performance.now() - t0 < CODEC_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (video.videoWidth === 0) throw new AppErrorException(CODEC_ERROR);

    const durErr = validateDuration(video.duration);
    if (durErr) throw new AppErrorException(durErr);

    const meta: VideoMeta = {
      name: typeof src === "string" ? src.split("/").pop() || "video" : src.name,
      size: typeof src === "string" ? 0 : src.size,
      mime: typeof src === "string" ? "video/mp4" : src.type || "video/mp4",
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      orientation: orientationOf(video.videoWidth, video.videoHeight),
    };
    return { video, meta, url };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Remove a probed video element and revoke its object URL. */
export function disposeVideo(video: HTMLVideoElement, url?: string) {
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.remove();
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}
