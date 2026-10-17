# Sponsor integrations

Gym Bro has two optional integrations: a VAST library for finding indexed workout footage, and W&B Weave for metadata about model calls. Both are disabled by default. They have local contract tests; live retrieval, playback and trace readback still need credentials and an indexed gym collection.

## VAST workout library

The `/library` page sends a natural-language query to the VAST Video Search and Summarization (VSS) retrieval service, restricts the search to the configured workout tag, and displays the returned clips. This is a shared team library. It does not save browser uploads, create a personal workout history, or ingest new footage.

The [official challenge starter](https://github.com/vast-data/vast-builders-challenge) documents the service. Its challenge setup currently works with existing indexed segments. Confirm which gym clips are available to your team before enabling this feature. A tag filter narrows retrieval; it does not establish that the collection contains gym footage or that a match is correct.

Set these values on the server in `.env.local` or your deployment's secret settings:

| Variable | Purpose |
| --- | --- |
| `VAST_ENABLED=1` | Enable the library integration |
| `VAST_BASE_URL` | VSS service root, including any ingress prefix. This is separate from `COSMOS_BASE_URL` |
| `VAST_WORKOUT_TAG` | Exact tag for the team's existing indexed gym collection |
| `VAST_APP_ACCESS_KEY` | Separate random team access key, 32 to 512 characters; share through a secure channel |
| `VAST_BEARER_TOKEN` | VSS bearer token, or use `VAST_USERNAME` and `VAST_PASSWORD` instead |
| `VAST_USERNAME`, `VAST_PASSWORD` | VSS login credentials when a bearer token is not set |
| `VAST_ALLOW_HTTP=1` | Optional exception for a trusted private workshop or local HTTP endpoint; HTTPS is the default |

Keep provider credentials server-side. The library page asks only for the separate team access key, holds it in memory and sends it in the `x-vast-access-key` header. It is not saved to browser storage. Use HTTPS for the app. This shared key is a prototype access control; a public multi-user deployment needs individual authentication, dataset authorisation and rate limiting.

| App route | Behaviour |
| --- | --- |
| `GET /api/vast/status` | Configuration flags only; does not probe VAST |
| `POST /api/vast/search` | Requires the team key; accepts `{ "query": "side view of a squat", "limit": 5 }` |
| `GET /api/vast/clip?ticket=...` | Plays a result through an opaque, authenticated link that expires after ten minutes |

Search accepts 3 to 500 characters and 1 to 10 results. It uses the VSS `/api/v1/search` endpoint with the configured tag and `include_public: false`. Empty results remain empty. Missing configuration returns `503`; failed authorisation returns `401`; upstream failures return a safe error without provider response text.

Playback uses the VSS `/api/v1/videos/stream` endpoint. The server keeps provider tokens and source addresses out of browser responses. Each video response is bounded to 8 MiB. Redirects are rejected. Search has a 20-second deadline and playback a 15-second deadline. The browser must support the stored video codec. Search again if a playback link expires.

`DEMO_MODE` and `MOCK_AI` apply to the analysis pipeline. They do not fabricate library results or disable an independently enabled VAST connection. Leave `VAST_ENABLED=0` for a fully offline demo.

## W&B Weave

Set `WEAVE_ENABLED=1`, `WANDB_API_KEY` and `WEAVE_PROJECT=entity/project` to enable tracing. `WEAVE_TRACE_BASE_URL` defaults to `https://trace.wandb.ai`; override it only for your approved HTTPS deployment. `WEAVE_TIMEOUT_MS` defaults to 750 ms and is bounded between 100 and 2000 ms for the entire export.

The exporter uses the [documented Weave Service API](https://docs.coreweave.com/products/wandb/weave/cookbooks/weave_via_service_api) to start and end a call. It sends only operation, provider, optional model identifier, mode, duration, outcome and a bounded error category. Synthetic evaluation exports also include the number of passed checks. Inputs are empty and outputs are null. Uploaded frames, prompts, model responses, free-form errors and VAST search queries are not captured.

Scan attempts are recorded separately, so a fallback remains visible. Coaching records completion or failure inside the response stream. Image correction records the overall correction request. Cached and mock analysis routes do not export traces. `/api/health` exposes only Weave configuration flags; those flags do not prove connectivity or a successful export.

Export is best effort, without retries or a durable queue. Failed export cannot fail analysis, but it can leave no trace or an unfinished trace if the start request succeeded and the end request failed. Export deadlines can add a small bounded delay to the response. These traces are operational metadata, not evidence that a form judgement is accurate.

## Local evaluation and live acceptance

```bash
npm run eval:sponsors
```

This runs eight synthetic checks for disabled exports, content exclusion, failure isolation, endpoint policy, mode labels, error categories, durations and fallback metadata. It makes no provider inference calls and measures no video accuracy. The ordinary test suite covers VAST routes, playback bounds, access controls and the library interface with mocked services.

To deliberately send one aggregate synthetic evaluation trace, provide the Weave environment variables to the shell and run:

```bash
npm run eval:sponsors -- --export
```

The command does not load `.env.local` automatically. Export happens only with `--export`; it exits unsuccessfully if the requested export was not sent.

Before describing the integrations as live, check the following against your own services:

1. Confirm the indexed gym collection, permitted team access and a known clip.
2. Search for that clip, play it and seek through it in the target browser. Check an empty query result and an expired playback link too.
3. Run an actual analysis and read back the scan, coach and correction traces in the intended Weave project. Check that no workout content appears in them.
4. Evaluate form judgements separately against labelled clips reviewed by a qualified person. Synthetic policy checks do not measure this.

## CoreWeave deployment suggestion

The implemented CoreWeave-associated integration is W&B Weave. GPU hosting has not been provisioned. A proposed next step is to evaluate [CoreWeave Dedicated Inference](https://www.coreweave.com/products/coreweave-forge/dedicated-inference) for hosting the existing Cosmos inference service and configure `COSMOS_BASE_URL`, its model and credentials. First verify that the endpoint accepts the app's frame payload and response schema.

Use the same labelled workout clips to compare the hosted model with the current provider chain. Measure detection quality, latency, fallback rate and cost before changing the default. Keep VAST retrieval and Cosmos inference as separate endpoints. No CoreWeave account, GPU instance or paid deployment is created by this change.
