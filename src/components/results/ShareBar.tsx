"use client";
// Results toolbar: skeleton & angles switch (S), download, share, agent trace.
import { Download, Share2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/shared/Broadcast";
import { Switch } from "@/components/ui/switch";

export interface ShareBarProps {
  showSkeleton: boolean;
  onToggleSkeleton: () => void;
  onDownload: () => void;
  onShare: () => void;
  onOpenTrace: () => void;
  /** Download/share need a before image at least. */
  canExport?: boolean;
  className?: string;
}

const btn =
  "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface-2/80 px-3.5 text-[13px] font-semibold text-text transition-colors duration-200 hover:border-dim/50 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40";

export function ShareBar({ showSkeleton, onToggleSkeleton, onDownload, onShare, onOpenTrace, canExport = true, className }: ShareBarProps) {
  return (
    <div role="toolbar" aria-label="Results tools" className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="inline-flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface-2/80 pl-3.5 pr-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface-3">
        <Switch
          data-testid="skeleton-toggle"
          checked={showSkeleton}
          onCheckedChange={() => onToggleSkeleton()}
          aria-label="Skeleton and angles"
          className="data-checked:bg-volt"
        />
        <span aria-hidden onClick={onToggleSkeleton} className="cursor-pointer select-none">
          <span className="hidden sm:inline">Skeleton &amp; angles</span>
          <span className="sm:hidden">Skeleton</span>
        </span>
        <Kbd className="hidden md:inline-flex">S</Kbd>
      </div>
      <button type="button" data-testid="download-btn" onClick={onDownload} disabled={!canExport} className={btn} aria-label="Download before and after image">
        <Download className="size-4" aria-hidden />
        <span className="hidden sm:inline">Download</span>
      </button>
      <button type="button" onClick={onShare} disabled={!canExport} className={btn} aria-label="Share">
        <Share2 className="size-4" aria-hidden />
        <span className="hidden sm:inline">Share</span>
      </button>
      <button type="button" data-testid="trace-btn" onClick={onOpenTrace} className={cn(btn, "border-nvidia/40 text-[#9be22d] hover:border-nvidia/70 hover:bg-nvidia/10")}>
        <Terminal className="size-4" aria-hidden />
        <span className="sm:hidden">Trace</span>
        <span className="hidden sm:inline">Agent trace</span>
      </button>
    </div>
  );
}
