// Burn a timestamp bar into a frame so the video model can cite exact times.

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** "t=1.25s" — always 2 decimals. */
export function formatTimestamp(t: number): string {
  const v = Number.isFinite(t) ? Math.max(0, t) : 0;
  return `t=${v.toFixed(2)}s`;
}

/** Bar geometry: 12% of the height at the bottom. Pure, for tests. */
export function timestampBarLayout(w: number, h: number) {
  const barH = Math.max(10, Math.round(h * 0.12));
  const fontPx = Math.max(8, Math.round(barH * 0.62));
  return { barY: h - barH, barH, fontPx, textX: Math.round(Math.min(w, h) * 0.03), textY: h - barH / 2 };
}

export function burnTimestamp(ctx: Ctx2D, t: number, w: number, h: number): void {
  const { barY, barH, fontPx, textX, textY } = timestampBarLayout(w, h);
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, barY, w, barH);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(formatTimestamp(t), textX, textY);
  ctx.restore();
}
