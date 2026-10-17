"use client";
// Dev gallery: AnalyzeView at every stage (?stage=…) and every component standalone (?stage=components).
import { useState } from "react";
import Link from "next/link";
import type { Stage } from "@/lib/types";
import type { AiPhotoState } from "@/lib/store/pipeline";
import { AnalyzeView } from "@/components/analyze/AnalyzeView";
import { PipelineStepper } from "@/components/pipeline/PipelineStepper";
import { ScanVisualizer } from "@/components/pipeline/ScanVisualizer";
import { FoundBanner } from "@/components/pipeline/FoundBanner";
import { BeforeAfter } from "@/components/results/BeforeAfter";
import { AiPhotoPanel } from "@/components/results/AiPhotoPanel";
import { PoseOverlay } from "@/components/results/PoseOverlay";
import { MediaFrame } from "@/components/results/MediaFrame";
import { AngleCard, AngleCardSkeleton } from "@/components/results/AngleCard";
import { VerdictCard } from "@/components/results/VerdictCard";
import { VideoTimeline } from "@/components/results/VideoTimeline";
import { AgentTrace } from "@/components/results/AgentTrace";
import { ProviderBadge } from "@/components/results/ProviderBadge";
import { EmptyState, ErrorState } from "@/components/results/ErrorState";
import { Eyebrow } from "@/components/shared/Broadcast";
import {
  MOCK_AFTER_IMG,
  MOCK_BEFORE_IMG,
  MOCK_DURATION,
  MOCK_H,
  MOCK_W,
  mockAfterPose,
  mockAngles,
  mockBeforePose,
  mockCoach,
  mockFrames,
  mockGhostPoints,
  mockMoment,
  mockPipeline,
  mockScan,
  mockSteps,
  mockTrace,
  mockVerify,
  type MockVariant,
} from "./mockData";

export const GALLERY_STAGES: Array<{ id: string; stage: Stage; variant?: MockVariant }> = [
  { id: "idle", stage: "idle" },
  { id: "probing", stage: "probing" },
  { id: "sampling", stage: "sampling" },
  { id: "scanning", stage: "scanning" },
  { id: "scanningLandscape", stage: "scanning", variant: "landscape" },
  { id: "picking", stage: "picking" },
  { id: "posing", stage: "posing" },
  { id: "coaching", stage: "coaching" },
  { id: "done", stage: "done" },
  { id: "aiGenerating", stage: "done", variant: "aiGenerating" },
  { id: "aiFailed", stage: "done", variant: "aiFailed" },
  { id: "aiDone", stage: "done", variant: "aiDone" },
  { id: "coachFallback", stage: "done", variant: "coachFallback" },
  { id: "scanFallback", stage: "done", variant: "scanFallback" },
  { id: "demo", stage: "done", variant: "demo" },
  { id: "error", stage: "error" },
];

const noop = () => {};

function StageView({ stage, variant }: { stage: Stage; variant?: MockVariant }) {
  const [data, setData] = useState(() => mockPipeline(stage, variant));
  return (
    <AnalyzeView
      data={data}
      ghostPoints={mockGhostPoints}
      onToggleSkeleton={() => setData((d) => ({ ...d, showSkeleton: !d.showSkeleton }))}
      onToggleVoice={() => setData((d) => ({ ...d, voiceOn: !d.voiceOn }))}
      onRetryStep={noop}
      onUseDemo={noop}
      onGenerateAiPhoto={() => setData((d) => ({ ...d, aiPhoto: "generating" }))}
      onChangeExercise={noop}
      onPickOtherMoment={noop}
      onStartOver={noop}
      onSeek={noop}
      onDownload={noop}
      onShare={noop}
      models={{ coach: "gpt-6.1-sol", image: "gpt-image-2.5-flare" }}
    />
  );
}

function Block({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <Eyebrow className="mb-3">{title}</Eyebrow>
      {children}
    </section>
  );
}

const AI_STATES: AiPhotoState[] = ["idle", "generating", "verifying", "failed", "done"];

