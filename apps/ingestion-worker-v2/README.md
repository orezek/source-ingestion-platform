# ingestion-worker-v2

Lightweight ingestion worker for V2 architecture.

- minimal bootstrap from `.env`
- Fastify REST API for run lifecycle
- Pub/Sub event consumption (`crawler.detail.captured`, `crawler.run.finished`)
- MongoDB persistence (`ingestion_trigger_requests`, `ingestion_run_summaries`, `normalized_job_ads`)
- GCS JSON output writes
- V1-compatible full normalized job model (`listing`, `detail`, `rawDetailPage`, `ingestion`)

## Bootstrap `.env`

```bash
PORT=3020
SERVICE_NAME=ingestion-worker
SERVICE_VERSION=2.0.0
CONTROL_AUTH_MODE=token
CONTROL_SHARED_TOKEN=replace-me
GCP_PROJECT_ID=your-gcp-project
PUBSUB_EVENTS_TOPIC=run-events
PUBSUB_EVENTS_SUBSCRIPTION=ingestion-worker-events-subscription
OUTPUTS_BUCKET=your-output-bucket
OUTPUTS_PREFIX=ingestion
MONGODB_URI=mongodb://localhost:27017
INGESTION_PARSER_BACKEND=gemini
GEMINI_API_KEY=replace-me
LANGSMITH_API_KEY=replace-me
LOG_LEVEL=info
MAX_CONCURRENT_RUNS=4
```

Optional:

```bash
CONTROL_JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
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

The `.env.example` file is intentionally minimal and aligned with the v2 bootstrap spec.
Use the optional block above for parser/runtime tuning.

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `GET /v1/capabilities`
- `POST /v1/runs`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/cancel`
- `GET /v1/runs/:runId/outputs`

For direct `POST /v1/runs` ingestion records, each `inputRef.records[]` entry must now include:

- `source`
- `sourceId`
- `dedupeKey`
- `detailHtmlPath`
- full `listingRecord` snapshot (`adUrl`, `jobTitle`, `companyName`, `location`, `salary`,
  `publishedInfoText`, `scrapedAt`, `source`, `htmlDetailPageKey`)

## Processing modes

The worker supports two execution modes from the same `POST /v1/runs` endpoint:

1. Direct REST mode

- `inputRef.records` is non-empty.
- Worker starts processing immediately from provided records.
- Run finalizes when internal queue and active item count reach zero.

2. Event-driven Pub/Sub mode

- `inputRef.records` is an empty array (`[]`).
- Worker waits for `crawler.detail.captured` events to enqueue items.
- Run finalizes only after `crawler.run.finished` is received and queue/active items are drained.
- If `crawler.run.finished` is never received, run stays `running`.

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
export INGESTION_WORKER_V2_E2E_CRAWL_RUN_SUMMARIES_COLLECTION='crawl_run_summaries'
export INGESTION_WORKER_V2_E2E_INGESTION_RUN_SUMMARIES_COLLECTION='ingestion_run_summaries'
export INGESTION_WORKER_V2_E2E_INGESTION_TRIGGER_REQUESTS_COLLECTION='ingestion_trigger_requests'
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
    "workerType": "ingestion",
    "runId": "crawl-run-local-001",
    "idempotencyKey": "idmp-crawl-run-local-001",
    "requestedAt": "2026-03-05T10:00:00.000Z",
    "correlationId": "corr-crawl-run-local-001",
    "manifestVersion": 2,
    "runtimeSnapshot": {
      "ingestionConcurrency": 2,
      "ingestionEnabled": true
    },
    "inputRef": {
      "crawlRunId": "crawl-run-local-001",
      "searchSpaceId": "default",
      "records": []
    },
    "persistenceTargets": {
      "dbName": "crawl-ops",
      "crawlRunSummariesCollection": "crawl_run_summaries",
      "ingestionRunSummariesCollection": "ingestion_run_summaries",
      "ingestionTriggerRequestsCollection": "ingestion_trigger_requests",
      "normalizedJobAdsCollection": "normalized_job_ads"
    },
    "outputSinks": [
      {
        "type": "mongodb",
        "collection": "normalized_job_ads",
        "writeMode": "upsert"
      }
    ],
    "eventContext": {
      "requestedBy": "operator",
      "tags": {
        "env": "local"
      }
    }
  }'
```

## Publish mock crawler event via Pub/Sub

Use a local HTML path in `artifact.storagePath` or a `gs://` URI.

```bash
gcloud pubsub topics publish run-events \
  --message='{
    "eventId":"evt-local-1",
    "eventType":"crawler.detail.captured",
    "eventVersion":"v1",
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
    "eventVersion":"v1",
    "occurredAt":"2026-03-05T10:02:00.000Z",
    "runId":"crawl-run-local-001",
    "correlationId":"crawl-run-local-001",
    "producer":"crawler-worker",
    "payload":{
      "crawlRunId":"crawl-run-local-001",
      "searchSpaceId":"default",
      "status":"succeeded",
      "summaryPath":"",
      "datasetPath":"",
      "newJobsCount":1,
      "failedRequests":0,
      "stopReason":"completed"
    }
  }'
```

Inspect run and outputs:

```bash
curl -H "Authorization: Bearer $CONTROL_SHARED_TOKEN" \
  http://127.0.0.1:3020/v1/runs/crawl-run-local-001

curl -H "Authorization: Bearer $CONTROL_SHARED_TOKEN" \
  http://127.0.0.1:3020/v1/runs/crawl-run-local-001/outputs
```
