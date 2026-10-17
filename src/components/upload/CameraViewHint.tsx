// Camera placement hint with a tiny top-down illustration (lifter + phone + field of view).
import type { ExerciseChoice } from "@/lib/types";
import { EXERCISE_INFO } from "@/lib/exercises/catalog";
import { cn } from "@/lib/utils";

export function CameraViewHint({ exercise, className }: { exercise: ExerciseChoice; className?: string }) {
  const info = exercise === "auto" ? undefined : EXERCISE_INFO[exercise];
  const side = info ? info.bestView === "side" : true;
  const text = info?.cameraHint ?? "Side view works best for squat, deadlift, OHP and curl. Film pull-ups from behind, and bench from the foot end at 45°.";
  return (
    <div className={cn("flex items-center gap-4 rounded-2xl border border-line bg-surface/70 p-4", className)}>
      <svg viewBox="0 0 96 64" className="h-16 w-24 shrink-0" aria-hidden>
        <rect x="0.5" y="0.5" width="95" height="63" rx="10" fill="#0e1218" stroke="#232b36" />
        {/* lifter (top-down) */}
        <circle cx="48" cy="26" r="7" fill="#2ee6ff" fillOpacity="0.2" stroke="#2ee6ff" strokeWidth="1.5" />
        <line x1="36" y1="26" x2="60" y2="26" stroke="#2ee6ff" strokeWidth="1.5" strokeLinecap="round" />
        {/* phone + FOV */}
        {side ? (
          <>
            <path d="M14 26 L40 14 L40 38 Z" fill="#c6ff3d" fillOpacity="0.12" />
            <rect x="8" y="21" width="6" height="10" rx="1.5" fill="#c6ff3d" />
          </>
        ) : (
          <>
            <path d="M48 54 L34 34 L62 34 Z" fill="#c6ff3d" fillOpacity="0.12" />
            <rect x="44" y="52" width="8" height="6" rx="1.5" fill="#c6ff3d" />
          </>
        )}
        <text x="88" y="58" textAnchor="end" fontSize="7" fill="#8a97a8" fontFamily="monospace">
          {side ? "SIDE" : "FRONT/REAR"}
        </text>
      </svg>
      <div className="min-w-0">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">Camera</div>
        <p className="mt-1 text-[14px] leading-snug text-text">{text}</p>
      </div>
    </div>
  );
}
