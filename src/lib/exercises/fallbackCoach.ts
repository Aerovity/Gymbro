// Rule-based coach: a complete CoachReport from the measured angles + static cues.
// Used when the LLM fails and as the basis for mock fixtures.
import type { CoachReport } from "../schemas";
import type { AngleMeasurement, AngleReport, ExerciseId, RuleViolation, ScanEvent } from "../types";
import { EXERCISE_INFO } from "./catalog";
import { PRIMARY_KEY, findRule, ruleVariant } from "./rules";

interface FaultCopy {
  title: string;
  bodyPart: string;
  /** Scoreboard headline (≤ 8 words). */
  headline: (v: RuleViolation) => string;
  /** One-sentence "what's wrong", quoting the number. */
  what: (v: RuleViolation) => string;
  /** Spoken fix (no symbols except °). */
  fix: string;
  /** How the corrected body should look, for an image editor. */
  edit: (v: RuleViolation) => string;
}

const deg = (n: number) => `${Math.round(n)}°`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const lim = (v: RuleViolation) => (v.target.max !== undefined && v.actual > v.target.max ? v.target.max : v.target.min ?? v.target.ideal);

const COPY: Record<string, FaultCopy> = {
  // Squat
  squat_depth: {
    title: "Squat too shallow",
    bodyPart: "knees",
    headline: (v) => `${deg(v.actual)} KNEES — SIT TO ${deg(v.target.ideal)}`,
    what: (v) => `Your knee angle bottomed out at ${deg(v.actual)}; parallel is about ${deg(lim(v))} or less.`,
    fix: "Sit your hips down between your heels until your thighs hit parallel.",
    edit: (v) => `the lifter squats deeper, knees bent to about ${deg(v.target.ideal)} with the hip crease at or just below knee height`,
  },
  squat_hip_depth: {
    title: "Hips above parallel",
    bodyPart: "hips",
    headline: () => "HIPS HIGH — BREAK PARALLEL",
    what: (v) => `Your hip crease stayed ${pct(-v.actual)} of a thigh length above the knee.`,
    fix: "Drop the hip crease to knee height before you drive up.",
    edit: () => "the hip crease sits level with or slightly below the top of the knee",
  },
  squat_trunk_tibia: {
    title: "Torso folding forward",
    bodyPart: "torso",
    headline: (v) => `TORSO ${deg(Math.abs(v.actual))} OFF SHINS — CHEST UP`,
    what: (v) =>
      `Your torso is ${deg(Math.abs(v.actual))} ${v.actual > 0 ? "more leaned than" : "more upright than"} your shins; we want them within ${deg(v.target.max ?? 10)} of parallel.`,
    fix: "Keep your chest proud so your torso stays parallel to your shins.",
    edit: () => "the torso is more upright and roughly parallel to the shins, chest proud, neutral spine",
  },
  squat_torso_lean: {
    title: "Excessive forward lean",
    bodyPart: "torso",
    headline: (v) => `${deg(v.actual)} LEAN — CHEST UP`,
    what: (v) => `You leaned ${deg(v.actual)} from vertical at the bottom; keep it under about ${deg(lim(v))}.`,
    fix: "Brace hard and push your chest up out of the hole.",
    edit: (v) => `the torso leans only about ${deg(v.target.ideal)} forward from vertical, chest up, back flat`,
  },
  squat_knee_cave: {
    title: "Knees caving in",
    bodyPart: "knees",
    headline: () => "KNEES CAVING — SHOVE THEM OUT",
    what: (v) => `Your knees are only ${pct(v.actual)} of your ankle width apart; keep them at least ${pct(lim(v))}.`,
    fix: "Spread the floor and push your knees out over your toes.",
    edit: () => "both knees push outward and track directly over the toes, no inward collapse",
  },
  squat_heel_lift: {
    title: "Heels lifting",
    bodyPart: "feet",
    headline: () => "HEELS UP — PLANT THE WHOLE FOOT",
    what: (v) => `Your heel rose about ${pct(v.actual)} of the frame height above your toes.`,
    fix: "Keep the whole foot planted and drive through your heels.",
    edit: () => "both heels stay flat on the floor with the whole foot planted",
  },
  // Bench
  bench_elbow_flare: {
    title: "Elbows flaring",
    bodyPart: "shoulders",
    headline: (v) => `ELBOWS ${deg(v.actual)} — TUCK TO ${deg(v.target.ideal)}`,
    what: (v) =>
      v.actual > (v.target.max ?? 75)
        ? `Your upper arms flared to ${deg(v.actual)} from your torso; the sweet spot is ${deg(v.target.min ?? 45)} to ${deg(v.target.max ?? 75)}.`
        : `Your elbows are tucked to ${deg(v.actual)}; open them to about ${deg(v.target.ideal)}.`,
    fix: `Tuck your elbows to about 60 degrees and aim the bar at your lower sternum.`,
    edit: (v) => `the upper arms sit about ${deg(v.target.ideal)} from the torso (elbows tucked, not flared out to the sides), bar over the lower chest`,
  },
  bench_forearm_vertical: {
    title: "Forearms not stacked",
    bodyPart: "forearms",
    headline: (v) => `FOREARMS ${deg(v.actual)} OFF — STACK THEM`,
    what: (v) => `Your forearm is ${deg(v.actual)} off vertical at the bottom; keep it within ${deg(lim(v))}.`,
    fix: "Stack your wrists right over your elbows under the bar.",
    edit: () => "the forearms are vertical, wrists directly above the elbows under the bar",
  },
  bench_wrist_stack: {
    title: "Wrists drifting off the elbows",
    bodyPart: "wrists",
    headline: (v) => `WRISTS ${deg(v.actual)} OFF — STACK THEM`,
    what: (v) => `Your forearm leans ${deg(v.actual)} off vertical from the front; keep it within ${deg(lim(v))}.`,
    fix: "Squeeze the bar and keep your wrists stacked over your elbows.",
    edit: () => "the forearms are vertical from the front, wrists straight and stacked over the elbows",
  },
  // Deadlift
  deadlift_back_angle: {
    title: "Setup back angle off",
    bodyPart: "hips",
    headline: (v) => `BACK ${deg(v.actual)} — SET HIPS RIGHT`,
    what: (v) => `Your back sits ${deg(v.actual)} from horizontal at setup; aim for ${deg(v.target.min ?? 30)} to ${deg(v.target.max ?? 60)}.`,
    fix: "Set your hips between your knees and shoulders and pull your chest up.",
    edit: (v) => `the back is flat at about ${deg(v.target.ideal)} from horizontal, hips between knee and shoulder height`,
  },
  deadlift_bar_path: {
    title: "Bar drifting forward",
    bodyPart: "arms",
    headline: () => "BAR DRIFTING — KEEP IT ON YOUR SHINS",
    what: (v) => `Your hands are ${pct(v.actual)} of a foot length off mid-foot; keep it under ${pct(lim(v))}.`,
    fix: "Drag the bar up your shins right over the middle of your foot.",
    edit: () => "the bar and hands sit directly over mid-foot, touching the shins",
  },
  deadlift_lockout: {
    title: "Soft lockout",
    bodyPart: "hips",
    headline: (v) => `HIPS ${deg(v.actual)} — FINISH TALL`,
    what: (v) => `Your hips only opened to ${deg(v.actual)} at the top; finish at ${deg(lim(v))} or more.`,
    fix: "Squeeze your glutes and stand all the way tall.",
    edit: () => "the lifter stands fully upright at lockout, hips fully extended and glutes squeezed",
  },
  deadlift_hyperextension: {
    title: "Leaning back at lockout",
    bodyPart: "lower back",
    headline: (v) => `${deg(v.actual)} LEAN BACK — STACK UP`,
    what: (v) => `You leaned back ${deg(v.actual)} past vertical; stop at about ${deg(lim(v))}.`,
    fix: "Finish tall with your ribs down, no leaning back.",
    edit: () => "the torso is vertical at lockout, ribs down, no backward lean",
  },
  deadlift_rounding: {
    title: "Possible back rounding",
    bodyPart: "upper back",
    headline: () => "POSSIBLE ROUNDING — PROUD CHEST",
    what: (v) => `Your neck-to-torso line bends about ${deg(v.actual)}, which suggests your upper back may be rounding.`,
    fix: "Pull the slack out of the bar and keep a proud chest and long neck.",
    edit: () => "the back is flat and neutral from neck to hips, chest proud, head in line with the spine",
  },
  // OHP
  ohp_lean_back: {
    title: "Leaning back",
    bodyPart: "lower back",
    headline: (v) => `${deg(v.actual)} LEAN BACK — RIBS DOWN`,
    what: (v) => `You're leaning back ${deg(v.actual)}; keep it under ${deg(lim(v))}.`,
    fix: "Ribs down, squeeze your glutes and stack your torso under the bar.",
    edit: () => "the torso is vertical, ribs down, glutes tight, no arch in the lower back",
  },
  ohp_elbow_lockout: {
    title: "Incomplete lockout",
    bodyPart: "elbows",
    headline: (v) => `ELBOWS ${deg(v.actual)} — LOCK OUT`,
    what: (v) => `Your elbows stopped at ${deg(v.actual)}; lock out to ${deg(lim(v))} or more.`,
    fix: "Punch the ceiling and lock your elbows out.",
    edit: () => "the arms are fully locked out overhead, elbows straight",
  },
  ohp_wrist_stack: {
    title: "Bar forward of shoulders",
    bodyPart: "shoulders",
    headline: () => "BAR FORWARD — HEAD THROUGH",
    what: (v) => `Your hands are ${pct(v.actual)} of a torso length in front of your shoulders.`,
    fix: "Push your head through the window so the bar sits over your shoulders.",
    edit: () => "the bar is directly above the shoulders and mid-foot, head pushed through between the arms",
  },
  // Curl
  curl_elbow_drift: {
    title: "Elbows drifting forward",
    bodyPart: "elbows",
    headline: (v) => `ELBOWS DRIFT ${deg(v.actual)} — PIN THEM`,
    what: (v) => `Your upper arm swung ${deg(v.actual)} forward; keep it within ${deg(lim(v))} of vertical.`,
    fix: "Pin your elbows to your sides and let only the forearm move.",
    edit: () => "the upper arms hang vertical and pinned to the sides of the torso",
  },
  curl_torso_swing: {
    title: "Torso swinging",
    bodyPart: "torso",
    headline: (v) => `${deg(v.actual)} SWING — STAND STILL`,
    what: (v) => `Your torso swung ${deg(v.actual)} from vertical; keep it under ${deg(lim(v))}.`,
    fix: "Stand tall and still, no swinging the weight up.",
    edit: () => "the torso is upright and still",
  },
  curl_bottom_rom: {
    title: "Short range at the bottom",
    bodyPart: "elbows",
    headline: (v) => `ELBOW ${deg(v.actual)} — GET LONG`,
    what: (v) => `Your elbow only opened to ${deg(v.actual)}; let it reach ${deg(lim(v))} or more.`,
    fix: "Let the arm get long at the bottom of every rep.",
    edit: () => "the arm is almost straight at the bottom of the curl",
  },
  curl_top_rom: {
    title: "Short range at the top",
    bodyPart: "elbows",
    headline: (v) => `ELBOW ${deg(v.actual)} — CURL HIGHER`,
    what: (v) => `Your elbow only closed to ${deg(v.actual)}; squeeze up to ${deg(lim(v))} or less.`,
    fix: "Curl all the way up and squeeze at the top.",
    edit: (v) => `the elbow is fully bent to about ${deg(v.target.ideal)} with the weight near the shoulder`,
  },
  // Pull-up
  pullup_top_elbow: {
    title: "Partial range at the top",
    bodyPart: "elbows",
    headline: (v) => `ELBOWS ${deg(v.actual)} — PULL TO ${deg(v.target.ideal)}`,
    what: (v) => `At the top your elbows only bent to ${deg(v.actual)}; a full rep gets them to ${deg(lim(v))} or tighter.`,
    fix: "Pull your elbows down to your ribs and get your chin over the bar.",
    edit: (v) => `the elbows are fully bent to about ${deg(v.target.ideal)} and pulled down to the sides of the ribs, chin clearly above the bar`,
  },
  pullup_chin_clear: {
    title: "Chin not over the bar",
    bodyPart: "head",
    headline: () => "CHIN SHORT — DRIVE IT OVER",
    what: (v) =>
      v.actual < 0
        ? `Your head stayed ${pct(-v.actual)} of a torso length below your hands.`
        : `Your head only cleared your hands by ${pct(v.actual)} of a torso length; get it past ${pct(lim(v))}.`,
    fix: "Drive your chin past the bar on every single rep.",
    edit: () => "the chin is clearly above the bar, head higher than the hands",
  },
  pullup_knee_kick: {
    title: "Kicking the legs",
    bodyPart: "knees",
    headline: (v) => `KNEES ${deg(v.actual)} — LEGS LONG`,
    what: (v) => `Your knees bent to ${deg(v.actual)}; keep them at ${deg(lim(v))} or straighter.`,
    fix: "Squeeze your glutes and keep your legs long, no kicking.",
    edit: () => "the legs are straight and together, hanging still under the body",
  },
  pullup_shoulder_level: {
    title: "Uneven pull",
    bodyPart: "shoulders",
    headline: (v) => `SHOULDERS TILTED ${deg(v.actual)} — PULL EVEN`,
    what: (v) => `Your shoulder line tilted ${deg(v.actual)}; keep it within ${deg(lim(v))} of level.`,
    fix: "Pull evenly and drive both elbows down together.",
    edit: () => "the shoulders are level, both sides of the body at the same height",
  },
  pullup_elbow_sym: {
    title: "Arms not matching",
    bodyPart: "elbows",
    headline: (v) => `${deg(v.actual)} ARM GAP — MATCH THEM`,
    what: (v) => `Your elbows differ by ${deg(v.actual)}; keep the gap under ${deg(lim(v))}.`,
    fix: "Match both arms so they bend together.",
    edit: () => "both arms are bent by the same amount, symmetric left and right",
  },
  pullup_sway: {
    title: "Body swinging",
    bodyPart: "core",
    headline: () => "SWINGING — BRACE AND STAY STILL",
    what: (v) => `Your hips swung ${pct(v.actual)} of a torso length off your hands; keep it under ${pct(lim(v))}.`,
    fix: "Brace your core and stay still under the bar.",
    edit: () => "the body hangs vertically and still directly under the bar",
  },
  // Push-up. Two-sided faults are keyed "<ruleId>:<variant>" (see RULE_VARIANTS).
  pushup_depth: {
    title: "Partial depth",
    bodyPart: "chest",
    headline: (v) => `ELBOWS ${deg(v.actual)} — LOWER TO ${deg(v.target.ideal)}`,
    what: (v) => `At the bottom your elbows only bent to ${deg(v.actual)}; a full push-up gets them to ${deg(lim(v))} or deeper.`,
    fix: "Lower until your chest is a fist from the floor, elbows at 90 degrees or deeper.",
    edit: (v) => `the chest is lowered to just above the floor with the elbows bent to about ${deg(v.target.ideal)}`,
  },
  "pushup_body_line:sag": {
    title: "Hips sagging",
    bodyPart: "hips",
    headline: () => "HIPS SAGGING — SQUEEZE YOUR GLUTES",
    what: (v) => `Your hips sagged toward the floor, bending your body line to ${deg(v.actual)}; a straight plank is ${deg(lim(v))} or more.`,
    fix: "Squeeze your glutes and brace your abs so your hips lift into one straight line.",
    edit: () => "the hips are lifted into one straight rigid line with the shoulders and ankles, no sag in the lower back",
  },
  "pushup_body_line:pike": {
    title: "Hips piking",
    bodyPart: "hips",
    headline: () => "HIPS PIKED — FLATTEN THE PLANK",
    what: (v) => `Your hips piked up above the line, bending your body to ${deg(v.actual)}; a straight plank is ${deg(lim(v))} or more.`,
    fix: "Lower your hips until your shoulders, hips and heels make one straight line.",
    edit: () => "the hips are lowered into one straight rigid line with the shoulders and ankles, no pike",
  },
  pushup_body_line: {
    title: "Body line broken",
    bodyPart: "hips",
    headline: (v) => `BODY LINE ${deg(v.actual)} — STRAIGHT PLANK`,
    what: (v) => `Your shoulder to hip to ankle line bent to ${deg(v.actual)}; a straight plank is ${deg(lim(v))} or more.`,
    fix: "Squeeze your glutes and brace so your body is one straight line from head to heels.",
    edit: () => "the body is one straight rigid line from the shoulders through the hips to the ankles",
  },
  pushup_lockout: {
    title: "Soft lockout",
    bodyPart: "elbows",
    headline: (v) => `ELBOWS ${deg(v.actual)} — LOCK OUT`,
    what: (v) => `At the top your elbows only straightened to ${deg(v.actual)}; finish every rep at ${deg(lim(v))} or more.`,
    fix: "Press the floor away and lock your elbows out at the top of every rep.",
    edit: () => "the arms are fully straight at the top, elbows locked, shoulders stacked over the hands",
  },
  "pushup_head:drop": {
    title: "Head dropping",
    bodyPart: "neck",
    headline: () => "HEAD DROPPING — NECK LONG",
    what: (v) => `Your head dropped toward the floor, bending your neck line to ${deg(v.actual)}; keep it at ${deg(lim(v))} or straighter.`,
    fix: "Keep your neck long and look at the floor just ahead of your hands.",
    edit: () => "the head is in line with the spine, neck long, eyes on the floor just ahead of the hands",
  },
  "pushup_head:crane": {
    title: "Head craning up",
    bodyPart: "neck",
    headline: () => "HEAD UP — TUCK THE CHIN",
    what: (v) => `You craned your head up, bending your neck line to ${deg(v.actual)}; keep it at ${deg(lim(v))} or straighter.`,
    fix: "Tuck your chin a touch and look at the floor just ahead of your hands.",
    edit: () => "the head is in line with the spine, chin slightly tucked, eyes on the floor just ahead of the hands",
  },
  pushup_head: {
    title: "Head out of line",
    bodyPart: "neck",
    headline: (v) => `NECK ${deg(v.actual)} — HEAD IN LINE`,
    what: (v) => `Your ear to shoulder to hip line bent to ${deg(v.actual)}; keep it at ${deg(lim(v))} or straighter.`,
    fix: "Keep your head in line with your spine, eyes just ahead of your hands.",
    edit: () => "the head is in line with the spine, neck long",
  },
  pushup_elbow_flare: {
    title: "Elbows flaring",
    bodyPart: "shoulders",
    headline: (v) => `ELBOWS ${deg(v.actual)} — TUCK TO ${deg(v.target.ideal)}`,
    what: (v) => `Your upper arms flared to ${deg(v.actual)} from your torso; keep them at ${deg(lim(v))} or less.`,
    fix: "Tuck your elbows to about 45 degrees so your body makes an arrow, not a T.",
    edit: (v) => `the upper arms sit about ${deg(v.target.ideal)} from the torso, elbows tucked back toward the ribs, hands under the shoulders`,
  },
};

