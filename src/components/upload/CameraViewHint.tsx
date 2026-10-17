// Camera placement hint with a tiny illustration per exercise (phone + field of view + lifter).
// Auto shows both: push-ups side-on at floor level, pull-ups from behind or the side with the bar in frame.
import type { ExerciseChoice } from "@/lib/types";
import { cn } from "@/lib/utils";

type Kind = "push_up" | "pull_up";

const HINT: Record<Kind, { title: string; text: string; tag: string }> = {
  push_up: { title: "Push-ups", text: "Side-on, phone on the floor about 2 m away — head to heels in frame.", tag: "SIDE · FLOOR" },
  pull_up: { title: "Pull-ups", text: "From behind or the side, with the bar and your whole body in frame.", tag: "REAR / SIDE" },
};

function Glyph({ kind }: { kind: Kind }) {
  return (
    <svg viewBox="0 0 96 64" className="h-14 w-[84px] shrink-0" aria-hidden>
      <rect x="0.5" y="0.5" width="95" height="63" rx="10" fill="#0e1218" stroke="#232b36" />
      {kind === "push_up" ? (
        <>
          {/* floor */}
          <line x1="8" y1="50" x2="90" y2="50" stroke="#8a97a8" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
          {/* field of view from a phone on the floor */}
          <path d="M15 45 L88 28 L88 50 Z" fill="#c6ff3d" fillOpacity="0.1" />
          <rect x="9" y="40" width="6" height="10" rx="1.5" fill="#c6ff3d" />
          {/* plank, side-on */}
          <circle cx="40" cy="33" r="3.6" fill="#2ee6ff" fillOpacity="0.25" stroke="#2ee6ff" strokeWidth="1.5" />
          <line x1="44" y1="35.5" x2="82" y2="46" stroke="#2ee6ff" strokeWidth="2" strokeLinecap="round" />
          <line x1="47" y1="36.5" x2="47" y2="49" stroke="#2ee6ff" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* bar */}
          <line x1="24" y1="11" x2="64" y2="11" stroke="#8a97a8" strokeWidth="2.2" strokeLinecap="round" />
          {/* hanging lifter */}
          <line x1="36" y1="11" x2="40" y2="25" stroke="#2ee6ff" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="52" y1="11" x2="48" y2="25" stroke="#2ee6ff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="44" cy="21" r="3.6" fill="#2ee6ff" fillOpacity="0.25" stroke="#2ee6ff" strokeWidth="1.5" />
          <line x1="44" y1="25" x2="44" y2="41" stroke="#2ee6ff" strokeWidth="2" strokeLinecap="round" />
          <line x1="44" y1="41" x2="41.5" y2="55" stroke="#2ee6ff" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="44" y1="41" x2="46.5" y2="55" stroke="#2ee6ff" strokeWidth="1.8" strokeLinecap="round" />
          {/* phone behind, bar in frame */}
          <path d="M80 34 L58 6 L58 60 Z" fill="#c6ff3d" fillOpacity="0.1" />
          <rect x="80" y="29" width="6" height="10" rx="1.5" fill="#c6ff3d" />
        </>
      )}
    </svg>
  );
}

function Row({ kind, showTitle }: { kind: Kind; showTitle: boolean }) {
  const h = HINT[kind];
  return (
    <div className="flex items-center gap-4">
      <Glyph kind={kind} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
          {showTitle && <span className="text-text">{h.title}</span>}
          <span>{h.tag}</span>
        </div>
        <p className="mt-1 text-[14px] leading-snug text-text">{h.text}</p>
      </div>
    </div>
  );
}

export function CameraViewHint({ exercise, className }: { exercise: ExerciseChoice; className?: string }) {
  const ex: string = exercise;
  const kinds: Kind[] = ex === "push_up" ? ["push_up"] : ex === "pull_up" ? ["pull_up"] : ["push_up", "pull_up"];
  return (
    <div className={cn("rounded-2xl border border-line bg-surface/70 p-4", className)}>
      <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">Where to put your phone</div>
      <div className="flex flex-col gap-3.5">
        {kinds.map((k) => (
          <Row key={k} kind={k} showTitle={kinds.length > 1} />
        ))}
      </div>
    </div>
  );
}
