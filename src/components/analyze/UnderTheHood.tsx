"use client";
// One collapsible "Under the hood" section (closed by default). Its contents stay in the DOM when closed
// (hidden attribute), so markers/banners remain queryable: the tape (filmstrip + timeline + mini player +
// video-model verdict), the 5 steps with timings, the models used, and the agent-trace button.
import { useId, useRef, useState } from "react";
import { ChevronDown, Cpu, Crosshair, Terminal } from "lucide-react";
import type { ChosenMoment, SampledFrame, ScanResult, Stage, TraceEntry } from "@/lib/types";
import type { StepId, StepState } from "@/lib/store/pipeline";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/shared/Broadcast";
import { fmtMs } from "@/components/shared/tokens";
import { PipelineStepper } from "@/components/pipeline/PipelineStepper";
import { ScanVisualizer } from "@/components/pipeline/ScanVisualizer";
import { FoundBanner } from "@/components/pipeline/FoundBanner";
import { VideoTimeline } from "@/components/results/VideoTimeline";
import { ProviderBadge } from "@/components/results/ProviderBadge";

export interface UnderTheHoodProps {
  stage: Stage;
  steps: StepState[];
  trace: TraceEntry[];
  frames: SampledFrame[];
  duration: number;
  scan?: ScanResult;
  moment?: ChosenMoment;
  videoUrl?: string;
  videoW: number;
  videoH: number;
  providerLabel: string;
  demo: boolean;
  /** Badges for the "Models" row (provider labels). */
  modelBadges: string[];
  onSeek: (t: number) => void;
  onRetryStep: (id: StepId) => void;
  onPickOtherMoment?: () => void;
  onOpenTrace: () => void;
  className?: string;
}

export function UnderTheHood({ stage, steps, trace, frames, duration, scan, moment, videoUrl, videoW, videoH, providerLabel, demo, modelBadges, onSeek, onRetryStep, onPickOtherMoment, onOpenTrace, className }: UnderTheHoodProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const miniRef = useRef<HTMLVideoElement>(null);
  const [miniT, setMiniT] = useState<number | undefined>(undefined);
  const totalMs = trace.reduce((a, t) => a + (t.ms || 0), 0);
  const stepMs = steps.reduce((a, s) => a + (s.ms ?? 0), 0);
  const events = scan?.events ?? [];

  const seek = (t: number) => {
    const v = miniRef.current;
    if (v) {
      try {
        v.currentTime = t;
        setMiniT(t);
      } catch {
        /* ignore */
      }
    }
    onSeek(t);
  };

  return (
    <section aria-label="Under the hood" className={cn("rounded-2xl border border-line bg-surface/60 shadow-[inset_0_1px_0_rgb(255_255_255/0.03)]", className)}>
      <div className="flex items-center gap-2 p-2 sm:p-2.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-white/[0.03] sm:px-3"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-nvidia/12 text-[#9be22d] ring-1 ring-nvidia/35">
            <Cpu className="size-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[19px] uppercase leading-tight tracking-wide text-text">Under the hood</span>
            <span className="block truncate font-mono text-[11px] tabular text-dim">
              The tape · {steps.length} steps{stepMs ? ` · ${fmtMs(stepMs)}` : ""}
              {trace.length ? ` · ${trace.length} model calls` : ""}
            </span>
          </span>
          <ChevronDown className={cn("size-5 shrink-0 text-dim transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </button>
        <button
          type="button"
          data-testid="trace-btn"
          onClick={onOpenTrace}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-nvidia/40 px-3 text-[13px] font-semibold text-[#9be22d] transition-colors hover:border-nvidia/70 hover:bg-nvidia/10 sm:px-3.5"
        >
          <Terminal className="size-4" aria-hidden />
          <span className="hidden sm:inline">Agent trace</span>
          <span className="sm:hidden">Trace</span>
        </button>
      </div>

      <div id={panelId} hidden={!open}>
        <div className="animate-in fade-in slide-in-from-top-1 space-y-7 border-t border-line px-4 pb-5 pt-5 duration-300 sm:px-5">
          {/* The tape */}
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Eyebrow tone="nvidia">The tape</Eyebrow>
              <span className="text-[12.5px] tabular text-dim">
                {scan
                  ? `${events.length} moment${events.length === 1 ? "" : "s"} flagged by ${providerLabel}${scan.repCount != null ? ` · ${scan.repCount} reps` : ""}`
                  : `${duration.toFixed(1)} s clip`}
              </span>
              {moment && <FoundBanner moment={moment} variant="bar" testId="found-banner" className="w-full sm:ml-auto sm:w-auto" />}
            </div>
            <div className="flex gap-4">
              {videoUrl && (
                <div className="relative hidden shrink-0 overflow-hidden rounded-lg border border-line bg-black sm:block" style={{ height: 150, aspectRatio: `${videoW} / ${videoH}` }}>
                  <video
                    ref={miniRef}
                    src={videoUrl}
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      if (moment) e.currentTarget.currentTime = moment.t;
                    }}
                    onTimeUpdate={(e) => setMiniT(e.currentTarget.currentTime)}
                    onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play().catch(() => {}) : e.currentTarget.pause())}
                    className="h-full w-full cursor-pointer object-cover"
                    aria-label="Mini player — click to play or pause"
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <ScanVisualizer frames={frames} stage={stage} duration={duration} events={events} chosenT={moment?.t} />
                <VideoTimeline duration={duration} events={events} chosen={moment} currentTime={miniT} onSeek={seek} className="mt-1" />
              </div>
            </div>
            {(scan?.overall || (onPickOtherMoment && !demo && events.length > 1)) && (
              <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
                {scan?.overall && (
                  <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-dim">
                    <span className="font-semibold text-text">Video model verdict: </span>
                    {scan.overall}
                  </p>
                )}
                {onPickOtherMoment && !demo && events.length > 1 && (
                  <button
                    type="button"
                    onClick={onPickOtherMoment}
                    className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface-3"
                  >
                    <Crosshair className="size-4 text-signal" aria-hidden /> Analyse another flagged rep
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Steps + models */}
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div>
              <Eyebrow tone="cyan" className="mb-3">
                Steps
              </Eyebrow>
              <PipelineStepper steps={steps} onRetryStep={onRetryStep} compact />
            </div>
            <div>
              <Eyebrow tone="dim" className="mb-3">
                Models
              </Eyebrow>
              <div className="flex flex-wrap gap-2">
                {modelBadges.map((b) => (
                  <ProviderBadge key={b} provider={b} size="sm" model={b === providerLabel ? scan?.model : undefined} />
                ))}
              </div>
              {totalMs > 0 && (
                <p className="mt-3 font-mono text-[11.5px] tabular text-dim">
                  {trace.length} calls · {fmtMs(totalMs)} of model time
                </p>
              )}
              <button
                type="button"
                onClick={onOpenTrace}
                className="mt-3 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg text-[13px] font-semibold text-[#9be22d] underline-offset-4 hover:underline"
              >
                Open the full agent trace →
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
