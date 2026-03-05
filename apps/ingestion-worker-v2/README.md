# ingestion-worker-v2

Lightweight ingestion worker for V2 architecture.

- minimal bootstrap from `.env`
- Fastify REST API for run lifecycle
- Pub/Sub event consumption (`crawler.detail.captured`, `crawler.run.finished`)
- MongoDB persistence (`ingestion_trigger_requests`, `ingestion_run_summaries`, `normalized_job_ads`)
- GCS JSON output writes

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
MONGODB_DB_NAME=crawl-ops
LOG_LEVEL=info
MAX_CONCURRENT_RUNS=4
```

Optional:

```bash
CONTROL_JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
PUBSUB_AUTO_CREATE_SUBSCRIPTION=true
ENABLE_PUBSUB_CONSUMER=true
MONGODB_INGESTION_RUN_SUMMARIES_COLLECTION=ingestion_run_summaries
MONGODB_INGESTION_TRIGGER_REQUESTS_COLLECTION=ingestion_trigger_requests
MONGODB_NORMALIZED_JOB_ADS_COLLECTION=normalized_job_ads
```

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `GET /v1/capabilities`
- `POST /v1/runs`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/cancel`
- `GET /v1/runs/:runId/outputs`

## Local run

```bash
pnpm -C apps/ingestion-worker-v2 dev
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
    "pipelineSnapshot": {
      "id": "pipeline-local",
      "name": "Pipeline local",
      "version": 1,
      "mode": "crawl_and_ingest",
      "searchSpaceId": "default",
      "runtimeProfileId": "runtime-local",
      "structuredOutputDestinationIds": ["mongo-normalized-jobs", "downloadable-json-default"]
    },
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
