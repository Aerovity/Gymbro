"use client";
// 3D form replay: your rep vs the corrected rep on animated studio mannequins.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Pause, Play, Rotate3d, Columns2, Layers } from "lucide-react";
import { Mannequin } from "./Mannequin";
import { LM } from "@/lib/pose/landmarks";
import { prepare3D, sampleSequence, lerpPose, type Prepared3D, type RepFrame, type V3 } from "@/lib/pose3d/skeleton3d";
import type { AngleReport, ExerciseId, Landmark } from "@/lib/types";
import { cn } from "@/lib/utils";

type Layout = "split" | "overlay";
type CamPreset = "front" | "side" | "34";

export interface Form3DViewProps {
  repFrames?: RepFrame[];
  world?: Landmark[];
  report: AngleReport;
  tMoment: number;
  exercise: ExerciseId;
  className?: string;
  height?: string;
}

/** Shared playback clock: advanced in the render loop, read by the HUD via rAF (never React state). */
class PlaybackClock {
  t = 0;
  playing = true;
  speed = 1;
  t0 = 0;
  t1 = 0;
  morph = 0; // single-frame mode: 0 = you, 1 = target
  configure(t0: number, t1: number) {
    this.t0 = t0;
    this.t1 = t1;
    this.t = t0;
  }
  setPlayback(playing: boolean, speed: number) {
    this.playing = playing;
    this.speed = speed;
  }
  seek(t: number) {
    this.t = t;
  }
  advance(dt: number, single: boolean) {
    if (!this.playing) return;
    if (single) {
      this.morph = 0.5 - 0.5 * Math.cos(performance.now() / 900);
      return;
    }
    this.t += dt * this.speed;
    if (this.t > this.t1 + 0.35) this.t = this.t0; // short hold at the end of the rep
  }
}

const SPLIT = 0.62; // half distance between the two mannequins (m)

type Off = [number, number, number];
/** Where "you" and "target" stand: split across the screen for the chosen camera. */
function offsetsFor(layout: Layout, preset: CamPreset): { you: Off; target: Off } {
  if (layout === "overlay") return { you: [0, 0, 0], target: [0, 0, 0] };
  if (preset === "side") return { you: [0, 0, SPLIT], target: [0, 0, -SPLIT] };
  return { you: [-SPLIT, 0, 0], target: [SPLIT, 0, 0] };
}

const CAMS: Record<CamPreset, [number, number, number]> = {
  front: [0, 1.15, 3.6],
  side: [3.6, 1.15, 0.01],
  "34": [2.6, 1.55, 2.6],
};

function primaryLabel(report: AngleReport): { you: string; target: string } | null {
  const v = report.violations[0];
  if (!v) return null;
  const unit = report.angles.find((a) => a.key === v.angleKey)?.unit ?? "°";
  const fmt = (n: number) => (unit === "°" ? `${Math.round(n)}°` : n.toFixed(2));
  const bound = v.target.max !== undefined ? `≤${fmt(v.target.max)}` : v.target.min !== undefined ? `≥${fmt(v.target.min)}` : fmt(v.target.ideal);
  return { you: `${v.label}: ${fmt(v.actual)}`, target: `${v.label}: ${bound} ✓` };
}

function CameraRig({ preset, nonce, layout, focusY, height }: { preset: CamPreset; nonce: number; layout: Layout; focusY: number; height: number }) {
  const { camera, controls, size } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: OrbitControlsImpl | null;
    size: { width: number; height: number };
  };
  const goal = useRef<THREE.Vector3 | null>(null);
  const aspect = size.width / Math.max(size.height, 1);
  useEffect(() => {
    // Fit the stage width: two mannequins need ~2.5 m across, one needs ~1.4 m.
    const needW = layout === "split" ? 2.7 : 1.5;
    const needH = height + 1.0; // room for the top and bottom HUD bars
    const vfov = (38 * Math.PI) / 180;
    const distH = needH / (2 * Math.tan(vfov / 2));
    const distW = needW / (2 * Math.tan(vfov / 2) * aspect);
    const dist = Math.max(distH, distW, 2.4);
    const base = new THREE.Vector3(...CAMS[preset]).sub(new THREE.Vector3(0, 0.95, 0)).normalize();
    goal.current = base.multiplyScalar(dist).add(new THREE.Vector3(0, focusY, 0));
  }, [preset, nonce, layout, aspect, focusY, height]);
  useFrame(() => {
    if (!goal.current) return;
    camera.position.lerp(goal.current, 0.08);
    controls?.target.lerp(new THREE.Vector3(0, focusY, 0), 0.08);
    controls?.update();
    if (camera.position.distanceTo(goal.current) < 0.01) goal.current = null;
  });
  return null;
}

