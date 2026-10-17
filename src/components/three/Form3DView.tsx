"use client";
// 3D form replay: your rep vs the corrected rep on animated studio mannequins.
// The stage adapts to the body: hanging (pull-up bar) or horizontal (push-up on a mat). Cameras are
// relative to the body's own axes, and the fit uses the rep's real 3D extent plus the HUD's size.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Grid, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Pause, Play, Rotate3d, Columns2, Layers } from "lucide-react";
import { Mannequin } from "./Mannequin";
import { BODY_POINTS, FOV, buildStage, planStage, type BarProp, type CamPreset, type Layout, type MatProp, type Plan, type StageModel } from "./stage";
import { prepare3D, sampleSequence, lerpPose, type RepFrame, type V3 } from "@/lib/pose3d/skeleton3d";
import type { AngleReport, ExerciseId, Landmark } from "@/lib/types";
import { cn } from "@/lib/utils";

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

interface PoseSource {
  you: () => V3[];
  target: () => V3[];
}

/** Pose getters sampled at most once per clock tick (the mannequins and the labels share them). */
function poseSource(model: StageModel, clock: PlaybackClock, layout: Layout): PoseSource {
  const single = model.you.length === 1;
  let tYou = NaN;
  let tTarget = NaN;
  let you = model.you[0];
  let target = model.target[0];
  return {
    you: () => {
      if (single) return model.you[0];
      if (clock.t !== tYou) {
        tYou = clock.t;
        you = sampleSequence(model.you, model.times, clock.t);
      }
      return you;
    },
    target: () => {
      if (single) {
        if (layout !== "overlay") return model.target[0];
        if (clock.morph !== tTarget) {
          tTarget = clock.morph;
          target = lerpPose(model.you[0], model.target[0], clock.morph);
        }
        return target;
      }
      if (clock.t !== tTarget) {
        tTarget = clock.t;
        target = sampleSequence(model.target, model.times, clock.t);
      }
      return target;
    },
  };
}

function primaryLabel(report: AngleReport): { you: string; target: string } | null {
  const v = report.violations[0];
  if (!v) return null;
  const unit = report.angles.find((a) => a.key === v.angleKey)?.unit ?? "°";
  const fmt = (n: number) => (unit === "°" ? `${Math.round(n)}°` : n.toFixed(2));
  const bound = v.target.max !== undefined ? `≤${fmt(v.target.max)}` : v.target.min !== undefined ? `≥${fmt(v.target.min)}` : fmt(v.target.ideal);
  return { you: `${v.label}: ${fmt(v.actual)}`, target: `${v.label} ${bound}` };
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Glides the camera to the plan; gentle orbit sway when auto-rotate is on. User drags cancel both. */
function CameraRig({ plan, nonce, autoRotate }: { plan: Plan; nonce: number; autoRotate: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const goal = useRef<{ pos: THREE.Vector3; focus: THREE.Vector3; snap: boolean } | null>(null);
  const mountedAt = useRef<number | null>(null);
  const sway = useRef<{ base: THREE.Vector3; t0: number } | null>(null);

  useEffect(() => {
    // Snap while the stage is settling (first plan, HUD measured a moment later); glide afterwards.
    const now = performance.now();
    mountedAt.current ??= now;
    goal.current = { pos: new THREE.Vector3(...plan.position), focus: new THREE.Vector3(...plan.focus), snap: now - mountedAt.current < 700 };
    sway.current = null;
  }, [plan, nonce]);

  // Centre the projection on the band between the HUD bars (they are not the same height).
  const shift = Math.round((plan.bottom - plan.top) / 2);
  useEffect(() => {
    camera.setViewOffset(width, height, 0, shift, width, height);
    camera.updateProjectionMatrix();
    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, width, height, shift]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      goal.current = null;
      sway.current = null;
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((state, dt) => {
    const g = goal.current;
    if (g) {
      if (!controls) {
        camera.position.copy(g.pos);
        camera.lookAt(g.focus);
        return;
      }
      const k = g.snap ? 1 : 1 - Math.exp(-dt * 5);
      camera.position.lerp(g.pos, k);
      controls.target.lerp(g.focus, k);
      controls.update();
      if (camera.position.distanceToSquared(g.pos) < 1e-5) goal.current = null;
      return;
    }
    if (autoRotate && controls) {
      const t = state.clock.elapsedTime;
      if (!sway.current) sway.current = { base: camera.position.clone().sub(controls.target), t0: t };
      const a = 0.42 * Math.sin((t - sway.current.t0) * 0.4);
      camera.position.copy(sway.current.base).applyAxisAngle(Y_AXIS, a).add(controls.target);
      controls.update();
    } else if (sway.current) {
      sway.current = null;
    }
  });
  return null;
}

function Playback({ clock, single }: { clock: PlaybackClock; single: boolean }) {
  useFrame((_, dt) => clock.advance(dt, single));
  return null;
}

interface Live {
  you: THREE.Vector3;
  target: THREE.Vector3;
}

/** Slides the stations to the plan's offsets (snaps on a new rep). */
function OffsetAnimator({ live, plan, model }: { live: Live; plan: Plan; model: StageModel }) {
  const seen = useRef<StageModel | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const k = seen.current === model ? 1 - Math.exp(-dt * 7) : 1;
    seen.current = model;
    live.you.lerp(tmp.set(...plan.you), k);
    live.target.lerp(tmp.set(...plan.target), k);
  });
  return null;
}

function Station({ live, which, children }: { live: Live; which: keyof Live; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    group.current?.position.copy(live[which]);
  });
  return <group ref={group}>{children}</group>;
}