const DRILL: Record<ExerciseId, CoachReport["drill"]> = {
  squat: {
    name: "Tempo box squats",
    prescription: "3 x 5 at 60% with a 3-second descent to a parallel box",
    why: "Grooves hitting depth with a proud chest every rep.",
  },
  bench_press: {
    name: "Paused bench with an elbow-tuck cue",
    prescription: "3 x 5 at 65%, 2-second pause on the chest",
    why: "The pause makes you own the bottom position with elbows at about 60 degrees.",
  },
  deadlift: {
    name: "Romanian deadlifts",
    prescription: "3 x 8 at a moderate weight, slow and controlled",
    why: "Teaches the hip hinge with a flat back and the bar glued to your legs.",
  },
  overhead_press: {
    name: "Half-kneeling landmine press",
    prescription: "3 x 8 per arm, ribs down, glutes squeezed",
    why: "Kills the lean-back and teaches a stacked lockout.",
  },
  biceps_curl: {
    name: "Wall curls",
    prescription: "3 x 10 with your back and elbows against a wall",
    why: "The wall makes swinging and elbow drift impossible.",
  },
  pull_up: {
    name: "Scap pull-ups + slow negatives",
    prescription: "3 x 5 scap pulls, then 3 x 3 negatives lowering for 5 seconds from chin over bar",
    why: "Builds strength through the top range and teaches a strict, still body.",
  },
  push_up: {
    name: "Incline push-ups + 3-second negatives",
    prescription: "3 x 8 incline push-ups with hands on a bench, then 3 x 5 floor push-ups lowering for 3 seconds",
    why: "The incline lets you own a rigid plank through full depth; slow negatives build strength at the bottom.",
  },
};

