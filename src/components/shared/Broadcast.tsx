// Broadcast chrome primitives: corner brackets, tally light, kbd hints, eyebrow labels, verdict icons, logo.
import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { Verdict } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Four L-shaped corner brackets framing a media viewer. */
export function CornerBrackets({ className, color = "border-white/70", size = "size-5" }: { className?: string; color?: string; size?: string }) {
  const base = cn("pointer-events-none absolute border-0", size, color);
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 z-20", className)}>
      <span className={cn(base, "left-2 top-2 border-l-2 border-t-2")} />
      <span className={cn(base, "right-2 top-2 border-r-2 border-t-2")} />
      <span className={cn(base, "bottom-2 left-2 border-b-2 border-l-2")} />
      <span className={cn(base, "bottom-2 right-2 border-b-2 border-r-2")} />
    </div>
  );
}

type TallyTone = "live" | "final" | "replay" | "error" | "idle";
const TALLY: Record<TallyTone, { dot: string; text: string; ring: string }> = {
  live: { dot: "bg-signal animate-tally shadow-[0_0_12px_var(--color-signal)]", text: "text-signal", ring: "border-signal/40 bg-signal/10" },
  final: { dot: "bg-volt shadow-[0_0_10px_var(--color-volt)]", text: "text-volt", ring: "border-volt/40 bg-volt/10" },
  replay: { dot: "bg-cyan animate-tally", text: "text-cyan", ring: "border-cyan/40 bg-cyan/10" },
  error: { dot: "bg-amber", text: "text-amber", ring: "border-amber/40 bg-amber/10" },
  idle: { dot: "bg-dim", text: "text-dim", ring: "border-line bg-surface-2" },
};

/** "● ANALYZING" style tally light. */
export function TallyLight({ tone = "live", children, className }: { tone?: TallyTone; children: ReactNode; className?: string }) {
  const t = TALLY[tone];
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] backdrop-blur-md [background-image:linear-gradient(rgb(7_9_12/0.6),rgb(7_9_12/0.6))]",
        t.ring,
        t.text,
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 rounded-full", t.dot)} />
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line border-b-2 bg-surface-2 px-1 font-mono text-[10px] font-semibold text-dim",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Mono eyebrow label with a coloured tick: "▌ THE TAPE". */
export function Eyebrow({ children, tone = "volt", className }: { children: ReactNode; tone?: "volt" | "cyan" | "signal" | "amber" | "dim" | "nvidia"; className?: string }) {
  const tick = { volt: "bg-volt", cyan: "bg-cyan", signal: "bg-signal", amber: "bg-amber", dim: "bg-dim", nvidia: "bg-nvidia" }[tone];
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-dim", className)}>
      <span aria-hidden className={cn("h-3 w-[3px] rounded-full", tick)} />
      {children}
    </span>
  );
}

/** Verdict glyph: ✓ good, ! borderline, ✕ bad, – unmeasurable. Colour is never the only signal. */
export function VerdictIcon({ verdict, className }: { verdict: Verdict; className?: string }) {
  const label = { good: "in range", borderline: "borderline", bad: "out of range", unmeasurable: "not measurable" }[verdict];
  const cls = {
    good: "bg-volt/15 text-volt border-volt/40",
    borderline: "bg-amber/15 text-amber border-amber/40",
    bad: "bg-signal/15 text-signal border-signal/40",
    unmeasurable: "bg-surface-3 text-dim border-line",
  }[verdict];
  return (
    <span role="img" aria-label={label} className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border", cls, className)}>
      {verdict === "good" ? (
        <Check className="size-3" strokeWidth={3} />
      ) : verdict === "bad" ? (
        <X className="size-3" strokeWidth={3} />
      ) : verdict === "borderline" ? (
        <span className="font-mono text-[11px] font-bold leading-none">!</span>
      ) : (
        <span className="font-mono text-[11px] font-bold leading-none">–</span>
      )}
    </span>
  );
}

/** Brand mark: a volt crosshair tile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#c6ff3d" />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="#07090c" strokeWidth="2.5" />
      <path d="M16 4.5v6M16 21.5v6M4.5 16h6M21.5 16h6" stroke="#07090c" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.2" fill="#ff3b5c" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-7" />
      <span className="font-display text-[22px] uppercase leading-none tracking-[0.06em] text-text">
        Gym<span className="text-volt">Bro</span>
      </span>
    </span>
  );
}

/** Standard card surface. */
export function Panel({ children, className, as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & Record<string, unknown>) {
  return (
    <As
      className={cn(
        "relative rounded-2xl border border-line bg-surface/85 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_20px_40px_-24px_rgb(0_0_0/0.8)] backdrop-blur-sm",
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}
