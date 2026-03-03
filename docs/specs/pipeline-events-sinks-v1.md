# Spec Draft: Pipeline Event Contracts and Sink Adapters v1

## Status

- draft
- implementation-facing follow-up to the v1 control-plane architecture

## Purpose

Define the v1 event contracts between control plane, crawler, and ingestion, and define the adapter interfaces for artifacts and structured output sinks.

## Scope Boundaries

V1 assumptions:

- broker is transport only
- business documents are not written by the broker
- ingestion worker owns canonical normalization and sink writes
- raw HTML artifacts are always persisted
- structured outputs use one canonical document shape

Deferred from this spec:

- output-template transformations
- orchestrator topic layer
- dedicated downstream writer stage

## Eventing Model

### Transport assumptions

V1 should support:

- Google Cloud Pub/Sub adapter
- local development adapter behind the same interface

Delivery semantics should be treated as:

- at-least-once delivery

Consumers must therefore be:

- idempotent
- safe on duplicate delivery
- safe on retry after partial failure

### Event envelope

All events should use a common envelope.

Required envelope fields:

- `eventId`
- `eventType`
- `eventVersion`
- `occurredAt`
- `runId`
- `correlationId`
- `producer`
- `payload`

Suggested envelope example:

```json
{
  "eventId": "evt_01",
  "eventType": "crawler.detail.captured",
  "eventVersion": "v1",
  "occurredAt": "2026-03-03T12:00:00.000Z",
  "runId": "run_01",
  "correlationId": "run_01:jobs.cz:12345",
  "producer": "crawler-worker",
  "payload": {}
}
```

## Event Types

### 1. Run command

#### `crawler.run.requested.v1`

Produced by:

- control plane

Consumed by:

- crawler worker

Required payload fields:

- `runManifest`

### 2. Detail artifact handoff

#### `crawler.detail.captured.v1`

Produced by:

- crawler worker

Consumed by:

- ingestion worker
- control plane

Required payload fields:

- `crawlRunId`
- `searchSpaceId`
- `source`
- `sourceId`
- `listingRecord`
- `artifact`
- `dedupeKey`

Suggested payload example:

```json
{
  "crawlRunId": "crawl_01",
  "searchSpaceId": "prague-tech-jobs",
  "source": "jobs.cz",
  "sourceId": "2001077729",
  "listingRecord": {
    "sourceId": "2001077729",
    "adUrl": "https://www.jobs.cz/rpd/2001077729/",
    "jobTitle": "Senior Engineer",
    "companyName": "Example Company",
    "location": "Praha",
    "salary": "75 000 - 90 000 Kč",
    "publishedInfoText": "New",
    "scrapedAt": "2026-03-03T12:00:00.000Z",
    "source": "jobs.cz",
    "htmlDetailPageKey": "job-html-2001077729.html"
  },
  "artifact": {
    "artifactType": "html",
    "storageType": "local_filesystem",
    "storagePath": "/abs/path/to/job-html-2001077729.html",
    "checksum": "sha256:abc",
    "sizeBytes": 12345
  },
  "dedupeKey": "jobs.cz:prague-tech-jobs:crawl_01:2001077729"
}
```

### 3. Crawl completion

#### `crawler.run.finished.v1`

Produced by:

- crawler worker

Consumed by:

- control plane

Required payload fields:

- `crawlRunId`
- `searchSpaceId`
- `status`
- `summaryPath`
- `datasetPath`
- `newJobsCount`
- `failedRequests`
- `stopReason`

V1 keeps crawler lifecycle events intentionally compact.

Queued and running state can be persisted through local control-plane runtime files in addition to
broker events.

### 4. Ingestion lifecycle

#### `ingestion.item.started.v1`

Produced by:

- ingestion worker

Consumed by:

- control plane

Required payload fields:

- `crawlRunId`
- `source`
- `sourceId`
- `dedupeKey`

#### `ingestion.item.succeeded.v1`

Produced by:

- ingestion worker

Consumed by:

- control plane

Required payload fields:

- `crawlRunId`
- `source`
- `sourceId`
- `documentId`
- `sinkResults`
- `dedupeKey`

#### `ingestion.item.failed.v1`

Produced by:

- ingestion worker

Consumed by:

- control plane

Meaning:

- execution failed
- retry may be appropriate

Required payload fields:

- `crawlRunId`
- `source`
- `sourceId`
- `error`
- `dedupeKey`

#### `ingestion.item.rejected.v1`

Produced by:

- ingestion worker

Consumed by:

- control plane

Meaning:

- artifact was processed
- the input was rejected as terminal for the current rules
- retry is not the default action

Required payload fields:

- `crawlRunId`
- `source`
- `sourceId`
- `reason`
- `dedupeKey`

