// Person-centred crop for the image edit (spec §7.9). Pure math — rendering lives in extractFrames.ts.
import type { CropBox, EditSize, ExerciseId, PoseResult } from "../types";
import { LM, VISIBILITY_MIN } from "../pose/landmarks";

const SIZES: Record<EditSize, { outW: number; outH: number }> = {
  "1024x1536": { outW: 1024, outH: 1536 },
  "1536x1024": { outW: 1536, outH: 1024 },
  "1024x1024": { outW: 1024, outH: 1024 },
};

/** Portrait → 2:3, landscape → 3:2, square → 1:1. */
export function editSizeFor(w: number, h: number): EditSize {
  if (h > w) return "1024x1536";
  if (w > h) return "1536x1024";
  return "1024x1024";
}

export const CROP_PADDING = 0.25;
/** Extra headroom (fraction of the body bbox height) above the head so a bar overhead stays in frame. */
export const OVERHEAD_HEADROOM = 0.35;
const BASE_HEADROOM = 0.05;

function overheadPose(pose: PoseResult): boolean {
  const lm = pose.landmarks;
  const nose = lm[LM.NOSE];
  const wrists = [lm[LM.L_WRIST], lm[LM.R_WRIST]].filter((w) => w && w.visibility >= VISIBILITY_MIN);
  return !!nose && wrists.length > 0 && wrists.some((w) => w.y < nose.y);
}

/**
 * Crop box (source-frame pixels) around the lifter: visible-landmark bbox + 25% padding (+ headroom),
 * expanded to the output aspect, shrunk (keeping aspect) if the frame is too small, clamped inside the frame.
 */
export function computeCrop(pose: PoseResult, frameW: number, frameH: number, exercise?: ExerciseId): CropBox {
  const size = editSizeFor(frameW, frameH);
  const { outW, outH } = SIZES[size];
  const aspect = outW / outH;

  const pts = pose.landmarks.filter((l) => Number.isFinite(l.x) && Number.isFinite(l.y));
  const vis = pts.filter((l) => l.visibility >= VISIBILITY_MIN);
  const use = vis.length >= 3 ? vis : pts;

  let x0: number, x1: number, y0: number, y1: number;
  if (use.length) {
    const xs = use.map((l) => l.x * frameW);
    const ys = use.map((l) => l.y * frameH);
    x0 = Math.min(...xs);
    x1 = Math.max(...xs);
    y0 = Math.min(...ys);
    y1 = Math.max(...ys);
  } else {
    x0 = 0;
    x1 = frameW;
    y0 = 0;
    y1 = frameH;
  }
  const bw = Math.max(x1 - x0, 1);
  const bh = Math.max(y1 - y0, 1);
  const overhead = exercise === "pull_up" || exercise === "overhead_press" || overheadPose(pose);
  const head = overhead ? OVERHEAD_HEADROOM : BASE_HEADROOM;
  const top = y0 - bh * (CROP_PADDING + head);
  const bottom = y1 + bh * CROP_PADDING;
  const left = x0 - bw * CROP_PADDING;
  const right = x1 + bw * CROP_PADDING;

  let w = right - left;
  let h = bottom - top;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const paddedH = h;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  // Too big for the frame: shrink while keeping the aspect (never pad with fake pixels).
  const s = Math.min(1, frameW / w, frameH / h);
  w *= s;
  h *= s;
  // Integer box with the aspect preserved (within rounding).
  let hi = Math.max(1, Math.floor(h));
  let wi = Math.max(1, Math.round(hi * aspect));
  if (wi > frameW) {
    wi = Math.max(1, Math.floor(frameW));
    hi = Math.max(1, Math.min(Math.floor(frameH), Math.round(wi / aspect)));
  }
  let y = cy - hi / 2;
  // When shrinking cut the padded box, keep the top (head + bar) for overhead lifts.
  if (overhead && hi < paddedH) y = top;
  const x = Math.round(Math.min(Math.max(cx - wi / 2, 0), Math.max(0, frameW - wi)));
  y = Math.round(Math.min(Math.max(y, 0), Math.max(0, frameH - hi)));
  return { x, y, w: wi, h: hi, outW, outH, size };
}

/** Map normalised landmarks from the source frame (pose.width × pose.height) into the crop's output space. */
export function transformPose(pose: PoseResult, crop: CropBox): PoseResult {
  const W = pose.width;
  const H = pose.height;
  const zScale = W / crop.w;
  return {
    landmarks: pose.landmarks.map((l) => ({
      x: (l.x * W - crop.x) / crop.w,
      y: (l.y * H - crop.y) / crop.h,
      z: l.z * zScale,
      visibility: l.visibility,
    })),
    worldLandmarks: pose.worldLandmarks.map((l) => ({ ...l })),
    width: crop.outW,
    height: crop.outH,
  };
}

/** Inverse of transformPose: crop-space landmarks back into a frameW × frameH source frame. */
export function untransformPose(pose: PoseResult, crop: CropBox, frameW: number, frameH: number): PoseResult {
  const zScale = crop.w / frameW;
  return {
    landmarks: pose.landmarks.map((l) => ({
      x: (l.x * crop.w + crop.x) / frameW,
      y: (l.y * crop.h + crop.y) / frameH,
      z: l.z * zScale,
      visibility: l.visibility,
    })),
    worldLandmarks: pose.worldLandmarks.map((l) => ({ ...l })),
    width: frameW,
    height: frameH,
  };
}
