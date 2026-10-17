"use client";
/* eslint-disable @next/next/no-img-element */
// Sample clip cards from DEMO_CLIPS ("Sample · Pull-ups"). Clicking opens the cached sample results instantly.
import { useRef } from "react";
import { Play } from "lucide-react";
import type { DemoId } from "@/lib/types";
import { DEMO_CLIPS, EXERCISE_INFO } from "@/lib/exercises/catalog";
import { cn } from "@/lib/utils";
import { ProviderBadge } from "@/components/results/ProviderBadge";

export function SampleClips({ onPick, className }: { onPick: (id: DemoId) => void; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)}>
      {DEMO_CLIPS.map((c) => (
        <SampleCard key={c.id} id={c.id} title={c.title} subtitle={c.subtitle} poster={c.poster} video={c.video} exercise={EXERCISE_INFO[c.exercise].label} onPick={onPick} />
      ))}
    </div>
  );
}

function SampleCard({ id, title, subtitle, poster, video, exercise, onPick }: { id: DemoId; title: string; subtitle: string; poster: string; video: string; exercise: string; onPick: (id: DemoId) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  return (
    <button
      type="button"
      data-testid={`sample-${id}`}
      onClick={() => onPick(id)}
      onMouseEnter={() => v.current?.play().catch(() => {})}
      onMouseLeave={() => v.current?.pause()}
      onFocus={() => v.current?.play().catch(() => {})}
      onBlur={() => v.current?.pause()}
      className="group flex w-full cursor-pointer items-stretch gap-4 overflow-hidden rounded-2xl border border-line bg-surface/80 p-2.5 text-left transition-colors duration-200 hover:border-volt/50"
    >
      <span className="relative h-[124px] w-[70px] shrink-0 overflow-hidden rounded-xl bg-black">
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <video ref={v} src={video} muted loop playsInline preload="none" className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity group-hover:opacity-0">
          <span className="flex size-8 items-center justify-center rounded-full bg-volt text-bg">
            <Play className="size-3.5 fill-current" aria-hidden />
          </span>
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-1 pr-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">Sample · {title}</span>
        <span className="mt-1 font-display text-[26px] uppercase leading-none text-text">See it work</span>
        <span className="mt-1.5 text-[13px] text-dim" title={exercise}>
          {subtitle}
        </span>
        <span className="mt-3 flex flex-wrap items-center gap-2">
          <ProviderBadge provider="Cached results" size="xs" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-volt transition-transform duration-200 group-hover:translate-x-0.5">Open sample →</span>
        </span>
      </span>
    </button>
  );
}