## Idempotency Rules

### Run command idempotency

- `crawler.run.requested.v1` must be idempotent by `runId`

### Item handoff idempotency

- `crawler.detail.captured.v1` must include a stable `dedupeKey`
- the ingestion worker must treat duplicate deliveries for the same `dedupeKey` safely

### Sink-write idempotency

- sink adapters must support idempotent writes where possible
- MongoDB writes should use stable document IDs
- file and object-storage writes should use deterministic paths per run/item or explicit overwrite rules

## Broker Responsibility Boundary

The broker should:

- carry commands
- carry events
- support retries and dead-letter handling

The broker should not:

- perform normalization
- perform output-template mapping
- write business documents to MongoDB

In v1, sink writes remain inside the ingestion worker.

## Artifact Store Adapter Interface

The artifact store abstraction should be shared by crawler and ingestion.

Suggested interface:

```ts
export type StoredArtifactRef = {
  storageType: 'local_filesystem' | 'gcs';
  storagePath: string;
  checksum: string;
  sizeBytes: number;
};

export interface ArtifactStoreAdapter {
  writeHtmlArtifact(input: {
    runId: string;
    source: string;
    sourceId: string;
    fileName: string;
    html: string;
  }): Promise<StoredArtifactRef>;

  readArtifactText(ref: StoredArtifactRef): Promise<string>;
}
```

V1 implementations:

- local filesystem artifact store
- Google Cloud Storage artifact store

Operator boundary:

- the artifact store is platform-managed in v1
- operators browse and download artifacts through the dashboard
- storage paths, local directories, buckets, and prefixes are internal runtime details

### Artifact path and naming rule

In v1, the artifact-store adapter must preserve the current logical layout and naming convention.

Required behavior:

- one namespace per run
- run-scoped path under `runs/<crawlRunId>/`
- HTML artifacts written under `records/`
- HTML filename remains `job-html-<sourceId>.html`
- dataset metadata file remains `dataset.json`

Canonical logical layout:

```text
runs/<crawlRunId>/
  dataset.json
  records/
    job-html-<sourceId>.html
```

Only the adapter root changes.

Examples:

- local filesystem:
  - `<basePath>/runs/<crawlRunId>/records/job-html-<sourceId>.html`
- GCS:
  - `gs://<bucket>/<prefix>/runs/<crawlRunId>/records/job-html-<sourceId>.html`

This means the v1 adapter contract preserves the current crawler file naming and run directory structure.

## Structured Output Sink Interface

The structured-output sink abstraction should be owned by ingestion.

Suggested interface:

```ts
export type StructuredSinkWriteResult = {
  sinkType: 'mongodb' | 'downloadable_json';
  targetRef: string;
  writeMode: 'upsert' | 'overwrite';
};

export interface StructuredOutputSink {
  writeCanonicalDocument(input: {
    runId: string;
    crawlRunId: string | null;
    source: string;
    sourceId: string;
    document: unknown;
  }): Promise<StructuredSinkWriteResult>;
}
```

V1 implementations:

- MongoDB canonical-document sink
- managed downloadable-JSON sink backed by local filesystem or GCS

### MongoDB sink compatibility requirement

The MongoDB sink must preserve the current storage topology in v1.

That means:

- database is resolved per search space
- database name follows `<JOB_COMPASS_DB_PREFIX>-<searchSpaceId>`
- collection names remain:
  - `normalized_job_ads`
  - `crawl_run_summaries`
  - `ingestion_run_summaries`
  - `ingestion_trigger_requests`

Summary persistence compatibility:

- crawler worker continues to write crawler summaries to `crawl_run_summaries`
- ingestion worker continues to write ingestion summaries to `ingestion_run_summaries`
- current summary document shapes remain the baseline contract for v1
- v1 additions must be additive only

## Sink Routing Rules

In v1:

- pipeline configuration selects the active sinks
- ingestion writes the canonical document to each configured sink
- success and failure must be reported per sink
- downloadable JSON remains accessible through the dashboard rather than by exposing raw storage paths

If one sink succeeds and another fails:

- the item should not be reported as a clean success
- sink-level results must be included in the emitted event or summary

## Local Development Rules

V1 should allow:

- local filesystem artifact store
- managed downloadable JSON on local filesystem
- local MongoDB sink
- local broker adapter
- optional real Google Cloud Pub/Sub and GCS-backed downloadable JSON for integration testing

## Deferred Beyond V1

- output-template-aware sink writes
- separate delivery writer worker
- orchestrator topic layer
- downstream fan-out routing
- token-saving reuse cache

## Recommended Follow-Up Specs

This spec should be paired with:

1. `docs/specs/control-plane-domain-api-v1.md`
2. crawler worker adaptation spec
3. ingestion worker adaptation spec
