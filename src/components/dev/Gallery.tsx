"use client";
// Dev gallery: AnalyzeView at every stage (?stage=…) and every component standalone (?stage=components).
import { useState } from "react";
import Link from "next/link";
import type { Stage } from "@/lib/types";
import { AnalyzeView } from "@/components/analyze/AnalyzeView";
import { PipelineStepper } from "@/components/pipeline/PipelineStepper";
import { ScanVisualizer } from "@/components/pipeline/ScanVisualizer";
import { FoundBanner } from "@/components/pipeline/FoundBanner";
import { BeforeAfter } from "@/components/results/BeforeAfter";
import { PoseOverlay } from "@/components/results/PoseOverlay";
import { MediaFrame } from "@/components/results/MediaFrame";
import { AngleCard, AngleCardSkeleton } from "@/components/results/AngleCard";
import { FormScore } from "@/components/results/FormScore";
import { CoachPanel } from "@/components/results/CoachPanel";
import { VideoTimeline } from "@/components/results/VideoTimeline";
import { AgentTrace } from "@/components/results/AgentTrace";
import { ShareBar } from "@/components/results/ShareBar";
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
  { id: "picking", stage: "picking" },
  { id: "posing", stage: "posing" },
  { id: "coaching", stage: "coaching" },
  { id: "correcting", stage: "correcting" },
  { id: "verifying", stage: "verifying" },
  { id: "done", stage: "done" },
  { id: "error", stage: "error" },
  { id: "afterFailed", stage: "done", variant: "afterFailed" },
  { id: "coachFallback", stage: "done", variant: "coachFallback" },
  { id: "scanFallback", stage: "done", variant: "scanFallback" },
  { id: "demo", stage: "coaching", variant: "demo" },
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
      onRetryCorrect={noop}
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

function Components() {
  const [skel, setSkel] = useState(true);
  const [voice, setVoice] = useState(false);
  const [trace, setTrace] = useState(false);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-10">
      <Block title="ShareBar">
        <ShareBar showSkeleton={skel} onToggleSkeleton={() => setSkel((s) => !s)} onDownload={noop} onShare={noop} onOpenTrace={() => setTrace(true)} />
      </Block>
      <Block title="Provider badges">
        <div className="flex flex-wrap gap-2">
          {(["cosmos", "nemotron", "gpt-fallback", "pose-only", "demo", "MediaPipe", "OpenAI GPT", "GPT Image", "rules"] as const).map((p) => (
            <ProviderBadge key={p} provider={p} />
          ))}
          <ProviderBadge provider="cosmos" model="nvidia/cosmos-reason2-8b" size="md" />
        </div>
      </Block>
      <div className="grid gap-8 lg:grid-cols-4">
        <Block title="BeforeAfter · slider">
          <BeforeAfter beforeImage={MOCK_BEFORE_IMG} afterImage={MOCK_AFTER_IMG} beforePose={mockBeforePose} afterPose={mockAfterPose} angles={mockAngles} verifyAngles={mockVerify.angles} width={MOCK_W} height={MOCK_H} showSkeleton={skel} verifyPassed momentT={7} exercise="pull_up" maxHeight="560px" />
        </Block>
        <Block title="BeforeAfter · generating">
          <BeforeAfter beforeImage={MOCK_BEFORE_IMG} beforePose={mockBeforePose} angles={mockAngles} width={MOCK_W} height={MOCK_H} showSkeleton={skel} pending momentT={7} exercise="pull_up" maxHeight="560px" />
        </Block>
        <Block title="BeforeAfter · ghost fallback (computed)">
          <BeforeAfter beforeImage={MOCK_BEFORE_IMG} beforePose={mockBeforePose} angles={mockAngles} width={MOCK_W} height={MOCK_H} showSkeleton={skel} afterFailed momentT={7} exercise="pull_up" onRetryCorrect={noop} maxHeight="560px" />
        </Block>
        <Block title="PoseOverlay · landscape box (slice)">
          <MediaFrame width={16} height={10} maxHeight="560px">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MOCK_BEFORE_IMG} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <PoseOverlay pose={mockBeforePose} angles={mockAngles} preserveAspectRatio="xMidYMid slice" />
          </MediaFrame>
        </Block>
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <Block title="FormScore · done">
          <FormScore score={60} measured={64} adjustment={-4} headline={mockCoach.headline} counts={{ bad: 3, borderline: 1, good: 2 }} afterScore={92} />
        </Block>
        <Block title="FormScore · loading">
          <FormScore loading />
        </Block>
        <Block title="Stepper · coaching">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <PipelineStepper steps={mockSteps("coaching", "scanFallback")} />
          </div>
        </Block>
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <Block title="CoachPanel · streaming">
          <CoachPanel text={mockCoach.spoken_summary.slice(0, 120)} streaming voiceOn={voice} onToggleVoice={() => setVoice((v) => !v)} />
        </Block>
        <Block title="CoachPanel · waiting">
          <CoachPanel text="" waiting onToggleVoice={noop} />
        </Block>
        <Block title="CoachPanel · fallback">
          <CoachPanel text={mockCoach.spoken_summary} coach={mockCoach} fallback onRetry={noop} onToggleVoice={noop} />
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
        <Block title="Ghost overlay (integrator ghostPoints)">
          <MediaFrame width={MOCK_W} height={MOCK_H} maxHeight="420px">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MOCK_BEFORE_IMG} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <PoseOverlay points={mockGhostPoints} width={MOCK_W} height={MOCK_H} variant="ghost" showArcs={false} />
          </MediaFrame>
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
