"use client";
// Error and empty states: icon, title, plain explanation and recovery actions. Never a dead end.
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CircleAlert, Film, PersonStanding, Play, RotateCcw, ScanEye, Upload, WifiOff } from "lucide-react";
import type { AppError, ErrorCode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Copy {
  title: string;
  body: string;
  Icon: typeof CircleAlert;
}

const COPY: Record<ErrorCode, Copy> = {
  unsupported_codec: { title: "This browser can't decode that video", body: "Try Safari, or export the clip as H.264 MP4 and upload it again.", Icon: Film },
  file_too_large: { title: "That file is too big", body: "Keep it under 200 MB — trim the clip to the set itself (5–20 s works best).", Icon: Film },
  video_too_long: { title: "That clip is too long", body: "Trim it to a single set under 60 s so the video model can watch every rep.", Icon: Film },
  bad_file_type: { title: "That's not a video", body: "Upload an MP4 or MOV straight from your camera roll.", Icon: Film },
  no_person: { title: "We couldn't see a full body", body: "Film from 2–3 m away with your whole body in frame — side-on at floor level for push-ups, bar in frame for pull-ups.", Icon: PersonStanding },
  scan_failed: { title: "The video models didn't answer", body: "The NVIDIA video model and the fallbacks were unavailable. Try again in a moment, or look at the sample results.", Icon: ScanEye },
  pose_model_failed: { title: "The pose model failed to load", body: "Reload the page — the skeleton model runs in your browser and may have been blocked.", Icon: PersonStanding },
  coach_failed: { title: "The coach is offline", body: "Your angles and rule-based cues are still there. Retry the AI coach when ready.", Icon: CircleAlert },
  correct_failed: { title: "AI photo unavailable", body: "The target form is still drawn on your frame as a dashed skeleton.", Icon: CircleAlert },
  network: { title: "Connection dropped", body: "Check your Wi-Fi and retry, or look at the sample results instead.", Icon: WifiOff },
  unknown: { title: "Something went sideways", body: "Retry, or look at the sample results to see the full flow.", Icon: CircleAlert },
};

export interface ErrorStateProps {
  error: AppError;
  onRetry?: () => void;
  onUseDemo?: () => void;
  onPickOtherMoment?: () => void;
  onStartOver?: () => void;
  className?: string;
}

const primary = "inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-volt px-4 text-sm font-bold text-bg shadow-[var(--shadow-glow-volt)] transition-colors hover:bg-volt/85";
const ghost = "inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-3";

export function ErrorState({ error, onRetry, onUseDemo, onPickOtherMoment, onStartOver, className }: ErrorStateProps) {
  const c = COPY[error.code] ?? COPY.unknown;
  const showDemo = !!onUseDemo && ["scan_failed", "network", "unknown", "unsupported_codec", "pose_model_failed"].includes(error.code);
  const showPick = !!onPickOtherMoment && error.code === "no_person";
  return (
    <StateShell tone="signal" Icon={c.Icon} title={c.title} body={c.body} detail={error.message} className={className}>
      {showDemo && (
        <button type="button" data-testid="demo-fallback-btn" onClick={onUseDemo} className={primary}>
          <Play className="size-4" aria-hidden /> Use the sample results
        </button>
      )}
      {showPick && (
        <button type="button" onClick={onPickOtherMoment} className={primary}>
          <ScanEye className="size-4" aria-hidden /> Pick another moment
        </button>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className={showDemo || showPick ? ghost : primary}>
          <RotateCcw className="size-4" aria-hidden /> Retry
        </button>
      )}
      {onStartOver && (
        <button type="button" onClick={onStartOver} className={ghost}>
          <Upload className="size-4" aria-hidden /> Upload new
        </button>
      )}
    </StateShell>
  );
}

export function EmptyState({ title = "No tape yet", body = "Upload a set of push-ups or pull-ups on the home page, or try the sample.", action, className }: { title?: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <StateShell tone="cyan" Icon={Film} title={title} body={body} className={className}>
      {action}
    </StateShell>
  );
}

function StateShell({ tone, Icon, title, body, detail, children, className }: { tone: "signal" | "cyan"; Icon: typeof CircleAlert; title: string; body: string; detail?: string; children?: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role={tone === "signal" ? "alert" : "status"}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("flex flex-col items-center px-6 py-10 text-center", className)}
    >
      <span className={cn("flex size-16 items-center justify-center rounded-2xl ring-1", tone === "signal" ? "bg-signal/10 text-signal ring-signal/40 shadow-[var(--shadow-glow-signal)]" : "bg-cyan/10 text-cyan ring-cyan/30")}>
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="mt-5 max-w-md font-display text-[28px] uppercase leading-tight tracking-wide text-text text-balance">{title}</h2>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-dim">{body}</p>
      {detail && <p className="mt-3 max-w-sm rounded-lg border border-line bg-bg/50 px-3 py-2 font-mono text-[11px] leading-snug text-dim">{detail}</p>}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </motion.div>
  );
}
