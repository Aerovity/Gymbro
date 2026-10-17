# Gym Bro: your AI spotter watches the tape

> Upload a set. **NVIDIA Cosmos** finds the bad rep. **MediaPipe** measures every joint. **GPT** coaches the fix with your real angles. **GPT Image** shows you doing it right, and then we **re-measure** the corrected image to verify it.

Built for the VAST Builders Challenge, "Real-Time Video Agents Hack – LDN" (17 Oct 2026).

```
Watch (Cosmos) → Measure (MediaPipe) → Coach (GPT) → Show (GPT Image) → Verify (MediaPipe again)
```

## Quick start

```bash
npm install            # also copies the MediaPipe wasm + downloads the pose models into public/
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

With **no keys at all** the app still works end to end:
- The sample clip (or `D` on the landing page, or `/analyze?demo=pullup`) runs the cached demo pipeline with the same animations.
- Uploads fall back to an on-device pose scan, a rule-based coach, and a ghost target skeleton instead of a generated image.

## Environment variables

| Variable | Needed for | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Coach, corrected image, GPT-vision scan fallback | Models: `OPENAI_COACH_MODEL` (default `gpt-6.1-sol`), `OPENAI_IMAGE_MODEL` (`gpt-image-2.5-flare`) |
| `NVIDIA_API_KEY` | Hosted Nemotron-3-Nano-Omni video scan (fallback #2) | Free key from build.nvidia.com (`nvapi-…`) |
| `COSMOS_BASE_URL` / `COSMOS_API_KEY` | **Cosmos 3 Reasoner** scan (primary) | Hackathon `COSMOS3_REASON_URL` and `GPU_BEARER_TOKEN`, or a self-hosted NIM at `http://localhost:8000`. The model is auto-discovered via `/v1/models` |
| `COSMOS_INPUT_MODE` | | `video_frames` (default) · `video_url` · `image_frames`. A 400/422 on `video_frames` auto-retries in `image_frames` |
| `DEMO_MODE=1` | Kiosk mode | Analysis API routes return fixtures; VAST remains separately configured |
| `MOCK_AI=1` | Tests | Same as `DEMO_MODE` for the routes; used by Playwright |

See `.env.example` for timeouts and the remaining options. Check what is configured at `GET /api/health`, and probe live reachability with `GET /api/health?probe=1`.

## VAST workout library and W&B Weave

Open `/library` to search an existing VAST workout collection and review matching clips. The library requires a separate team access key. It shows a setup message until VAST credentials and an indexed gym collection are configured; analysis uploads are not indexed automatically.

Optional W&B Weave tracing records provider, model, duration, outcome and a bounded error category for scan attempts, coaching and image correction. Images, prompts, coach text and search queries are excluded. Tracing is off by default, and export failures do not fail the analysis.

```bash
npm run eval:sponsors             # offline synthetic contract and privacy checks
```

See [sponsor integration setup](docs/sponsor-integrations.md) for configuration, API contracts, limitations and a proposed CoreWeave deployment path. The code and mocked tests do not establish live service connectivity or exercise-analysis accuracy.

## How it works

| Step | Where | What |
|---|---|---|
| 1. Probe + sample | Browser | Up to 40 frames at 4 fps, 448 px, with the timestamp **burned into each frame** (`t=1.25s`) so the video model's timestamps are grounded |
| 2. Scan | `/api/scan` | Provider chain **Cosmos → Nemotron Omni → GPT vision contact sheet**, then an on-device pose-only scan. Every attempt is traced |
| 3. Pick + refine | Browser | Picks the single clearest fault, then refines it with pose at 10 fps across ±0.6 s to land on the exact frame (e.g. the top of the rep) |
| 4. Measure | Browser | MediaPipe Pose (heavy) on the full-res frame, then a person-centred crop, joint angles, rule verdicts and a form score |
| 5. Coach ∥ Correct | `/api/coach` (SSE) ∥ `/api/correct` | Streaming GPT coach that must quote the measured angles; GPT Image edit that keeps the identity and scene and changes only the form |
| 6. Verify | Browser | Pose on the AFTER image, re-measure, ✓ chips. If the result is off target, it regenerates once with the measured miss |

Payloads are always downscaled JPEG frames (well under Vercel's 4.5 MB body limit). Uploaded analysis video stays in the browser. The optional workout library plays existing VAST-hosted clips through a server proxy.

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` · `lint` · `test` · `test:e2e` | Quality gates (Vitest unit + integration; Playwright e2e in Google Chrome) |
| `npm run prep-video -- IMG_0618.MOV out.mp4 4 15` | Converts an iPhone HEVC `.MOV` into a browser-safe H.264 MP4 (start 4 s, 15 s long) |
| `npm run record-demo` | Re-records `public/demo/pullup/*` fixtures from the live pipeline (needs keys and a running server) |

## Demo day checklist

1. Fill in `.env.local` (the Cosmos URL and token arrive at the 9:00 keynote), then open `/api/health?probe=1`.
2. Run a real clip end to end and note the step timings.
3. `npm run record-demo` with keys so the cached demo uses real outputs.
4. Present from `npm run build && npm run start` on the laptop. The Vercel URL is the backup.
5. If the Wi-Fi dies, press **D** on the landing page to run the cached pipeline.
6. Keep a 90-second screen recording of the full flow as the last resort.

**Keyboard:** `D` runs the demo (landing page), and `S` toggles the skeleton and angles (results).

## Notes

- **iPhone clips:** iPhone `.MOV` files are often HEVC, which desktop Chrome may not decode. Use Safari, or `npm run prep-video`.
- **Accuracy:** angles are coaching estimates from single-camera pose (typical error is 2–11°), not clinical measurements. The squat and bench targets cite literature; the deadlift, OHP, curl and pull-up thresholds are coaching heuristics and are labelled that way in the UI.