const GENERIC_CUES: Record<ExerciseId, string[]> = {
  squat: ["Brace before you descend.", "Spread the floor with your feet."],
  bench_press: ["Pinch your shoulder blades together.", "Drive your feet into the floor."],
  deadlift: ["Pull the slack out of the bar.", "Push the floor away."],
  overhead_press: ["Squeeze your glutes.", "Head through the window at the top."],
  biceps_curl: ["Control the way down.", "Elbows glued to your sides."],
  pull_up: ["Start from a full dead hang.", "Chest to the bar, legs long."],
  push_up: ["Squeeze your glutes and brace like a plank.", "Screw your hands into the floor."],
};

const OPENERS = ["Strong effort on that", "Good work on that", "Nice grind on that"];

const speakable = (s: string) =>
  s
    .replace(/\s*[—–;:]\s*/g, ", ").replace(/[^\p{L}\p{N}\s.,!?'°%-]/gu, "").replace(/%/g, " percent");

function fallbackCopy(v: RuleViolation): FaultCopy {
  const unit = (n: number) => (findRule(v.ruleId)?.unit === "ratio" ? pct(n) : deg(n));
  return {
    title: v.label,
    bodyPart: "body",
    headline: () => `${v.label.toUpperCase()} — FIX IT`.slice(0, 48),
    what: () => `${v.label} measured ${unit(v.actual)} against a target of ${unit(v.target.ideal)}.`,
    fix: speakable(v.cue),
    edit: () => `${v.label.toLowerCase()} at about ${unit(v.target.ideal)}`,
  };
}

const copyFor = (v: RuleViolation) => (v.variant ? COPY[`${v.ruleId}:${v.variant}`] : undefined) ?? COPY[v.ruleId] ?? fallbackCopy(v);

function feedbackComment(a: AngleMeasurement): string {
  if (a.status === "unmeasurable") return a.note ?? "Couldn't measure this one from this angle.";
  if (a.status === "good") return "On target, keep it there.";
  const cue = ruleVariant(a.ruleId, a.variant)?.cue ?? findRule(a.ruleId)?.cue;
  return a.status === "borderline" ? `Just outside the target. ${cue ?? ""}`.trim() : cue ?? "Outside the target range.";
}

function angleFeedback(report: AngleReport): CoachReport["angle_feedback"] {
  return report.angles
    .filter((a) => a.target)
    .map((a) => {
      const t = a.target!;
      const isDeg = a.unit === "°";
      return {
        angle_key: a.key,
        actual_deg: a.status === "unmeasurable" || a.value === null ? null : Math.round(a.value * (isDeg ? 1 : 1000)) / (isDeg ? 1 : 1000),
        target_min_deg: t.min ?? (isDeg ? 0 : Math.min(0, t.ideal)),
        target_max_deg: t.max ?? (isDeg ? 180 : Math.max(1, t.ideal)),
        target_ideal_deg: t.ideal,
        verdict: a.status,
        comment: feedbackComment(a),
      };
    });
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}

/** A complete, valid CoachReport built from the code-computed report alone. */
export function ruleBasedCoach(report: AngleReport, event?: ScanEvent): CoachReport {
  const ex = report.exercise;
  const info = EXERCISE_INFO[ex];
  const [primary, ...rest] = report.violations;
  const lift = info.label.toLowerCase();
  const opener = OPENERS[Math.abs(Math.round(report.score)) % OPENERS.length];
  const where =
    event && Number.isFinite(event.t_peak)
      ? ` at ${Math.round(event.t_peak)} seconds${event.rep_index !== undefined ? ` on rep ${event.rep_index + 1}` : ""}`
      : "";
  // A serious fault seen by the video model that pose could not confirm on this frame
  // (e.g. chin height from behind) must lead the report instead of "clean rep".
  const seen = event && event.severity >= 3 && event.issue && event.issue !== "hardest_rep" ? event : undefined;
  const seenIssue = seen ? seen.issue.replace(/_/g, " ") : "";
  const seenLine = seen ? `The video model caught ${seenIssue}${where}: ${seen.description.replace(/\.?$/, ".")}` : "";

  if (!primary) {
    const flagged = event?.issue ? event.issue.replace(/_/g, " ") : "";
    const spoken = seen
      ? [
          seenLine,
          "The angles we could measure from this camera position look fine, so that fault is the one to fix.",
          `Film from the side next time and we'll put exact numbers on it.`,
        ].join(" ")
      : [
          `Clean ${lift}${where}, that's how it's done!`,
          flagged
            ? `The video model flagged ${flagged}, but every angle we could measure is on target.`
            : "Every angle we could measure is right on target.",
          "Keep stacking reps like that.",
        ].join(" ");
    const targets = report.angles.filter((a) => a.target && a.status !== "unmeasurable");
    return {
      spoken_summary: spoken,
      headline: seen ? `${seenIssue.toUpperCase()} — VIDEO MODEL FLAG` : "CLEAN REP — KEEP STACKING THEM",
      primary_fault: seen
        ? {
            id: seen.issue,
            title: seenIssue.charAt(0).toUpperCase() + seenIssue.slice(1),
            explanation: `${seen.description.replace(/\.?$/, ".")} Spotted by the video model; not measurable by pose from this camera angle.`,
            body_part: seen.body_part || "full body",
            severity: Math.min(5, Math.max(1, Math.round(seen.severity))),
          }
        : {
            id: "none",
            title: "No major fault",
            explanation: "All measured angles are within their target ranges.",
            body_part: "full body",
            severity: 1,
          },
      secondary_faults: [],
      angle_feedback: angleFeedback(report),
      cues: GENERIC_CUES[ex].slice(0, 4),
      drill: DRILL[ex],
      corrected_pose: {
        description: `Keep the same body position — it is already correct. ${info.editHint}`,
        joint_targets: targets.map((a) => ({ angle_key: a.key, target_deg: a.target!.ideal })),
      },
      safety_note: null,
      form_score_adjustment: 0,
    };
  }

  const pc = copyFor(primary);
  const minor = primary.severity <= 1;
  const spoken = [
    seen && minor ? seenLine : minor ? `Solid ${lift}${where}, just one small tweak.` : `${opener} ${lift}${where}!`,
    speakable(pc.what(primary)),
    speakable(pc.fix),
    minor ? "Dial that in and this rep is textbook." : "Fix that and the next rep will look a lot stronger.",
  ].join(" ");

  const secondary = rest.slice(0, 2).map((v) => {
    const c = copyFor(v);
    return { title: c.title, explanation: c.what(v) };
  });

  const cues = dedupe([primary.cue, ...rest.slice(0, 2).map((v) => v.cue), ...GENERIC_CUES[ex]]).slice(0, 4);

  const violated = report.violations.slice(0, 3);
  const phaseWord: Record<ExerciseId, string> = {
    squat: "at the bottom of the squat",
    bench_press: "with the bar at the bottom of the press",
    deadlift: "during the pull",
    overhead_press: "at lockout overhead",
    biceps_curl: "during the curl",
    pull_up: "at the top of the pull-up",
    push_up: "at the bottom of the push-up",
  };
  const where2 = ex === "push_up" && primary.ruleId === "pushup_lockout" ? "at the top of the push-up" : phaseWord[ex];
  const description = [
    `Show the same lifter ${where2} with corrected form: ${violated.map((v) => copyFor(v).edit(v)).join("; ")}.`,
    info.editHint,
  ].join(" ");

  const jointKeys = new Set<string>();
  const joint_targets = violated
    .concat(report.violations.filter((v) => v.angleKey === PRIMARY_KEY[ex]))
    .filter((v) => (jointKeys.has(v.angleKey) ? false : (jointKeys.add(v.angleKey), true)))
    .map((v) => ({ angle_key: v.angleKey, target_deg: v.target.ideal }));

  const safety_note =
    primary.severity >= 4
      ? "That's a big deviation. Drop the load until the position is clean, and if anything hurts, stop and see a qualified coach or physio."
      : null;

  return {
    spoken_summary: spoken,
    headline: pc.headline(primary),
    primary_fault: {
      id: primary.ruleId,
      title: pc.title,
      explanation: `${pc.what(primary)} ${primary.cue}`,
      body_part: pc.bodyPart,
      severity: Math.max(1, Math.min(5, Math.round(primary.severity))),
    },
    secondary_faults: secondary,
    angle_feedback: angleFeedback(report),
    cues: cues.length ? cues : [primary.cue],
    drill: DRILL[ex],
    corrected_pose: { description, joint_targets },
    safety_note,
    form_score_adjustment: 0,
  };
}
