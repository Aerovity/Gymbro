# Gym Bro — build contract (read this before writing code)

The full product spec is `docs/SPEC.md` (sections are referenced as §N). This file overrides the spec where they differ.

## Ground rules for every agent
- The app lives in the repository root, not in `gym-bro/`. Next.js **16.4.1** (App Router, `src/`), React 19.3, TypeScript strict, Tailwind v4, and shadcn on **@base-ui/react** (not Radix). Components already exist in `src/components/ui`.
- **This Next.js is newer than your training data.** Read the relevant guide under `node_modules/next/dist/docs/` before writing code that uses Next APIs. Cache Components is **disabled**, so route handlers use `export const dynamic = "force-dynamic"`, `runtime = "nodejs"` and `maxDuration`.
- **Library versions are newer than your training data:** openai 7.32, zod 4.6, motion 14.2, vitest 5, msw 3, @mediapipe/tasks-vision 1.1.1, react-compare-slider 4, lucide-react 1.57. **Check the installed type definitions in `node_modules/<pkg>`** before using any API. Do not guess.
- Shared contracts must not be changed without the integrator: `src/lib/types.ts`, `src/lib/schemas.ts`, `src/lib/config.ts`, `src/lib/pose/landmarks.ts`, `src/lib/exercises/catalog.ts`, `src/lib/store/pipeline.ts`. If you need a new shared type, add it in your own module and export it from there.
- Only create or edit files you own (listed below). `tests/` files are owned by the agent whose code they test.
- Vitest: the default environment is `node`. For DOM tests, add `// @vitest-environment jsdom` at the top of the file. `server-only` is aliased to a stub in tests.
- Before finishing, run `npx tsc --noEmit`, `npx eslint <your files>` and `npx vitest run <your tests>`. All three must be clean for your files.
- Path alias: `@/` maps to `src/`.

## New exercise: pull-up (the real demo clip)
`public/demo/pullup/video.mp4` (720×1280 portrait, 15 s, H.264) is a real set filmed from **behind**, so the view is front/rear. About 6 reps, roughly 2.5 s each. Visible faults: partial range at the top (chin not clearly over the bar) and knees bending/kicking. `tests/fixtures/pullup-full.mp4` is the 42 s full set.

Pull-up rules (all heuristic; view "front", which also covers rear):

| ruleId | angleKey | phase | target | cue |
|---|---|---|---|---|
| pullup_top_elbow | `elbow_top`: interior elbow angle, worse side | top | max 75, ideal 60 | "Pull your elbows down to your ribs — chin over the bar." |
| pullup_chin_clear | `chin_clearance`: (mid-wrist.y − nose.y) / torso length, as a ratio; positive means the head is above the hands | top | min 0.05, ideal 0.15 | "Drive the chin past the bar every rep." |
| pullup_knee_kick | `knee_angle`: interior knee angle, worse side | any | min 150, ideal 175 | "Squeeze glutes, legs long — no kicking." |
| pullup_shoulder_level | `shoulder_tilt`: shoulder line from horizontal, ° | any | max 6, ideal 0 | "Pull evenly — both elbows down together." |
| pullup_elbow_sym | `elbow_asym`: abs(L−R elbow angle) | any | max 15, ideal 0 | "Match both arms." |
| pullup_sway | `body_sway`: abs(mid-hip.x − mid-wrist.x) / torso length | any | max 0.25, ideal 0 | "Brace your core, stay still under the bar." |

Phase locator (used by refinement): pull_up has phase "top", found at the **min** of the mean elbow angle. Squat has phase "bottom", found at the min of the knee angle. Bench uses the min elbow angle. Deadlift has "lockout" at the max hip angle. OHP has "lockout" at the max elbow angle. Curl has "top" at the min elbow angle.

## Module ownership and exported APIs