function Playback({ clock, single }: { clock: PlaybackClock; single: boolean }) {
  useFrame((_, dt) => clock.advance(dt, single));
  return null;
}

function PullUpBar({ prepared, at }: { prepared: Prepared3D; at: Off }) {
  // Bar height = highest wrist position across your rep (hands grip the bar).
  const y = useMemo(() => {
    let max = -Infinity;
    for (const f of prepared.you) max = Math.max(max, f[LM.L_WRIST][1], f[LM.R_WRIST][1]);
    return max + 0.035;
  }, [prepared]);
  const width = 1.1;
  const strut = 0.9;
  return (
    <group position={[at[0], y, at[2]]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, width, 20]} />
        <meshStandardMaterial color="#c3ccd6" metalness={0.95} roughness={0.2} />
      </mesh>
      {[-width / 2, width / 2].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, strut / 2, 0]}>
            <boxGeometry args={[0.05, strut, 0.05]} />
            <meshStandardMaterial color="#1a212b" metalness={0.6} roughness={0.45} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.032, 16, 12]} />
            <meshStandardMaterial color="#c6ff3d" emissive="#c6ff3d" emissiveIntensity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

interface LabelRefs {
  you: React.RefObject<HTMLDivElement | null>;
  target: React.RefObject<HTMLDivElement | null>;
  fault: React.RefObject<HTMLDivElement | null>;
}

/** Projects 3D anchors to screen space every frame and moves plain DOM chips (no nested React roots). */
function LabelProjector({ prepared, layout, offs, getYou, refs }: { prepared: Prepared3D; layout: Layout; offs: { you: Off; target: Off }; getYou: () => V3[] | null; refs: LabelRefs }) {
  const { camera, size } = useThree();
  // Name plates sit on the stage floor under each mannequin (clear of the HUD and the bar).
  const top = -0.14;
  const v = useMemo(() => new THREE.Vector3(), []);
  const place = (el: HTMLDivElement | null, x: number, y: number, z: number, dx = 0) => {
    if (!el) return;
    v.set(x, y, z).project(camera);
    const visible = v.z < 1;
    const sx = ((v.x + 1) / 2) * size.width + dx;
    // Keep chips clear of the top controls and the bottom playback bar.
    const sy = Math.min(Math.max(((1 - v.y) / 2) * size.height, 70), size.height - 112);
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
    el.style.visibility = visible ? "visible" : "hidden";
  };
  useFrame(() => {
    const split = layout === "split";
    place(refs.you.current, offs.you[0], top, offs.you[2], split ? 0 : -46);
    place(refs.target.current, offs.target[0], top, offs.target[2], split ? 0 : 58);
    const p = getYou();
    const j = prepared.faultJoints[0];
    if (p && j !== undefined) place(refs.fault.current, p[j][0] + offs.you[0], p[j][1] + 0.3, p[j][2] + offs.you[2]);
  });
  return null;
}

