"use client";
// Articulated studio mannequin driven by 33 MediaPipe landmarks (scene space, metres).
// Every frame we re-pose capsules/ellipsoids in place via refs — no React re-renders.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LM } from "@/lib/pose/landmarks";
import type { V3 } from "@/lib/pose3d/skeleton3d";

export type MannequinVariant = "you" | "target" | "ghost";

/** Bone segments: [from, to, radius]. */
const LIMBS: ReadonlyArray<readonly [number, number, number]> = [
  [LM.L_SHOULDER, LM.L_ELBOW, 0.046],
  [LM.R_SHOULDER, LM.R_ELBOW, 0.046],
  [LM.L_ELBOW, LM.L_WRIST, 0.038],
  [LM.R_ELBOW, LM.R_WRIST, 0.038],
  [LM.L_HIP, LM.L_KNEE, 0.066],
  [LM.R_HIP, LM.R_KNEE, 0.066],
  [LM.L_KNEE, LM.L_ANKLE, 0.05],
  [LM.R_KNEE, LM.R_ANKLE, 0.05],
  [LM.L_SHOULDER, LM.R_SHOULDER, 0.05],
];

const JOINTS: readonly number[] = [
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
];

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpX = new THREE.Vector3();
const tmpY = new THREE.Vector3();
const tmpZ = new THREE.Vector3();

const v = (p: V3, out: THREE.Vector3) => out.set(p[0], p[1], p[2]);

function placeSegment(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  tmpDir.subVectors(b, a);
  const length = Math.max(tmpDir.length(), 1e-4);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
  // Unit tapered cylinder (height 1, bottom radius 1) — joint spheres cap the ends.
  mesh.scale.set(radius, length, radius);
}

/** Orient an ellipsoid with its Y along `up` and X along `side`. */
function placeEllipsoid(mesh: THREE.Object3D, centre: THREE.Vector3, up: THREE.Vector3, side: THREE.Vector3, sx: number, sy: number, sz: number) {
  tmpY.copy(up).normalize();
  tmpZ.crossVectors(side, tmpY).normalize();
  if (tmpZ.lengthSq() < 1e-8) tmpZ.set(0, 0, 1);
  tmpX.crossVectors(tmpY, tmpZ).normalize();
  tmpM.makeBasis(tmpX, tmpY, tmpZ);
  mesh.quaternion.setFromRotationMatrix(tmpM);
  mesh.position.copy(centre);
  mesh.scale.set(sx, sy, sz);
}

export interface MannequinProps {
  /** Called every frame; must return the 33 scene-space points to pose. */
  getPose: () => V3[] | null;
  variant: MannequinVariant;
  faultJoints?: readonly number[];
  offset?: readonly [number, number, number];
}