### Agent A: core math (pure TypeScript, no DOM)
| File | Exports |
|---|---|
| `lib/angles/math.ts` | `toPx(lm, W, H): Pt`, `mid(a,b)`, `dist(a,b)`, `angleAt(a,b,c): number\|null` (2D, atan2 cross/dot, null if degenerate), `angleAt3(a,b,c)`, `inclinationFromVertical(p,q)`, `lineTiltFromHorizontal(p,q)`, `median3(series)`, `round(n, d)` |
| `lib/angles/view.ts` | `detectView(pose): { view: View; shoulderWidthRatio: number }`, `chooseSide(pose): "left"\|"right"`, `isVisible(pose, idx[])` |
| `lib/exercises/rules.ts` | `ExerciseRule` type (spec §7.8 plus pull-up above), `RULES: Record<ExerciseId, ExerciseRule[]>`, `PHASE: Record<ExerciseId, { phase, extremum: "min"\|"max", signal(pose): number\|null }>`, `PRIMARY_KEY: Record<ExerciseId, string>`, `severityFromDeviation(d)`, `evaluate(value, target): { status, deviation }` |
| `lib/angles/compute.ts` | `computeAngleReport(pose, exercise, opts?): AngleReport`. Measures all of the exercise's metrics, gates by visibility (≥0.5) and view, evaluates the rules, sorts violations, scores. Also `computeMetric(pose, exercise, key): number\|null` |
| `lib/exercises/score.ts` | `formScore(angles): { score, grade }` (spec §7.8 formula; reliable angles only) |
| `lib/exercises/fallbackCoach.ts` | `ruleBasedCoach(report: AngleReport, event?: ScanEvent): CoachReport`. A complete, decent coach report built from the rules and cues alone; used when the LLM fails and as the mock fixture basis |
| `lib/exercises/verify.ts` | `verifyAfter(before: AngleReport, beforePose, afterPose, exercise): VerifyReport` |
| `lib/moments/pick.ts` | `scoreEvent(e, ctx)`, `pickMoment(events, { duration, exercise }): ScanEvent \| null` (spec §7.3) |
| `lib/providers/parseJson.ts` | `stripThink(text)`, `extractJson(text): unknown` (fences, first balanced block), `parseTimestamp(v): number\|null` ("0:07", "7.2s", "00:00:07.5"), `parseScanOutput(text, { duration, frameTimes? }): ScanModelOutput` (coerce, clamp, snap; throws `ScanParseError`) |
| `lib/video/crop.ts` | `computeCrop(pose, frameW, frameH): CropBox` (spec §7.9; extra headroom above the head for the bar on pull-ups/OHP), `transformPose(pose, crop): PoseResult`, `editSizeFor(w, h): EditSize` |
| `lib/pose/compact.ts` | `compactKeypoints(pose): CompactKeypoint[]` (DRAWN_JOINTS only, pixel coordinates, rounded) |
| `lib/angles/ghost.ts` | `ghostPose(pose, report): Pt[]` (pixel points). 2D forward kinematics: rotate the primary violated segment(s) about their vertex to the target ideal; used for the ghost skeleton when the image edit fails |
| Tests | `tests/unit/*.test.ts` plus `tests/fixtures/landmarks-*.json` (synthetic, built in code): ≥90% coverage on `lib/angles` and `lib/exercises` |

