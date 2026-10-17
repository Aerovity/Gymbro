// Trust strip: "Powered by NVIDIA Cosmos · MediaPipe · OpenAI".
import { Bone, Eye, Sparkles } from "lucide-react";

export function PoweredBy() {
  return (
    <div className="border-b border-line bg-surface/50">
      <div className="mx-auto flex max-w-[1320px] flex-col items-center gap-4 px-5 py-6 sm:flex-row sm:justify-between sm:px-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-dim">Powered by</span>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <li className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-nvidia text-bg">
              <Eye className="size-4" strokeWidth={2.5} aria-hidden />
            </span>
            <span className="font-display text-xl uppercase tracking-wide text-text">NVIDIA Cosmos · Nemotron</span>
          </li>
          <li aria-hidden className="hidden text-dim sm:block">·</li>
          <li className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-cyan/15 text-cyan ring-1 ring-cyan/30">
              <Bone className="size-4" aria-hidden />
            </span>
            <span className="font-display text-xl uppercase tracking-wide text-text">MediaPipe</span>
          </li>
          <li aria-hidden className="hidden text-dim sm:block">·</li>
          <li className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-white/10 text-text ring-1 ring-white/15">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <span className="font-display text-xl uppercase tracking-wide text-text">OpenAI</span>
          </li>
        </ul>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-dim lg:block">Video · Pose · Language · Image</span>
      </div>
    </div>
  );
}