function Components() {
  const [skel, setSkel] = useState(true);
  const [ghost, setGhost] = useState(true);
  const [voice, setVoice] = useState(false);
  const [trace, setTrace] = useState(false);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-10">
      <Block title="Provider badges">
        <div className="flex flex-wrap gap-2">
          {(["cosmos", "nemotron", "NVIDIA video AI", "NVIDIA video AI · cached", "gpt-fallback", "pose-only", "demo", "MediaPipe", "OpenAI GPT", "GPT Image", "rules"] as const).map((p) => (
            <ProviderBadge key={p} provider={p} />
          ))}
          <ProviderBadge provider="cosmos" model="nvidia/cosmos-reason2-8b" size="md" />
        </div>
      </Block>
      <div className="grid gap-8 lg:grid-cols-4">
        <Block title="BeforeAfter · AI photo slider">
          <BeforeAfter beforeImage={MOCK_BEFORE_IMG} afterImage={MOCK_AFTER_IMG} beforePose={mockBeforePose} afterPose={mockAfterPose} angles={mockAngles} verifyAngles={mockVerify.angles} width={MOCK_W} height={MOCK_H} showSkeleton={skel} verifyPassed momentT={7} maxHeight="560px" />
        </Block>
        <Block title="BeforeAfter · your frame + target ghost">
          <BeforeAfter beforeImage={MOCK_BEFORE_IMG} beforePose={mockBeforePose} angles={mockAngles} width={MOCK_W} height={MOCK_H} showSkeleton={skel} showGhost={ghost} ghostPoints={mockGhostPoints} momentT={7} maxHeight="560px" />
        </Block>
        <Block title="BeforeAfter · generating AI photo">
          <BeforeAfter beforeImage={MOCK_BEFORE_IMG} beforePose={mockBeforePose} angles={mockAngles} width={MOCK_W} height={MOCK_H} showSkeleton={skel} pending momentT={7} maxHeight="560px" />
        </Block>
        <Block title="PoseOverlay · landscape box (slice)">
          <MediaFrame width={16} height={10} maxHeight="560px">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MOCK_BEFORE_IMG} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <PoseOverlay pose={mockBeforePose} angles={mockAngles} preserveAspectRatio="xMidYMid slice" />
          </MediaFrame>
        </Block>
      </div>
      <Block title="AI photo panel · every state">
        <div className="grid gap-3">
          {AI_STATES.map((s) => (
            <AiPhotoPanel
              key={s}
              state={s}
              exercise="pull_up"
              hasAfter={s === "done"}
              error={s === "failed" ? "The image model timed out after 60 s." : undefined}
              showGhost={ghost}
              onToggleGhost={() => setGhost((g) => !g)}
              canGhost
              onGenerate={noop}
              verifyLine={s === "done" ? "Elbow at top 98° → 62° ✓" : undefined}
              verifyPassed
            />
          ))}
        </div>
      </Block>
      <div className="grid gap-8 lg:grid-cols-3">
        <Block title="Verdict · done">
          <VerdictCard score={60} measured={64} headline={mockCoach.headline} counts={{ bad: 3, borderline: 1, good: 2 }} coachText={mockCoach.spoken_summary} coach={mockCoach} coachProvider="OpenAI GPT" voiceOn={voice} onToggleVoice={() => setVoice((v) => !v)} />
        </Block>
        <Block title="Verdict · streaming">
          <VerdictCard score={64} measured={64} grade="C" headline="Fix your elbow at top" coachText={mockCoach.spoken_summary.slice(0, 120)} streaming coachProvider="OpenAI GPT" onToggleVoice={noop} />
        </Block>
        <Block title="Verdict · rule-based fallback">
          <VerdictCard score={64} measured={64} headline="Finish the pull: elbows to ribs" coachText={mockCoach.spoken_summary} coach={mockCoach} fallback coachProvider="rules" onRetryCoach={noop} onToggleVoice={noop} />
        </Block>
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <Block title="Stepper · live (scanning)">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <PipelineStepper steps={mockSteps("scanning")} />
          </div>
        </Block>
        <Block title="Stepper · live (coaching, scan fallback)">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <PipelineStepper steps={mockSteps("coaching", "scanFallback")} />
          </div>
        </Block>
        <Block title="Stepper · compact summary">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <PipelineStepper steps={mockSteps("done")} compact />
          </div>
        </Block>
      </div>
      <Block title="Angle cards">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          {mockAngles.map((m, i) => (
            <AngleCard key={m.key} m={m} after={mockVerify.angles.find((a) => a.key === m.key)} index={i} />
          ))}
          <AngleCardSkeleton />
        </div>
      </Block>
      <Block title="Angle cards · wide (container query)">
        <div className="grid gap-4 md:grid-cols-2">
          {mockAngles.slice(0, 2).map((m, i) => (
            <AngleCard key={m.key} m={m} index={i} />
          ))}
        </div>
      </Block>
      <Block title="Filmstrip · scanning + timeline">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <ScanVisualizer frames={mockFrames} stage="scanning" duration={MOCK_DURATION} />
          <div className="h-4" />
          <ScanVisualizer frames={mockFrames} stage="done" duration={MOCK_DURATION} events={mockScan.events} chosenT={7} />
          <VideoTimeline duration={MOCK_DURATION} events={mockScan.events} chosen={mockMoment} currentTime={5.2} onSeek={noop} />
        </div>
      </Block>
      <div className="grid gap-8 lg:grid-cols-2">
        <Block title="Found banner">
          <div className="space-y-4 rounded-2xl border border-line bg-surface-2 p-5">
            <FoundBanner moment={mockMoment} />
            <FoundBanner moment={mockMoment} variant="bar" />
          </div>
        </Block>
        <Block title="Skeleton toggle">
          <button type="button" onClick={() => setSkel((s) => !s)} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-text">
            Skeleton: {skel ? "on" : "off"}
          </button>
        </Block>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <Block title="ErrorState">
          <div className="rounded-2xl border border-line bg-surface">
            <ErrorState error={{ code: "no_person", message: "No pose with ≥0.5 visibility on 3 candidate frames." }} onPickOtherMoment={noop} onRetry={noop} onStartOver={noop} />
          </div>
        </Block>
        <Block title="EmptyState">
          <div className="rounded-2xl border border-line bg-surface">
            <EmptyState />
          </div>
        </Block>
      </div>
      <Block title="Agent trace">
        <button type="button" onClick={() => setTrace(true)} className="rounded-lg border border-nvidia/40 px-3 py-2 text-sm text-[#9be22d]">
          Open agent trace
        </button>
      </Block>
      <AgentTrace open={trace} onOpenChange={setTrace} trace={mockTrace} scan={mockScan} moment={mockMoment} />
    </div>
  );
}

export function Gallery({ stage }: { stage?: string }) {
  const entry = GALLERY_STAGES.find((s) => s.id === stage);
  if (entry) return <StageView key={entry.id} stage={entry.stage} variant={entry.variant} />;
  return (
    <div>
      <nav className="sticky top-0 z-50 flex flex-wrap items-center gap-2 border-b border-line bg-bg/90 px-6 py-3 backdrop-blur" aria-label="Gallery stages">
        <span className="mr-2 font-display text-lg uppercase text-volt">Gallery</span>
        {GALLERY_STAGES.map((s) => (
          <Link key={s.id} href={`/dev/gallery?stage=${s.id}`} className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-text hover:border-volt/50">
            {s.id}
          </Link>
        ))}
      </nav>
      <Components />
    </div>
  );
}