### Agent B: server, providers, API client
| File | Exports / behaviour |
|---|---|
| `lib/providers/http.ts` | `fetchWithTimeout`, `withRetry`, `HttpError`, `TimeoutError` (spec §7.2) |
| `lib/prompts/{scan,coach,imageEdit,pick}.ts` | Prompts from spec §8, plus pull-up. `COACH_JSON_SCHEMA` (strict) |
| `lib/providers/{cosmos,nemotron,gptVisionPick,scanChain,openaiCoach,openaiImage,openaiClient}.ts` | Spec §7.2, 8.2, 8.4. The chain is Cosmos → Nemotron → GPT contact sheet; skip unconfigured providers; trace each attempt |
| `lib/demo/serverFixtures.ts` | Reads `public/demo/<id>/*.json` and `.jpg` via fs, returns typed fixtures, and has mock helpers (artificial delays configurable via `MOCK_DELAY_MS`, default realistic) |
| `app/api/{health,scan,pick-frame,coach,correct,tts}/route.ts` | Spec §9. Mock path when `isMock()`. 413 on bodies over `MAX_BODY_BYTES`. Coach is SSE (`delta`/`done`/`error`) |
| `lib/api/client.ts` | Browser wrappers: `getHealth()`, `postScan(req, signal)`, `postPickFrame`, `streamCoach(req, { onDelta(fullTextSoFar, summarySoFar), signal }): Promise<CoachReport>`, `postCorrect`, `fetchTts(text): Promise<Blob>`, `ApiClientError` (has `.status`, `.code`, `.trace`) |
| `lib/api/partialJson.ts` | `extractPartialString(partialJson, key): string` (incremental `"spoken_summary"` extractor; handles escapes and incomplete strings) |
| Tests | `tests/integration/*.test.ts` (MSW or `vi.stubGlobal('fetch')` for upstreams; call route `POST(new Request(...))` directly), `tests/unit/partialJson.test.ts` |

While `public/demo/pullup/*.json` doesn't exist yet, mock fixtures must fall back to an inline default (a valid ScanResult, a CoachReport and a 1×1 JPEG) so routes never crash. Real fixture files land later.

### Agent C: browser media and pose (DOM, client-only)
| File | Exports |
|---|---|
| `lib/video/probe.ts` | `validateFile(file): AppError\|null` (type, ≤200 MB), `probeVideo(src: File\|string): Promise<{ video: HTMLVideoElement; meta: VideoMeta; url: string }>` (unsupported codec → AppError `unsupported_codec`; >60 s → `video_too_long`) |
| `lib/video/seek.ts` | `seekTo(video, t)` (spec §7.1) |
| `lib/video/burnTimestamp.ts` | `burnTimestamp(ctx, t, w, h)` |
| `lib/video/extractFrames.ts` | `sampleFrames(video, opts, onFrame?): Promise<{ frames: SampledFrame[]; effectiveFps }>`, `grabFrame(video, t, { longEdge }): Promise<{ canvas; dataUrl; width; height }>`, `makeContactSheet(frames, n=16): Promise<{ dataUrl; timestamps }>`, `fitPayload(frames, budget)`, `renderCrop(source canvas, crop: CropBox): { canvas; dataUrl }` |
| `lib/pose/landmarker.ts` | `getImageLandmarker()`, `getVideoLandmarker()`, `preloadPose()`. Local wasm and models → CDN fallback, GPU → CPU fallback, 20 s timeout |
| `lib/pose/detect.ts` | `detectPose(source, w, h): Promise<PoseResult\|null>` (picks the lifter: largest torso bbox nearest the centre), `detectPoseFromUrl(url)`, `detectVideoFrame(canvas, tMs)`. Honour `window.__GYMBRO_TEST__?.detect` override (e2e hook) |
| `lib/moments/refine.ts` | `refineMoment(video, event, exercise, signal): Promise<{ t; trace: TraceEntry }>` (spec §7.4 using `PHASE` from rules.ts: 10 fps over ±0.6 s, lite VIDEO landmarker, median3, sharpness tie-break), `poseOnlyScan(video, exercise, duration, signal): Promise<ScanEvent[]>` (local fallback scanning the whole clip at ~4 fps) |
| `lib/render/drawOverlay.ts` | `drawPoseOverlay(ctx, pose, report, opts)`, `exportBeforeAfter(before, after, poses, reports): Promise<Blob>` (side-by-side PNG with overlays and branding) |
| `app/dev/pose/page.tsx` | Dev page: load `?src=/demo/pullup/video.mp4&t=…`, run the real pipeline locally (grab, detect, crop), and print JSON (pose, crop, frame data URL) into `<pre id="out">` and `window.__DEV_POSE__`. Used to generate fixtures via Playwright |
| `scripts/gen-pose-fixture.mjs` | Uses Playwright and the dev page to compute `pose.json` / `frame.jpg` for a timestamp (`node scripts/gen-pose-fixture.mjs pullup 7.2 out.json`) |
| Tests | `tests/unit/*` in jsdom where feasible (pure helpers such as lifter selection, payload fitting and sharpness); real browser behaviour is verified by the dev page and e2e |

