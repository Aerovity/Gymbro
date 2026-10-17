// Aspect-locked media box (keeps image + SVG overlay aligned) with broadcast corner brackets.
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CornerBrackets } from "@/components/shared/Broadcast";

export interface MediaFrameProps {
  width: number;
  height: number;
  /** CSS length capping the box height; width shrinks to keep the aspect. */
  maxHeight?: string;
  children: ReactNode;
  className?: string;
  brackets?: boolean;
  testId?: string;
  style?: CSSProperties;
}

export function MediaFrame({ width, height, maxHeight = "min(76vh, 860px)", children, className, brackets = true, testId, style }: MediaFrameProps) {
  const ratio = width / height;
  return (
    <div
      data-testid={testId}
      className={cn("relative mx-auto overflow-hidden rounded-2xl border border-line bg-black shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.02)]", className)}
      style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(${maxHeight} * ${ratio}))`, ...style }}
    >
      {children}
      {brackets && <CornerBrackets />}
    </div>
  );
}