function PullUpBar({ bar }: { bar: BarProp }) {
  const strut = 0.9;
  return (
    <group position={[bar.centre[0], bar.y, bar.centre[2]]} rotation={[0, bar.yaw, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, bar.width, 20]} />
        <meshStandardMaterial color="#c3ccd6" metalness={0.95} roughness={0.2} />
      </mesh>
      {[-bar.width / 2, bar.width / 2].map((x) => (
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

function roundedRect(l: number, w: number, r: number) {
  const s = new THREE.Shape();
  const x = -l / 2;
  const y = -w / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + l - r, y);
  s.quadraticCurveTo(x + l, y, x + l, y + r);
  s.lineTo(x + l, y + w - r);
  s.quadraticCurveTo(x + l, y + w, x + l - r, y + w);
  s.lineTo(x + r, y + w);
  s.quadraticCurveTo(x, y + w, x, y + w - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Training mat under the floor contacts; when raised it doubles as the target's display plate. */
function FloorMat({ mat, raised = false }: { mat: MatProp; raised?: boolean }) {
  const shape = useMemo(() => roundedRect(mat.length, mat.width, 0.07), [mat.length, mat.width]);
  // Outline in the mat's local XZ plane (shape y → −z after the −90° X rotation).
  const outline = useMemo(() => shape.getPoints(6).map((p) => [p.x, 0, -p.y] as [number, number, number]), [shape]);
  return (
    <group position={[mat.centre[0], 0, mat.centre[2]]} rotation={[0, mat.yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <shapeGeometry args={[shape, 6]} />
        <meshStandardMaterial color={raised ? "#101820" : "#111820"} roughness={0.9} metalness={0.05} transparent={raised} opacity={raised ? 0.92 : 1} />
      </mesh>
      <Line points={outline} position={[0, 0.006, 0]} color={raised ? "#c6ff3d" : "#2f4050"} lineWidth={raised ? 1.6 : 1.2} transparent opacity={raised ? 0.75 : 0.9} />
      {raised && (
        <mesh position={[0, -0.016, 0]}>
          <boxGeometry args={[mat.length + 0.06, 0.03, mat.width + 0.06]} />
          <meshStandardMaterial color="#0a0f14" roughness={0.6} metalness={0.3} transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  );
}

interface LabelRefs {
  you: React.RefObject<HTMLDivElement | null>;
  target: React.RefObject<HTMLDivElement | null>;
  fault: React.RefObject<HTMLDivElement | null>;
  leader: React.RefObject<SVGLineElement | null>;
  dot: React.RefObject<SVGCircleElement | null>;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const rectC = (cx: number, cy: number, w: number, h: number): Rect => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const outside = (r: Rect, safe: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0) - overlap(r, safe);
function clampRect(r: Rect, safe: Rect): Rect {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const x0 = Math.min(Math.max(r.x0, safe.x0), Math.max(safe.x0, safe.x1 - w));
  const y0 = Math.min(Math.max(r.y0, safe.y0), Math.max(safe.y0, safe.y1 - h));
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}
function show(el: HTMLElement, r: Rect | null) {
  if (!r) {
    el.style.visibility = "hidden";
    return;
  }
  el.style.transform = `translate(${r.x0.toFixed(1)}px, ${r.y0.toFixed(1)}px)`;
  el.style.visibility = "visible";
}
const V = new THREE.Vector3();

/**
 * Projects the stations to screen space every frame and moves plain DOM chips (no nested React roots):
 * name plates under (or, for a stacked target, above) each body and a fault callout with a leader line
 * that picks the free spot around the faulty joint. Everything stays inside the band between the HUD bars.
 */
function LabelProjector({ model, plan, live, poses, refs, hud }: { model: StageModel; plan: Plan; live: Live; poses: PoseSource; refs: LabelRefs; hud: { top: number; bottom: number } }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const st = useRef({ cand: -1, cx: NaN, cy: NaN });

  useFrame(() => {
    const W = size.width;
    const H = size.height;
    const safe: Rect = { x0: 10, y0: hud.top + 4, x1: W - 10, y1: H - hud.bottom - 4 };
    const project = (p: V3, off: THREE.Vector3) => {
      V.set(p[0] + off.x, p[1] + off.y, p[2] + off.z).project(camera);
      return { x: ((V.x + 1) / 2) * W, y: ((1 - V.y) / 2) * H, ok: V.z < 1 };
    };
    const box = (pts: readonly V3[], off: THREE.Vector3, idx?: readonly number[]): Rect | null => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const n = idx ? idx.length : pts.length;
      for (let k = 0; k < n; k++) {
        const s = project(pts[idx ? idx[k] : k], off);
        if (!s.ok) continue;
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
        y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
      }
      return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
    };

    // Name plates: anchored to each station's whole-rep extent so they don't bob with the rep.
    const plates: Rect[] = [];
    const youEl = refs.you.current;
    const tgtEl = refs.target.current;
    const bY = box(model.cloudYou, live.you);
    const bT = box(model.cloudTarget, live.target);
    if (youEl && tgtEl && bY && bT) {
      const wy = youEl.offsetWidth, hy = youEl.offsetHeight, wt = tgtEl.offsetWidth, ht = tgtEl.offsetHeight;
      let ry: Rect;
      let rt: Rect;
      if (plan.arrangement === "overlay") {
        const total = wy + 8 + wt;
        const x = (bY.x0 + bY.x1) / 2 - total / 2;
        const y = Math.max(bY.y1, bT.y1) + 10;
        const group = clampRect({ x0: x, y0: y, x1: x + total, y1: y + Math.max(hy, ht) }, safe);
        ry = { x0: group.x0, y0: group.y0, x1: group.x0 + wy, y1: group.y0 + hy };
        rt = { x0: group.x0 + wy + 8, y0: group.y0, x1: group.x0 + total, y1: group.y0 + ht };
      } else {
        ry = clampRect(rectC((bY.x0 + bY.x1) / 2, bY.y1 + 10 + hy / 2, wy, hy), safe);
        const ty = plan.arrangement === "stack" ? bT.y0 - 10 - ht / 2 : bT.y1 + 10 + ht / 2;
        rt = clampRect(rectC((bT.x0 + bT.x1) / 2, ty, wt, ht), safe);
        if (overlap(ry, rt) > 0) {
          const right = clampRect({ x0: ry.x1 + 8, y0: rt.y0, x1: ry.x1 + 8 + wt, y1: rt.y1 }, safe);
          rt = overlap(ry, right) > 0 ? clampRect({ x0: rt.x0, y0: ry.y0 - 8 - ht, x1: rt.x1, y1: ry.y0 - 8 }, safe) : right;
        }
      }
      show(youEl, ry);
      show(tgtEl, rt);
      plates.push(ry, rt);
    } else {
      if (youEl) show(youEl, null);
      if (tgtEl) show(tgtEl, null);
    }

    // Fault callout: the free spot near the faulty joint, linked to it by a leader line.
    const fEl = refs.fault.current;
    const leader = refs.leader.current;
    const dot = refs.dot.current;
    const j = model.faultJoints[0];
    const pose = poses.you();
    const J = fEl && j !== undefined && pose[j] ? project(pose[j], live.you) : null;
    if (!fEl || !J || !J.ok) {
      if (fEl) show(fEl, null);
      leader?.setAttribute("visibility", "hidden");
      dot?.setAttribute("visibility", "hidden");
      return;
    }
    const w = fEl.offsetWidth;
    const h = fEl.offsetHeight;
    const bodyY = box(pose, live.you, BODY_POINTS);
    const bodyT = plan.arrangement === "overlay" ? null : box(poses.target(), live.target, BODY_POINTS);
    const d = 38;
    const cands: [number, number][] = [
      [J.x, J.y - d - h / 2],
      [J.x, J.y + d + h / 2],
      [J.x - d - w / 2, J.y - h * 0.7],
      [J.x + d + w / 2, J.y - h * 0.7],
      [J.x - d - w / 2, J.y + h * 0.7],
      [J.x + d + w / 2, J.y + h * 0.7],
    ];
    if (bodyY) cands.push([bodyY.x0 - 18 - w / 2, J.y], [bodyY.x1 + 18 + w / 2, J.y], [J.x, bodyY.y0 - 18 - h / 2], [J.x, bodyY.y1 + 18 + h / 2]);
    const score = ([cx, cy]: [number, number]) => {
      const r = rectC(cx, cy, w, h);
      let s = 4 * outside(r, safe) + 0.5 * (bodyY ? overlap(r, bodyY) : 0) + 0.3 * Math.hypot(cx - J.x, cy - J.y) * h;
      if (bodyT) s += 2 * overlap(r, bodyT);
      for (const p of plates) s += 2.5 * overlap(r, p);
      return s;
    };
    let best = 0;
    let bestScore = Infinity;
    cands.forEach((c, k) => {
      const s = score(c);
      if (s < bestScore) {
        bestScore = s;
        best = k;
      }
    });
    const s0 = st.current;
    if (s0.cand >= 0 && s0.cand < cands.length && score(cands[s0.cand]) <= bestScore * 1.25 + 1) best = s0.cand;
    s0.cand = best;
    const goal = clampRect(rectC(cands[best][0], cands[best][1], w, h), safe);
    const gx = (goal.x0 + goal.x1) / 2;
    const gy = (goal.y0 + goal.y1) / 2;
    s0.cx = Number.isFinite(s0.cx) ? s0.cx + (gx - s0.cx) * 0.22 : gx;
    s0.cy = Number.isFinite(s0.cy) ? s0.cy + (gy - s0.cy) * 0.22 : gy;
    const r = rectC(s0.cx, s0.cy, w, h);
    show(fEl, r);
    const qx = Math.min(Math.max(J.x, r.x0), r.x1);
    const qy = Math.min(Math.max(J.y, r.y0), r.y1);
    const far = Math.hypot(qx - J.x, qy - J.y) > 8;
    if (leader) {
      leader.setAttribute("x1", J.x.toFixed(1));
      leader.setAttribute("y1", J.y.toFixed(1));
      leader.setAttribute("x2", qx.toFixed(1));
      leader.setAttribute("y2", qy.toFixed(1));
      leader.setAttribute("visibility", far ? "visible" : "hidden");
    }
    if (dot) {
      dot.setAttribute("cx", J.x.toFixed(1));
      dot.setAttribute("cy", J.y.toFixed(1));
      dot.setAttribute("visibility", "visible");
    }
  });
  return null;
}

function Stage({ radius, distance }: { radius: number; distance: number }) {
  return (
    <>
      <color attach="background" args={["#07090c"]} />
      <fog attach="fog" args={["#07090c", distance * 1.2, distance * 2.4 + 1]} />
      <hemisphereLight args={["#a9bfd6", "#0b0e12", 0.55]} />
      <directionalLight position={[2.5, 4.5, 3.5]} intensity={1.55} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-2.6, 2.2, -1.8]} intensity={9} color="#2ee6ff" distance={7} />
      <pointLight position={[2.6, 2.4, -1.6]} intensity={7} color="#c6ff3d" distance={7} />
      <spotLight position={[0, 5.5, 0.5]} angle={0.6} penumbra={0.9} intensity={18} color="#ffffff" distance={10} />
      {/* Stage disc + grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <circleGeometry args={[radius, 72]} />
        <meshStandardMaterial color="#0d1218" roughness={0.85} metalness={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[radius - 0.04, radius, 120]} />
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
        fadeDistance={distance * 1.9 + 2}
        fadeStrength={1.6}
        infiniteGrid
      />
      <ContactShadows position={[0, 0.008, 0]} opacity={0.55} scale={radius * 2} blur={2.4} far={3} />
    </>
  );
}

function Scene({ model, layout, preset, nonce, autoRotate, clock, hud, labelRefs, onUserInteract }: {
  model: StageModel;
  layout: Layout;
  preset: CamPreset;
  nonce: number;
  autoRotate: boolean;
  clock: PlaybackClock;
  hud: { top: number; bottom: number };
  labelRefs: LabelRefs;
  onUserInteract: () => void;
}) {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const single = model.you.length === 1;
  const split = layout === "split";
  const plan = useMemo(
    () => planStage(model, layout, preset, { width, height, top: hud.top, bottom: hud.bottom }),
    [model, layout, preset, width, height, hud.top, hud.bottom],
  );
  const poses = useMemo(() => poseSource(model, clock, layout), [model, clock, layout]);
  const [live] = useState<Live>(() => ({ you: new THREE.Vector3(), target: new THREE.Vector3() }));
  return (
    <>
      <Stage radius={plan.floorRadius} distance={plan.distance} />
      <Playback clock={clock} single={single} />
      <OffsetAnimator live={live} plan={plan} model={model} />
      <CameraRig plan={plan} nonce={nonce} autoRotate={autoRotate} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={plan.distance * 0.45}
        maxDistance={plan.distance * 2.2}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.04}
        onStart={onUserInteract}
      />
      <Station live={live} which="you">
        {model.bar && <PullUpBar bar={model.bar} />}
        {model.mat && <FloorMat mat={model.mat} />}
        <Mannequin getPose={poses.you} variant="you" faultJoints={model.faultJoints} />
      </Station>
      <Station live={live} which="target">
        {split && model.bar && <PullUpBar bar={model.bar} />}
        {split && model.mat && <FloorMat mat={model.mat} raised={plan.arrangement === "stack"} />}
        <Mannequin getPose={poses.target} variant={split ? "target" : "ghost"} />
      </Station>
      <LabelProjector model={model} plan={plan} live={live} poses={poses} refs={labelRefs} hud={hud} />
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

const defaultPreset = (exercise: ExerciseId): CamPreset => (exercise === "pull_up" ? "34" : "side");

export default function Form3DView({ repFrames, world, report, tMoment, exercise, className, height = "min(74vh, 820px)" }: Form3DViewProps) {
  const prepared = useMemo(() => prepare3D(repFrames, world, report, tMoment), [repFrames, world, report, tMoment]);
  const model = useMemo(() => (prepared ? buildStage(prepared, exercise) : null), [prepared, exercise]);
  const single = (model?.you.length ?? 0) <= 1;
  const [layout, setLayout] = useState<Layout>("split");
  const [preset, setPreset] = useState<CamPreset>(() => defaultPreset(exercise));
  const [presetFor, setPresetFor] = useState(exercise);
  if (presetFor !== exercise) {
    // Re-analysed as another exercise: back to that exercise's best camera.
    setPresetFor(exercise);
    setPreset(defaultPreset(exercise));
  }
  const [nonce, setNonce] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [clock] = useState(() => new PlaybackClock());
  const [hud, setHud] = useState({ top: 64, bottom: 88 });
  const topHud = useRef<HTMLDivElement>(null);
  const bottomHud = useRef<HTMLDivElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const timeLabel = useRef<HTMLSpanElement>(null);
  const labels = useMemo(() => primaryLabel(report), [report]);
  const youLabel = useRef<HTMLDivElement>(null);
  const targetLabel = useRef<HTMLDivElement>(null);
  const faultLabel = useRef<HTMLDivElement>(null);
  const leader = useRef<SVGLineElement>(null);
  const leaderDot = useRef<SVGCircleElement>(null);
  const labelRefs = useMemo<LabelRefs>(() => ({ you: youLabel, target: targetLabel, fault: faultLabel, leader, dot: leaderDot }), []);
  const chip = "pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[11px] font-semibold uppercase leading-tight tracking-[0.12em] backdrop-blur-md will-change-transform";
  const split = layout === "split";

  useEffect(() => {
    if (!model) return;
    clock.configure(model.times[0], model.times[model.times.length - 1]);
  }, [model, clock]);
  useEffect(() => clock.setPlayback(playing, speed), [playing, speed, clock]);

  // The HUD wraps on narrow screens: measure it so the fit and the labels keep clear of it.
  useEffect(() => {
    const top = topHud.current;
    const bottom = bottomHud.current;
    if (!top || !bottom) return;
    const ro = new ResizeObserver(() => {
      const next = { top: Math.round(top.offsetHeight), bottom: Math.round(bottom.offsetHeight) };
      setHud((h) => (h.top === next.top && h.bottom === next.bottom ? h : next));
    });
    ro.observe(top);
    ro.observe(bottom);
    return () => ro.disconnect();
  }, [model]);

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

  if (!model) {
    return (
      <div className={cn("flex items-center justify-center rounded-2xl border border-line bg-surface text-sm text-dim", className)} style={{ height }}>
        3D pose not available for this frame.
      </div>
    );
  }

  const t0 = model.times[0];
  const t1 = model.times[model.times.length - 1];
  const momentPct = single ? 0 : ((tMoment - t0) / (t1 - t0 || 1)) * 100;

  return (
    <div data-testid="form-3d" data-exercise={exercise} className={cn("relative overflow-hidden rounded-2xl border border-line bg-bg", className)} style={{ height }}>
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [0, 1.2, 5], fov: FOV, near: 0.05, far: 60 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
        <Scene
          model={model}
          layout={layout}
          preset={preset}
          nonce={nonce}
          autoRotate={autoRotate}
          clock={clock}
          hud={hud}
          labelRefs={labelRefs}
          onUserInteract={() => setAutoRotate(false)}
        />
      </Canvas>

      {/* Projected 3D labels */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels && model.faultJoints.length > 0 && (
          <svg className="absolute inset-0 size-full text-signal">
            <line ref={leader} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity={0.85} visibility="hidden" />
            <circle ref={leaderDot} r={3.5} fill="currentColor" visibility="hidden" />
          </svg>
        )}
        <div ref={youLabel} className={cn(chip, "border-signal/50 bg-bg/70 text-signal")} style={{ visibility: "hidden" }}>● You</div>
        <div ref={targetLabel} className={cn(chip, "border-volt/50 bg-bg/70 text-volt")} style={{ visibility: "hidden" }}>
          ◆ {split ? "Target form" : "Target ghost"}
          {split && labels && <span className="block pt-0.5 text-[10px] font-medium tracking-[0.08em] text-volt/75">{labels.target}</span>}
        </div>
        {labels && model.faultJoints.length > 0 && (
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
      <div ref={topHud} className="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3 sm:p-4">
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
            aria-label="Auto-orbit"
            title="Auto-orbit"
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
      <div ref={bottomHud} className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
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
                min={t0}
                max={t1}
                step={0.01}
                defaultValue={t0}
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