`sharpness`, lifter selection and the series argmin/argmax helpers must be pure functions in `lib/pose/select.ts` / `lib/moments/series.ts` so they can be unit-tested.

### Agent D: UI/UX (presentational components and landing)
Owns `src/components/**` (except `components/ui/*`, which it may restyle or extend), `src/app/page.tsx`, `src/app/dev/gallery/page.tsx` and `src/app/icon.svg`. Builds against the types and the `PipelineData` shape, **props only**, with no store access, no fetches and no MediaPipe. The integrator wires them up.

Required components (spec §10; names and props are up to D, but a top-level `AnalyzeView` must exist):
- `components/analyze/AnalyzeView.tsx`: `props: { data: PipelineData; onToggleSkeleton; onToggleVoice; onRetryStep(step); onUseDemo(); onRetryCorrect(); onPickOtherMoment(); onStartOver(); onSeek(t); onDownload(); onShare() }`. Renders the stepper, scan visualiser/filmstrip, timeline and the progressive results dashboard. It must look complete at **every** stage (empty/loading/partial/done/error).
- Landing (`app/page.tsx` plus `components/landing/*`, `components/upload/*`): the hero, how-it-works, a dropzone, the exercise picker (Auto plus 6 exercises from `EXERCISE_ORDER`), the camera hint, and sample clips from `DEMO_CLIPS`. On start it calls `useStartAnalysis()` from `@/hooks/useStartAnalysis` (the integrator provides it; D creates a **stub** file exporting `useStartAnalysis(): (input: { file?: File; demoId?: DemoId; exercise: ExerciseChoice }) => void` that routes to `/analyze`), and the integrator replaces the stub body.
- `results/*`: BeforeAfter (react-compare-slider with an SVG `PoseOverlay` on both sides, auto-sweep intro and a ghost-skeleton fallback), PoseOverlay (bones, joints, angle arcs, target wedges, label chips, telestrator arrows, pulsing problem joints), AngleCard and AngleGauge, FormScore, CoachPanel (streaming caret, cues, drill, safety note, voice toggle), VideoTimeline (Cosmos markers), AgentTrace (sheet with raw JSON, timings and providers), ShareBar, and ProviderBadge.
- `pipeline/*`: PipelineStepper and ScanVisualizer (filmstrip with a scanning laser, plus the "FOUND BAD REP AT 0:07" lower-third).
- `/dev/gallery`: renders every component with realistic mock data at all states (`components/dev/mockData.ts`), so the visual QA pass can screenshot everything.
- Must include stable test ids: `data-testid` values `stepper`, `step-<id>` (with `data-status`), `found-banner`, `timeline-marker`, `before-after`, `pose-overlay`, `skeleton-toggle`, `angle-card`, `coach-text`, `form-score`, `download-btn`, `trace-btn`, `demo-fallback-btn`, `retry-correct-btn`, `ghost-overlay`, `sample-pullup`, `dropzone-input`, `exercise-chip-<id>`.

## Integrator (main session)
Owns `hooks/usePipeline.ts`, `hooks/useStartAnalysis.ts` (the real implementation), `hooks/useKeyboardShortcuts.ts`, `app/analyze/page.tsx`, the demo fixtures in `public/demo/pullup/*`, the e2e tests, the README and the deployment.
