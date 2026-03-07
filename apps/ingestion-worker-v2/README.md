# ingestion-worker-v2

Lightweight ingestion worker for V2 architecture.

- minimal bootstrap from `.env`
- Fastify REST API for run lifecycle
- Pub/Sub event consumption (`crawler.detail.captured`, `crawler.run.finished`)
- MongoDB persistence (`ingestion_run_summaries`, `normalized_job_ads`)
- GCS JSON output writes
- V1-compatible full normalized job model (`listing`, `detail`, `rawDetailPage`, `ingestion`)

## Bootstrap `.env`

```bash
CONTROL_SHARED_TOKEN=replace-me
GCP_PROJECT_ID=your-gcp-project
PUBSUB_EVENTS_TOPIC=run-events
OUTPUTS_BUCKET=your-output-bucket
MONGODB_URI=mongodb://localhost:27017
INGESTION_PARSER_BACKEND=fixture
```

Production parser backend (Gemini):

```bash
INGESTION_PARSER_BACKEND=gemini
GEMINI_API_KEY=replace-me
LANGSMITH_API_KEY=replace-me
```

Optional overrides:

```bash
PORT=3020
SERVICE_NAME=ingestion-worker
SERVICE_VERSION=2.0.0
CONTROL_AUTH_MODE=token
CONTROL_JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
PUBSUB_EVENTS_SUBSCRIPTION=ingestion-worker-events-subscription
OUTPUTS_PREFIX=ingestion
LOG_LEVEL=info
LOG_PRETTY=false
MAX_CONCURRENT_RUNS=4
PUBSUB_AUTO_CREATE_SUBSCRIPTION=true
ENABLE_PUBSUB_CONSUMER=true
LLM_EXTRACTOR_PROMPT_NAME=jobcompass-job-ad-structured-extractor
LLM_CLEANER_PROMPT_NAME=jobcompass-job-ad-text-cleaner
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_TEMPERATURE=0
GEMINI_THINKING_LEVEL=LOW
GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS=0.5
GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS=3
DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS=700
LOG_TEXT_TRANSFORM_CONTENT=false
LOG_TEXT_TRANSFORM_PREVIEW_CHARS=1200
PARSER_VERSION=ingestion-worker-v2-v1-model
```

When `ENABLE_PUBSUB_CONSUMER=true` and `PUBSUB_AUTO_CREATE_SUBSCRIPTION=true`, startup now
auto-creates both the Pub/Sub topic and subscription if they do not exist.
The runtime service account must have Pub/Sub create permissions.
Set `LOG_PRETTY=true` for human-readable local logs (TTY only); otherwise logs stay structured JSON.

The `.env.example` file is intentionally minimal and aligned with the v2 bootstrap spec.
Use the optional block above for parser/runtime tuning.

## Database routing policy

`MONGODB_URI` is the only MongoDB bootstrap variable in `.env`.

Database routing is provided per run through `StartRun.persistenceTargets.dbName` and must be
owned by the control plane/orchestrator, not the worker bootstrap env.

Recommended v2 policy:

- map one logical database to one pipeline (isolation boundary)
- derive database names from stable pipeline identity (pipeline id), not mutable display name
- enforce backend-safe naming limits during generation (current hard safety target: max 38 chars)
- keep generation deterministic (`same pipeline id -> same dbName`)
- keep collection names stable (`crawl_run_summaries`, `ingestion_run_summaries`,
  `normalized_job_ads`)

output routing rule:

- MongoDB writes to canonical `normalized_job_ads` are always on
- `outputSinks` is ingestion-only and only enables optional downloadable JSON writes
- `outputSinks` does not carry bucket paths or collection names; those stay in worker bootstrap/env
  and fixed platform conventions

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /v1/runs`
- `POST /v1/runs/:runId/cancel`
- `GET /v1/runs/:runId/outputs`

`POST /v1/runs` registers one event-driven ingestion run. The payload must include:

- `runId`
- `idempotencyKey`
- `runtimeSnapshot.ingestionConcurrency` (optional telemetry/config snapshot)
- `inputRef.crawlRunId`
- `inputRef.searchSpaceId`
- `persistenceTargets.dbName`
- optional `outputSinks`

## Execution model

The worker supports one execution mode only:

- `POST /v1/runs` creates an event-driven run registration.
- The worker waits for `crawler.detail.captured` events to enqueue items.
- The run finalizes only after `crawler.run.finished` is received and queue/active items are
  drained.
- If `crawler.run.finished` is never received, the run stays `running`.

Current concurrency semantics:

- The worker accepts multiple runs at once.
- `MAX_CONCURRENT_RUNS` is a global item-processing pool across all runs.
- `runtimeSnapshot.ingestionConcurrency` is currently persisted in summary telemetry and is not used
  as a scheduler throttle.

Event correlation safety:

- Each active run must use a unique `inputRef.crawlRunId`.
- If multiple running runs match incoming crawler events by `crawlRunId`, those events are skipped
  as ambiguous.

## Local run

```bash
pnpm -C apps/ingestion-worker-v2 dev
```

## Run E2E tests (MongoDB Atlas/shared DB)

The E2E suite is in `test/e2e` and uses editable stubs from `test/e2e/stubs` for Pub/Sub and
GCS while writing real run data to MongoDB.
The fixtures use real V1 HTML dumps:

- `test/fixtures/job-html-2001063102.html`
- `test/fixtures/job-html-2001090812.html`
- `test/fixtures/job-html-2001095645.html`

Set these variables before running:

```bash
export INGESTION_WORKER_V2_E2E_MONGODB_URI='mongodb+srv://...'
export INGESTION_WORKER_V2_E2E_DB_NAME='ingestion_worker_v2_shared_e2e'
export INGESTION_WORKER_V2_E2E_INGESTION_RUN_SUMMARIES_COLLECTION='ingestion_run_summaries'
export INGESTION_WORKER_V2_E2E_NORMALIZED_JOB_ADS_COLLECTION='normalized_job_ads'
export INGESTION_WORKER_V2_E2E_KEEP_ARTIFACTS='true'
export INGESTION_WORKER_V2_E2E_PARSER_BACKEND='gemini'
export INGESTION_WORKER_V2_E2E_GEMINI_API_KEY='...'
export INGESTION_WORKER_V2_E2E_LANGSMITH_API_KEY='...'
export INGESTION_WORKER_V2_E2E_GEMINI_MODEL='gemini-3-flash-preview'
export INGESTION_WORKER_V2_E2E_PARSER_VERSION='ingestion-worker-v2-v1-model-test'
export INGESTION_WORKER_V2_E2E_RUN_TIMEOUT_MS='180000'
export INGESTION_WORKER_V2_E2E_DOC_TIMEOUT_MS='180000'
export INGESTION_WORKER_V2_E2E_EVENT_TIMEOUT_MS='30000'
```

Template file: `.env.e2e.example`

Run:

```bash
pnpm -C apps/ingestion-worker-v2 test:e2e
```

## Start run via curl

```bash
curl -X POST http://127.0.0.1:3020/v1/runs \
  -H "Authorization: Bearer $CONTROL_SHARED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contractVersion": "v2",
    "runId": "crawl-run-local-001",
    "idempotencyKey": "idmp-crawl-run-local-001",
    "runtimeSnapshot": {
      "ingestionConcurrency": 2
    },
    "inputRef": {
      "crawlRunId": "crawl-run-local-001",
      "searchSpaceId": "default"
    },
    "persistenceTargets": {
      "dbName": "crawl-ops"
    },
    "outputSinks": [
      {
        "type": "downloadable_json"
      }
    ]
  }'
```

## Publish mock crawler event via Pub/Sub

Use a local HTML path in `artifact.storagePath` or a `gs://` URI.

V2 note:

- canonical runtime broker event shape is V2 (`eventVersion: "v2"`)
- the worker still accepts legacy V1 crawler events during the transition period

```bash
gcloud pubsub topics publish run-events \
  --message='{
    "eventId":"evt-local-1",
    "eventType":"crawler.detail.captured",
    "eventVersion":"v2",
    "occurredAt":"2026-03-05T10:01:00.000Z",
    "runId":"crawl-run-local-001",
    "correlationId":"jobs.cz:default:crawl-run-local-001:2000905774",
    "producer":"crawler-worker",
    "payload":{
      "crawlRunId":"crawl-run-local-001",
      "searchSpaceId":"default",
      "source":"jobs.cz",
      "sourceId":"2000905774",
      "listingRecord":{
        "sourceId":"2000905774",
        "adUrl":"https://www.jobs.cz/rpd/2000905774/",
        "jobTitle":"Senior Software Engineer",
        "companyName":"Example Corp",
        "location":"Prague",
        "salary":null,
        "publishedInfoText":null,
        "scrapedAt":"2026-03-05T10:00:30.000Z",
        "source":"jobs.cz",
        "htmlDetailPageKey":"job-html-2000905774.html"
      },
      "artifact":{
        "artifactType":"html",
        "storageType":"local_filesystem",
        "storagePath":"/absolute/path/to/mock-job.html",
        "checksum":"dev-checksum",
        "sizeBytes":12345
      },
      "dedupeKey":"jobs.cz:default:crawl-run-local-001:2000905774"
    }
  }'
```

Then signal completion:

```bash
gcloud pubsub topics publish run-events \
  --message='{
    "eventId":"evt-local-2",
    "eventType":"crawler.run.finished",
    "eventVersion":"v2",
    "occurredAt":"2026-03-05T10:02:00.000Z",
    "runId":"crawl-run-local-001",
    "correlationId":"crawl-run-local-001",
    "producer":"crawler-worker",
    "payload":{
      "crawlRunId":"crawl-run-local-001",
      "source":"jobs.cz",
      "searchSpaceId":"default",
      "status":"succeeded",
      "stopReason":"completed"
    }
  }'
```

Inspect outputs:

```bash
curl -H "Authorization: Bearer $CONTROL_SHARED_TOKEN" \
  http://127.0.0.1:3020/v1/runs/crawl-run-local-001/outputs
```