export function Mannequin({ getPose, variant, faultJoints = [], offset = [0, 0, 0] }: MannequinProps) {
  const group = useRef<THREE.Group>(null);
  const limbRefs = useRef<(THREE.Mesh | null)[]>([]);
  const jointRefs = useRef<(THREE.Mesh | null)[]>([]);
  const faultRefs = useRef<(THREE.Mesh | null)[]>([]);
  const chest = useRef<THREE.Mesh>(null);
  const abdomen = useRef<THREE.Mesh>(null);
  const pelvis = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const neck = useRef<THREE.Mesh>(null);
  const hands = useRef<(THREE.Mesh | null)[]>([]);
  const feet = useRef<(THREE.Mesh | null)[]>([]);

  // Bottom (proximal) radius 1, top (distal) 0.78: limbs taper like a real artist's mannequin.
  const capsule = useMemo(() => new THREE.CylinderGeometry(0.78, 1, 1, 24, 1, false), []);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 32, 24), []);

  const mats = useMemo(() => {
    if (variant === "you") {
      return {
        body: new THREE.MeshPhysicalMaterial({ color: "#b9c4d0", roughness: 0.38, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.25 }),
        joint: new THREE.MeshPhysicalMaterial({ color: "#1d2733", roughness: 0.3, metalness: 0.6, emissive: "#2ee6ff", emissiveIntensity: 0.35 }),
      };
    }
    const glow = variant === "target" ? 0.55 : 0.35;
    return {
      body: new THREE.MeshPhysicalMaterial({
        color: "#c6ff3d",
        emissive: "#9be22a",
        emissiveIntensity: glow,
        roughness: 0.25,
        metalness: 0.05,
        transparent: true,
        opacity: variant === "target" ? 0.82 : 0.32,
        depthWrite: variant === "target",
      }),
      joint: new THREE.MeshPhysicalMaterial({ color: "#eaff9e", emissive: "#c6ff3d", emissiveIntensity: 0.9, transparent: true, opacity: variant === "target" ? 0.95 : 0.45 }),
    };
  }, [variant]);
  const faultMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ff3b5c", transparent: true, opacity: 0.85, depthWrite: false }), []);

  useFrame(({ clock }) => {
    const pts = getPose();
    if (!pts || pts.length < 33 || !group.current) return;
    group.current.position.set(offset[0], offset[1], offset[2]);

    LIMBS.forEach(([a, b, r], i) => {
      const m = limbRefs.current[i];
      if (m) placeSegment(m, v(pts[a], tmpA), v(pts[b], tmpB), r);
    });
    JOINTS.forEach((j, i) => {
      const m = jointRefs.current[i];
      if (!m) return;
      m.position.set(pts[j][0], pts[j][1], pts[j][2]);
      const r = j === LM.L_HIP || j === LM.R_HIP ? 0.07 : j === LM.L_KNEE || j === LM.R_KNEE ? 0.058 : j === LM.L_SHOULDER || j === LM.R_SHOULDER ? 0.058 : 0.045;
      m.scale.setScalar(r);
    });

    // Torso: chest + abdomen ellipsoids along the spine, pelvis across the hips.
    const ls = new THREE.Vector3(...pts[LM.L_SHOULDER]);
    const rs = new THREE.Vector3(...pts[LM.R_SHOULDER]);
    const lh = new THREE.Vector3(...pts[LM.L_HIP]);
    const rh = new THREE.Vector3(...pts[LM.R_HIP]);
    const ms = ls.clone().add(rs).multiplyScalar(0.5);
    const mh = lh.clone().add(rh).multiplyScalar(0.5);
    const spine = ms.clone().sub(mh);
    const spineLen = Math.max(spine.length(), 0.2);
    const shoulderW = Math.max(ls.distanceTo(rs), 0.2);
    const hipW = Math.max(lh.distanceTo(rh), 0.15);
    const side = rs.clone().sub(ls);
    if (chest.current) placeEllipsoid(chest.current, mh.clone().addScaledVector(spine, 0.7), spine, side, shoulderW * 0.56, spineLen * 0.36, 0.12);
    if (abdomen.current) placeEllipsoid(abdomen.current, mh.clone().addScaledVector(spine, 0.32), spine, side, shoulderW * 0.42, spineLen * 0.3, 0.1);
    if (pelvis.current) placeEllipsoid(pelvis.current, mh.clone().addScaledVector(spine, 0.04), spine, rh.clone().sub(lh), hipW * 0.78, spineLen * 0.16, 0.11);

    // Head and neck.
    const le = new THREE.Vector3(...pts[LM.L_EAR]);
    const re = new THREE.Vector3(...pts[LM.R_EAR]);
    const nose = new THREE.Vector3(...pts[LM.NOSE]);
    const headC = le.clone().add(re).multiplyScalar(0.5).lerp(nose, 0.25).addScaledVector(spine.clone().normalize(), 0.03);
    if (head.current) placeEllipsoid(head.current, headC, spine, side, 0.095, 0.118, 0.105);
    if (neck.current) placeSegment(neck.current, ms, headC.clone().addScaledVector(spine.clone().normalize(), -0.08), 0.042);

    // Hands: towards the index knuckles.
    [
      [LM.L_WRIST, LM.L_INDEX],
      [LM.R_WRIST, LM.R_INDEX],
    ].forEach(([w, idx], i) => {
      const m = hands.current[i];
      if (!m) return;
      v(pts[w], tmpA).lerp(v(pts[idx], tmpB), 0.55);
      m.position.copy(tmpA);
      m.scale.set(0.042, 0.05, 0.03);
    });

    // Feet: ellipsoids from heel to toes.
    [
      [LM.L_HEEL, LM.L_FOOT, LM.L_ANKLE],
      [LM.R_HEEL, LM.R_FOOT, LM.R_ANKLE],
    ].forEach(([h, f, a], i) => {
      const m = feet.current[i];
      if (!m) return;
      v(pts[h], tmpA);
      v(pts[f], tmpB);
      const footLen = Math.max(tmpA.distanceTo(tmpB), 0.12);
      const c = tmpA.clone().lerp(tmpB, 0.5).lerp(new THREE.Vector3(...pts[a]), 0.15);
      const dir = tmpB.clone().sub(tmpA);
      placeEllipsoid(m, c, dir, side, 0.045, footLen * 0.55, 0.038);
    });

    // Pulsing fault halos.
    const pulse = 1 + 0.35 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 5));
    faultJoints.forEach((j, i) => {
      const m = faultRefs.current[i];
      if (!m || !pts[j]) return;
      m.position.set(pts[j][0], pts[j][1], pts[j][2]);
      m.scale.setScalar(0.085 * pulse);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * (pulse - 1);
    });
  });

  return (
    <group ref={group}>
      {LIMBS.map((_, i) => (
        <mesh key={`l${i}`} ref={(m) => { limbRefs.current[i] = m; }} geometry={capsule} material={mats.body} castShadow />
      ))}
      {JOINTS.map((_, i) => (
        <mesh key={`j${i}`} ref={(m) => { jointRefs.current[i] = m; }} geometry={sphere} material={mats.joint} castShadow />
      ))}
      <mesh ref={chest} geometry={sphere} material={mats.body} castShadow />
      <mesh ref={abdomen} geometry={sphere} material={mats.body} castShadow />
      <mesh ref={pelvis} geometry={sphere} material={mats.body} castShadow />
      <mesh ref={head} geometry={sphere} material={mats.body} castShadow />
      <mesh ref={neck} geometry={capsule} material={mats.body} castShadow />
      {[0, 1].map((i) => (
        <mesh key={`h${i}`} ref={(m) => { hands.current[i] = m; }} geometry={sphere} material={mats.joint} castShadow />
      ))}
      {[0, 1].map((i) => (
        <mesh key={`ft${i}`} ref={(m) => { feet.current[i] = m; }} geometry={sphere} material={mats.body} castShadow />
      ))}
      {variant === "you" &&
        faultJoints.map((_, i) => (
          <mesh key={`f${i}`} ref={(m) => { faultRefs.current[i] = m; }} geometry={sphere} material={faultMat} renderOrder={10} />
        ))}
    </group>
  );
}
