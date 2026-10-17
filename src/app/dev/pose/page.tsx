"use client";

// Dev page: runs the real local pose pipeline on a clip and prints JSON for fixture generation.
//   /dev/pose?src=/demo/pullup/video.mp4&t=7.2[&exercise=pull_up]
//   /dev/pose?src=/demo/pullup/video.mp4&scan=1        (pose-only scan + per-frame phase signal)
//   /dev/pose?src=/demo/pullup/video.mp4&refine=7.2    (refineMoment around t=7.2)
//   /dev/pose?src=/demo/pullup/video.mp4&rep=13.4       (3D rep capture → rep.json)
//   /dev/pose?src=/demo/pushup.mov&detect=1[&n=16]      (exercise auto-detect + per-frame features)
//   …&t=7.2&export=1  also renders exportBeforeAfter (after = a padded test crop) into <img id="export">
// Output goes to window.__DEV_POSE__ and <pre id="out">. Used by scripts/gen-pose-fixture.mjs.
import { useEffect, useRef, useState } from "react";
import type { ExerciseId } from "@/lib/types";
import { EXERCISES } from "@/lib/types";
import { probeVideo } from "@/lib/video/probe";
import { grabFrame, renderCrop } from "@/lib/video/extractFrames";
import { detectPose } from "@/lib/pose/detect";
import { landmarkerInfo } from "@/lib/pose/landmarker";
import { captureRep, detectExerciseDetailed, poseOnlyScanDetailed, refineMoment } from "@/lib/moments/refine";
import { computeCrop, transformPose } from "@/lib/video/crop";
import { computeAngleReport } from "@/lib/angles/compute";
import { drawPoseOverlay, exportBeforeAfter } from "@/lib/render/drawOverlay";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export default function DevPosePage() {
  const [status, setStatus] = useState("starting…");
  const [out, setOut] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const q = new URLSearchParams(window.location.search);
    const src = q.get("src") || "/demo/pullup/video.mp4";
    const exParam = q.get("exercise") as ExerciseId | null;
    const exercise: ExerciseId = exParam && (EXERCISES as readonly string[]).includes(exParam) ? exParam : "pull_up";
    const scan = q.get("scan") === "1";
    const t = Number(q.get("t") ?? 6);
    const finish = (data: unknown) => {
      window.__DEV_POSE__ = data;
      setOut(JSON.stringify(data, null, 2));
    };

    (async () => {
      const T: Record<string, number> = {};
      let mark = performance.now();
      const lap = (k: string) => {
        const now = performance.now();
        T[k] = Math.round(now - mark);
        mark = now;
      };
      setStatus(`probing ${src}`);
      const { video, meta } = await probeVideo(src);
      lap("probe");

      if (scan) {
        setStatus("pose-only scan…");
        const res = await poseOnlyScanDetailed(video, exercise, meta.duration, undefined, (d, n) =>
          setStatus(`pose-only scan ${d}/${n}`),
        );
        lap("scan");
        setStatus(`done: ${res.reps.length} reps, ${res.events.length} events`);
        finish({ mode: "scan", src, exercise, meta, ...res, landmarker: landmarkerInfo("VIDEO"), timings: T });
        return;
      }

      if (q.get("detect") === "1") {
        setStatus("detecting exercise…");
        const n = Number(q.get("n") ?? 0) || undefined;
        const res = await detectExerciseDetailed(video, meta.duration, undefined, n);
        lap("detect");
        setStatus(`done: ${res.guess ? `${res.guess.exercise} ${res.guess.confidence}` : "no guess"}`);
        finish({ mode: "detect", src, meta, ...res, timings: T });
        return;
      }

      const repT = q.get("rep");
      if (repT !== null) {
        setStatus(`capturing rep around ${repT}`);
        const frames = await captureRep(video, Number(repT), exercise);
        lap("rep");
        setStatus(`captured ${frames.length} frames`);
        finish({ mode: "rep", src, exercise, t: Number(repT), frames, timings: T });
        return;
      }

      const refineT = q.get("refine");
      if (refineT !== null) {
        setStatus(`refining around ${refineT}`);
        const r = await refineMoment(video, { t_peak: Number(refineT) }, exercise);
        lap("refine");
        setStatus(r.trace.detail ?? "refined");
        finish({
          mode: "refine",
          src,
          exercise,
          from: Number(refineT),
          t: r.t,
          trace: r.trace,
          samples: r.samples.map((x) => ({ t: x.t, signal: x.signal, body: x.body, sharpness: Math.round(x.sharpness), posed: !!x.pose })),
          landmarker: landmarkerInfo("VIDEO"),
          timings: T,
        });
        return;
      }

      setStatus(`grabbing t=${t}`);
      const frame = await grabFrame(video, t, { longEdge: 1536 });
      lap("grab");
      setStatus("heavy IMAGE pose…");
      const rawPose = await detectPose(frame.canvas, frame.width, frame.height);
      lap("pose");
      if (!rawPose) throw new Error("no person detected in the full frame");
      const crop = computeCrop(rawPose, frame.width, frame.height, exercise);
      const cropped = renderCrop(frame.canvas, crop);
      lap("crop");
      setStatus("pose on crop…");
      const cropPose = await detectPose(cropped.canvas, crop.outW, crop.outH);
      lap("poseCrop");
      const pose = cropPose ?? transformPose(rawPose, crop);
      const report = computeAngleReport(pose, exercise);

      // visual check
      const host = previewRef.current;
      if (host) {
        const c = document.createElement("canvas");
        c.width = crop.outW;
        c.height = crop.outH;
        c.style.maxWidth = "100%";
        c.style.maxHeight = "80vh";
        const ctx = c.getContext("2d")!;
        ctx.drawImage(cropped.canvas, 0, 0);
        drawPoseOverlay(ctx, pose, report);
        host.replaceChildren(c);
      }
      let exportInfo: { bytes: number; ms: number } | undefined;
      if (q.get("export") === "1" && host) {
        const e0 = performance.now();
        // a crop reaching outside the frame on all sides exercises the blurred edge-replicate
        const padCrop = { x: -200, y: -150, w: frame.width + 400, h: frame.height + 300, outW: 1024, outH: 1536, size: "1024x1536" as const };
        const padded = renderCrop(frame.canvas, padCrop);
        const blob = await exportBeforeAfter(cropped.canvas, padded.canvas, [pose, null], [report, null], {
          subtitle: "Pull-up · dev export",
        });
        exportInfo = { bytes: blob.size, ms: Math.round(performance.now() - e0) };
        const img = document.createElement("img");
        img.id = "export";
        img.src = URL.createObjectURL(blob);
        img.style.maxWidth = "100%";
        host.appendChild(img);
      }
      setStatus(`done: ${pose.landmarks.length} landmarks (${cropPose ? "re-detected on crop" : "transformed"})`);
      finish({
        mode: "frame",
        src,
        exercise,
        t: Math.round(video.currentTime * 1000) / 1000,
        requestedT: t,
        meta,
        frameSize: { width: frame.width, height: frame.height },
        frameDataUrl: cropped.dataUrl,
        crop,
        pose,
        rawPose,
        poseSource: cropPose ? "crop-detect" : "transformed",
        report: {
          view: report.view,
          side: report.side,
          score: report.score,
          grade: report.grade,
          angles: report.angles.map((a) => ({ key: a.key, value: a.value === null ? null : r3(a.value), unit: a.unit, status: a.status, reliable: a.reliable })),
          violations: report.violations.map((v) => v.ruleId),
        },
        landmarker: landmarkerInfo("IMAGE"),
        export: exportInfo,
        timings: T,
      });
    })().catch((e: unknown) => {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setStatus(`error: ${msg}`);
      finish({ error: msg, detail: (e as { attempts?: string[] })?.attempts });
    });
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: "ui-monospace, Menlo, Consolas, monospace", background: "#07090C", color: "#F4F7FA", minHeight: "100vh" }}>
      <h1 style={{ color: "#C6FF3D", fontSize: 18 }}>/dev/pose</h1>
      <p id="status">{status}</p>
      <div ref={previewRef} />
      <pre id="out" style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: "60vh", overflow: "auto" }}>
        {out}
      </pre>
    </main>
  );
}
