// MediaPipe Pose Landmarker (33 points) index constants, names and drawing connections.

export const LM = {
  NOSE: 0,
  L_EYE_INNER: 1,
  L_EYE: 2,
  L_EYE_OUTER: 3,
  R_EYE_INNER: 4,
  R_EYE: 5,
  R_EYE_OUTER: 6,
  L_EAR: 7,
  R_EAR: 8,
  MOUTH_L: 9,
  MOUTH_R: 10,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_PINKY: 17,
  R_PINKY: 18,
  L_INDEX: 19,
  R_INDEX: 20,
  L_THUMB: 21,
  R_THUMB: 22,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
} as const;

export const LANDMARK_NAMES = [
  "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
  "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
  "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
  "left_heel", "right_heel", "left_foot_index", "right_foot_index",
] as const;

/** Per-side joint chains (use with Side "left" | "right"). */
export const SIDE = {
  left: {
    ear: LM.L_EAR, shoulder: LM.L_SHOULDER, elbow: LM.L_ELBOW, wrist: LM.L_WRIST, hip: LM.L_HIP,
    knee: LM.L_KNEE, ankle: LM.L_ANKLE, heel: LM.L_HEEL, foot: LM.L_FOOT,
  },
  right: {
    ear: LM.R_EAR, shoulder: LM.R_SHOULDER, elbow: LM.R_ELBOW, wrist: LM.R_WRIST, hip: LM.R_HIP,
    knee: LM.R_KNEE, ankle: LM.R_ANKLE, heel: LM.R_HEEL, foot: LM.R_FOOT,
  },
} as const;

/** Body-only skeleton (face reduced to nose + ears). */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [LM.L_EAR, LM.NOSE], [LM.NOSE, LM.R_EAR],
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
  [LM.L_ANKLE, LM.L_HEEL], [LM.L_HEEL, LM.L_FOOT], [LM.L_ANKLE, LM.L_FOOT],
  [LM.R_ANKLE, LM.R_HEEL], [LM.R_HEEL, LM.R_FOOT], [LM.R_ANKLE, LM.R_FOOT],
];

/** Landmarks drawn as joints (no fine face/hand points). */
export const DRAWN_JOINTS: readonly number[] = [
  LM.NOSE, LM.L_EAR, LM.R_EAR,
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
  LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT,
];

export const VISIBILITY_MIN = 0.5;
