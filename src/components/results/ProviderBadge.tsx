// Provider badge: makes the video model visibly load-bearing (NVIDIA Cosmos green), fallbacks amber.
import { Bone, Brain, Database, Eye, ScanEye, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";
import type { ProviderId } from "@/lib/types";
import { cn } from "@/lib/utils";

type Kind = "cosmos" | "nemotron" | "gpt-fallback" | "pose-only" | "demo" | "mediapipe" | "openai" | "image" | "rules" | "other";

function classify(p: string): Kind {
  const s = p.toLowerCase();
  if (s.includes("cosmos")) return "cosmos";
  if (s.includes("nemotron")) return "nemotron";
  if (s === "gpt-fallback" || (s.includes("gpt") && (s.includes("vision") || s.includes("fallback")))) return "gpt-fallback";
  if (s.includes("pose-only") || s.includes("pose only")) return "pose-only";
  if (s.includes("demo") || s.includes("cache")) return "demo";
  if (s.includes("mediapipe")) return "mediapipe";
  if (s.includes("image")) return "image";
  if (s.includes("rule")) return "rules";
  if (s.includes("gpt") || s.includes("openai")) return "openai";
  return "other";
}

const META: Record<Kind, { label: string; cls: string; Icon: typeof Eye }> = {
  cosmos: { label: "NVIDIA Cosmos", cls: "border-nvidia/50 bg-nvidia/12 text-[#9be22d]", Icon: Eye },
  nemotron: { label: "NVIDIA Nemotron", cls: "border-nvidia/50 bg-nvidia/12 text-[#9be22d]", Icon: Brain },
  "gpt-fallback": { label: "GPT vision · fallback", cls: "border-amber/50 bg-amber/10 text-amber", Icon: TriangleAlert },
  "pose-only": { label: "Pose-only scan", cls: "border-cyan/40 bg-cyan/10 text-cyan", Icon: ScanEye },
  demo: { label: "Demo · cached", cls: "border-line bg-surface-3 text-dim", Icon: Database },
  mediapipe: { label: "MediaPipe", cls: "border-cyan/35 bg-cyan/8 text-cyan", Icon: Bone },
  openai: { label: "OpenAI", cls: "border-white/15 bg-white/5 text-text", Icon: Sparkles },
  image: { label: "GPT Image", cls: "border-white/15 bg-white/5 text-text", Icon: WandSparkles },
  rules: { label: "Rule-based", cls: "border-amber/50 bg-amber/10 text-amber", Icon: TriangleAlert },
  other: { label: "", cls: "border-line bg-surface-2 text-dim", Icon: Sparkles },
};

export interface ProviderBadgeProps {
  /** A ProviderId or a free-form step provider label ("NVIDIA Cosmos", "GPT vision", "cached"…). */
  provider: ProviderId | string;
  model?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}

export function ProviderBadge({ provider, model, size = "sm", className }: ProviderBadgeProps) {
  const kind = classify(provider);
  const m = META[kind];
  const label = kind === "other" || kind === "openai" ? provider : m.label;
  const nv = kind === "cosmos" || kind === "nemotron";
  return (
    <span
      data-provider={kind}
      title={model ? `${label} · ${model}` : label}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-mono font-semibold uppercase",
        size === "xs" && "h-5 px-2 text-[9.5px] tracking-[0.12em]",
        size === "sm" && "h-6 px-2.5 text-[10.5px] tracking-[0.14em]",
        size === "md" && "h-8 px-3 text-xs tracking-[0.14em]",
        m.cls,
        className,
      )}
    >
      {nv ? (
        <span aria-hidden className={cn("flex items-center justify-center rounded-[3px] bg-nvidia text-bg", size === "xs" ? "size-3" : "size-3.5")}>
          <m.Icon className={size === "xs" ? "size-2" : "size-2.5"} strokeWidth={3} />
        </span>
      ) : (
        <m.Icon aria-hidden className={size === "xs" ? "size-2.5" : "size-3"} />
      )}
      <span className={model && size === "md" ? "shrink-0" : "truncate"}>{label}</span>
      {model && size === "md" && <span className="truncate font-normal normal-case tracking-normal opacity-70">{model}</span>}
    </span>
  );
}