function Stage() {
  return (
    <>
      <color attach="background" args={["#07090c"]} />
      <fog attach="fog" args={["#07090c", 5.5, 11]} />
      <hemisphereLight args={["#a9bfd6", "#0b0e12", 0.55]} />
      <directionalLight position={[2.5, 4.5, 3.5]} intensity={1.55} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-2.6, 2.2, -1.8]} intensity={9} color="#2ee6ff" distance={7} />
      <pointLight position={[2.6, 2.4, -1.6]} intensity={7} color="#c6ff3d" distance={7} />
      <spotLight position={[0, 5.5, 0.5]} angle={0.55} penumbra={0.9} intensity={18} color="#ffffff" distance={9} />
      {/* Stage disc + grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <circleGeometry args={[2.4, 64]} />
        <meshStandardMaterial color="#0d1218" roughness={0.85} metalness={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[2.36, 2.4, 96]} />
        <meshBasicMaterial color="#c6ff3d" transparent opacity={0.45} />
      </mesh>
      <Grid
        position={[0, 0.002, 0]}
        args={[12, 12]}
        cellSize={0.25}
        cellThickness={0.6}
        cellColor="#1b2430"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#2b3a48"
        fadeDistance={9}
        fadeStrength={1.6}
        infiniteGrid
      />
      <ContactShadows position={[0, 0.003, 0]} opacity={0.55} scale={6} blur={2.4} far={3} />
    </>
  );
}

function Scene({ prepared, layout, preset, nonce, autoRotate, clock, exercise, labelRefs, onUserInteract }: {
  prepared: Prepared3D;
  layout: Layout;
  preset: CamPreset;
  nonce: number;
  autoRotate: boolean;
  clock: PlaybackClock;
  exercise: ExerciseId;
  labelRefs: LabelRefs;
  onUserInteract: () => void;
}) {
  const single = prepared.you.length === 1;
  const getYou = () => (single ? prepared.you[0] : sampleSequence(prepared.you, prepared.times, clock.t));
  const getTarget = () =>
    single
      ? layout === "overlay"
        ? lerpPose(prepared.you[0], prepared.target[0], clock.morph)
        : prepared.target[0]
      : sampleSequence(prepared.target, prepared.times, clock.t);
  const split = layout === "split";
  const offs = offsetsFor(layout, preset);
  const { focusY, height } = useMemo(() => {
    let max = 0;
    for (const f of [...prepared.you, ...prepared.target]) for (const p of f) max = Math.max(max, p[1]);
    return { focusY: max / 2, height: max };
  }, [prepared]);
  return (
    <>
      <Stage />
      <Playback clock={clock} single={single} />
      <CameraRig preset={preset} nonce={nonce} layout={layout} focusY={focusY} height={height} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={1.6}
        maxDistance={9}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2 - 0.04}
        autoRotate={autoRotate}
        autoRotateSpeed={0.9}
        target={[0, focusY, 0]}
        onStart={onUserInteract}
      />
      {exercise === "pull_up" && <PullUpBar prepared={prepared} at={offs.you} />}
      {exercise === "pull_up" && split && <PullUpBar prepared={prepared} at={offs.target} />}
      <Mannequin getPose={getYou} variant="you" faultJoints={prepared.faultJoints} offset={offs.you} />
      <Mannequin getPose={getTarget} variant={split ? "target" : "ghost"} offset={offs.target} />
      <LabelProjector prepared={prepared} layout={layout} offs={offs} getYou={getYou} refs={labelRefs} />
    </>
  );
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { v: T; label: React.ReactNode; title: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-line/80 bg-bg/70 p-1 backdrop-blur-md">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          title={o.title}
          onClick={() => onChange(o.v)}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors",
            value === o.v ? "bg-volt text-bg" : "text-dim hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Form3DView({ repFrames, world, report, tMoment, exercise, className, height = "min(74vh, 820px)" }: Form3DViewProps) {
  const prepared = useMemo(() => prepare3D(repFrames, world, report, tMoment), [repFrames, world, report, tMoment]);
  const single = (prepared?.you.length ?? 0) <= 1;
  const [layout, setLayout] = useState<Layout>("split");
  const [preset, setPreset] = useState<CamPreset>(exercise === "pull_up" ? "34" : "side");
  const [nonce, setNonce] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [clock] = useState(() => new PlaybackClock());
  const scrub = useRef<HTMLInputElement>(null);
  const timeLabel = useRef<HTMLSpanElement>(null);
  const labels = useMemo(() => primaryLabel(report), [report]);
  const youLabel = useRef<HTMLDivElement>(null);
  const targetLabel = useRef<HTMLDivElement>(null);
  const faultLabel = useRef<HTMLDivElement>(null);
  const labelRefs = useMemo<LabelRefs>(() => ({ you: youLabel, target: targetLabel, fault: faultLabel }), []);
  const chip = "pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] backdrop-blur-md will-change-transform";

  useEffect(() => {
    if (!prepared) return;
    const t0 = prepared.times[0];
    const t1 = prepared.times[prepared.times.length - 1];
    clock.configure(t0, t1);
  }, [prepared, clock]);
  useEffect(() => clock.setPlayback(playing, speed), [playing, speed, clock]);

  // HUD sync at display rate without React re-renders.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const c = clock;
      if (scrub.current && !single) scrub.current.value = String(Math.min(c.t, c.t1));
      if (timeLabel.current) {
        const t = single ? tMoment : Math.min(c.t, c.t1);
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        timeLabel.current.textContent = `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [single, tMoment, clock]);

  if (!prepared) {
    return (
      <div className={cn("flex items-center justify-center rounded-2xl border border-line bg-surface text-sm text-dim", className)} style={{ height }}>
        3D pose not available for this frame.
      </div>
    );
  }

  const momentPct = single ? 0 : ((tMoment - prepared.times[0]) / (prepared.times[prepared.times.length - 1] - prepared.times[0] || 1)) * 100;

  return (
    <div data-testid="form-3d" className={cn("relative overflow-hidden rounded-2xl border border-line bg-bg", className)} style={{ height }}>
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: CAMS[preset], fov: 38, near: 0.05, far: 40 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
        <Scene
          prepared={prepared}
          layout={layout}
          preset={preset}
          nonce={nonce}
          autoRotate={autoRotate}
          clock={clock}
          exercise={exercise}
          labelRefs={labelRefs}
          onUserInteract={() => setAutoRotate(false)}
        />
      </Canvas>

      {/* Projected 3D labels */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={youLabel} className={cn(chip, "border-signal/50 bg-bg/70 text-signal")} style={{ visibility: "hidden" }}>● You</div>
        <div ref={targetLabel} className={cn(chip, "border-volt/50 bg-bg/70 text-volt")} style={{ visibility: "hidden" }}>
          ◆ {layout === "split" ? "Target form" : "Target ghost"}
        </div>
        {labels && prepared.faultJoints.length > 0 && (
          <div ref={faultLabel} className={cn(chip, "border-signal/60 bg-signal/15 text-signal shadow-[0_0_18px_rgba(255,59,92,0.35)]")} style={{ visibility: "hidden" }}>
            {labels.you}
          </div>
        )}
      </div>

      {/* Broadcast chrome */}
      <div aria-hidden className="pointer-events-none absolute inset-3">
        {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "left-0 bottom-0 border-b-2 border-l-2", "right-0 bottom-0 border-b-2 border-r-2"].map((c) => (
          <span key={c} className={cn("absolute size-5 border-text/40", c)} />
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-bg/80 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-bg/90 to-transparent" />

      {/* Top HUD */}
      <div className="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3 sm:p-4">
        <div className="flex items-center gap-2">

          <Seg<Layout>
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { v: "split", label: <><Columns2 className="size-3.5" aria-hidden /><span className="hidden 2xl:inline">Side by side</span><span className="2xl:hidden">Split</span></>, title: "You and the target side by side" },
              { v: "overlay", label: <><Layers className="size-3.5" aria-hidden />Ghost</>, title: "Target as a ghost over you" },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Seg<CamPreset>
            label="Camera"
            value={preset}
            onChange={(p) => {
              setPreset(p);
              setNonce((n) => n + 1);
              setAutoRotate(false);
            }}
            options={[
              { v: "front", label: "Front", title: "Front camera" },
              { v: "side", label: "Side", title: "Side camera" },
              { v: "34", label: "¾", title: "Three-quarter camera" },
            ]}
          />
          <button
            type="button"
            aria-pressed={autoRotate}
            title="Auto-rotate"
            onClick={() => setAutoRotate((a) => !a)}
            className={cn(
              "inline-flex size-10 cursor-pointer items-center justify-center rounded-xl border backdrop-blur-md transition-colors",
              autoRotate ? "border-volt/60 bg-volt/15 text-volt" : "border-line/80 bg-bg/70 text-dim hover:text-text",
            )}
          >
            <Rotate3d className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Bottom HUD: playback */}
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="flex items-center gap-3 rounded-xl border border-line/80 bg-bg/75 p-2 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause replay" : "Play replay"}
            className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-volt text-bg transition-transform active:scale-95"
          >
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </button>
          {single ? (
            <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
              {layout === "overlay" ? "Morphing your pose into the target" : "Single frame · switch to Ghost to morph"}
            </span>
          ) : (
            <div className="relative flex-1">
              <input
                ref={scrub}
                type="range"
                aria-label="Scrub the rep"
                min={prepared.times[0]}
                max={prepared.times[prepared.times.length - 1]}
                step={0.01}
                defaultValue={prepared.times[0]}
                onPointerDown={() => setPlaying(false)}
                onChange={(e) => clock.seek(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-volt"
              />
              <span
                aria-hidden
                title="Flagged moment"
                className="pointer-events-none absolute -top-1 h-4 w-0.5 rounded-full bg-signal shadow-[0_0_10px_rgba(255,59,92,0.8)]"
                style={{ left: `${Math.max(0, Math.min(100, momentPct))}%` }}
              />
            </div>
          )}
          <span ref={timeLabel} className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-text">0:00.0</span>
          {!single && (
            <button
              type="button"
              onClick={() => setSpeed((s) => (s === 1 ? 0.5 : s === 0.5 ? 0.25 : 1))}
              aria-label={`Playback speed ${speed}x`}
              className="inline-flex h-10 w-14 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line font-mono text-[12px] font-semibold text-text hover:bg-surface-3"
            >
              {speed}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
