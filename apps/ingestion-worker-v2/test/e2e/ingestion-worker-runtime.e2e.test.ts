import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Bucket, Storage } from '@google-cloud/storage';
import type { Topic } from '@google-cloud/pubsub';
import {
  buildCrawlerDetailCapturedEvent,
  buildCrawlerRunFinishedEvent,
  ingestionStartRunRequestV2Schema,
} from '@repo/control-plane-contracts';
import { MongoClient } from 'mongodb';
import type { EnvSchema } from '../../src/env.js';
import { IngestionWorkerRuntime } from '../../src/runtime.js';
import { FakeLogger } from './stubs/fake-logger.js';
import { FakeStorage } from './stubs/fake-storage.js';
import { FakePubSubTopic } from './stubs/fake-topic.js';

type CollectionNames = {
  crawlRunSummaries: string;
  ingestionRunSummaries: string;
  ingestionTriggerRequests: string;
  normalizedJobAds: string;
};

type RunView = {
  status: 'running' | 'succeeded' | 'completed_with_errors' | 'failed' | 'stopped';
  counters: {
    received: number;
    processed: number;
    failed: number;
    rejected: number;
  };
  outputsCount: number;
  waitForCrawlerFinished: boolean;
  crawlerFinished: boolean;
};

type RuntimeFixture = {
  runtime: IngestionWorkerRuntime;
  topic: FakePubSubTopic;
  outputBucket: ReturnType<FakeStorage['bucket']>;
  logger: FakeLogger;
};

const mongoUri = process.env.INGESTION_WORKER_V2_E2E_MONGODB_URI ?? process.env.MONGODB_URI;
const parserBackendRaw = (process.env.INGESTION_WORKER_V2_E2E_PARSER_BACKEND ?? 'gemini')
  .trim()
  .toLowerCase();
const parserBackend: 'gemini' | 'fixture' = parserBackendRaw === 'fixture' ? 'fixture' : 'gemini';
const geminiModel = process.env.INGESTION_WORKER_V2_E2E_GEMINI_MODEL ?? 'gemini-3-flash-preview';
const parserVersion =
  process.env.INGESTION_WORKER_V2_E2E_PARSER_VERSION ?? 'ingestion-worker-v2-v1-model-test';
const geminiApiKey =
  process.env.INGESTION_WORKER_V2_E2E_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
const langsmithApiKey =
  process.env.INGESTION_WORKER_V2_E2E_LANGSMITH_API_KEY ?? process.env.LANGSMITH_API_KEY;

const skipReasons: string[] = [];
if (!mongoUri || mongoUri.trim().length === 0) {
  skipReasons.push(
    'Set INGESTION_WORKER_V2_E2E_MONGODB_URI (or MONGODB_URI) before running ingestion-worker-v2 E2E tests.',
  );
}
if (parserBackend === 'gemini' && (!geminiApiKey || geminiApiKey.trim().length === 0)) {
  skipReasons.push(
    'Set INGESTION_WORKER_V2_E2E_GEMINI_API_KEY (or GEMINI_API_KEY) when INGESTION_WORKER_V2_E2E_PARSER_BACKEND=gemini.',
  );
}
if (parserBackend === 'gemini' && (!langsmithApiKey || langsmithApiKey.trim().length === 0)) {
  skipReasons.push(
    'Set INGESTION_WORKER_V2_E2E_LANGSMITH_API_KEY (or LANGSMITH_API_KEY) when INGESTION_WORKER_V2_E2E_PARSER_BACKEND=gemini.',
  );
}
const skipReason = skipReasons.length > 0 ? skipReasons.join(' ') : undefined;
const runTimeoutMs = Number(
  process.env.INGESTION_WORKER_V2_E2E_RUN_TIMEOUT_MS ??
    (parserBackend === 'gemini' ? '180000' : '12000'),
);
const docTimeoutMs = Number(
  process.env.INGESTION_WORKER_V2_E2E_DOC_TIMEOUT_MS ??
    (parserBackend === 'gemini' ? '180000' : '12000'),
);
const eventTimeoutMs = Number(
  process.env.INGESTION_WORKER_V2_E2E_EVENT_TIMEOUT_MS ??
    (parserBackend === 'gemini' ? '30000' : '5000'),
);

const sharedDbName =
  process.env.INGESTION_WORKER_V2_E2E_DB_NAME?.trim() || 'ingestion_worker_v2_shared_e2e';

const collections: CollectionNames = {
  crawlRunSummaries:
    process.env.INGESTION_WORKER_V2_E2E_CRAWL_RUN_SUMMARIES_COLLECTION?.trim() ||
    'crawl_run_summaries',
  ingestionRunSummaries:
    process.env.INGESTION_WORKER_V2_E2E_INGESTION_RUN_SUMMARIES_COLLECTION?.trim() ||
    'ingestion_run_summaries',
  ingestionTriggerRequests:
    process.env.INGESTION_WORKER_V2_E2E_INGESTION_TRIGGER_REQUESTS_COLLECTION?.trim() ||
    'ingestion_trigger_requests',
  normalizedJobAds:
    process.env.INGESTION_WORKER_V2_E2E_NORMALIZED_JOB_ADS_COLLECTION?.trim() ||
    'normalized_job_ads',
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(currentDir, '../fixtures');
type ListingRecordSnapshot = {
  sourceId: string;
  adUrl: string;
  jobTitle: string;
  companyName: string | null;
  location: string | null;
  salary: string | null;
  publishedInfoText: string | null;
  scrapedAt: string;
  source: string;
  htmlDetailPageKey: string;
};

type GoldenParityCase = {
  sourceId: string;
  fixtureFileName: string;
  listingRecord: ListingRecordSnapshot;
  expectedTitleTokens: string[];
  expectedSemanticTokens: string[];
  minCleanDetailChars: number;
};

const goldenParityCases: GoldenParityCase[] = [
  {
    sourceId: '2001063102',
    fixtureFileName: 'job-html-2001063102.html',
    listingRecord: {
      sourceId: '2001063102',
      adUrl:
        'https://www.jobs.cz/rpd/2001063102/?searchId=793f06bf-b653-4637-8010-5c1bebdf0970&rps=233',
      jobTitle: 'Technical Program Manager',
      companyName: 'Univerzita Karlova – Matematicko-fyzikální fakulta',
      location: 'Praha – Malá Strana',
      salary: null,
      publishedInfoText: 'Aktualizováno dnes',
      scrapedAt: '2026-03-05T10:00:00.000Z',
      source: 'jobs.cz',
      htmlDetailPageKey: 'job-html-2001063102.html',
    },
    expectedTitleTokens: ['technical program manager', 'program manager'],
    expectedSemanticTokens: ['openeurollm', 'digital europe programme', 'eurohpc'],
    minCleanDetailChars: 2_000,
  },
  {
    sourceId: '2001090812',
    fixtureFileName: 'job-html-2001090812.html',
    listingRecord: {
      sourceId: '2001090812',
      adUrl:
        'https://www.jobs.cz/rpd/2001090812/?searchId=793f06bf-b653-4637-8010-5c1bebdf0970&rps=233',
      jobTitle: 'IT Manažer',
      companyName: 'Gas Storage CZ, a.s.',
      location: 'Praha - Strašnice',
      salary: null,
      publishedInfoText: 'Aktualizováno dnes',
      scrapedAt: '2026-03-05T10:00:00.000Z',
      source: 'jobs.cz',
      htmlDetailPageKey: 'job-html-2001090812.html',
    },
    expectedTitleTokens: ['it manazer', 'it manager'],
    expectedSemanticTokens: ['gas storage', 'it prostredi', 'energetiky'],
    minCleanDetailChars: 1_600,
  },
  {
    sourceId: '2001095645',
    fixtureFileName: 'job-html-2001095645.html',
    listingRecord: {
      sourceId: '2001095645',
      adUrl:
        'https://www.jobs.cz/rpd/2001095645/?searchId=793f06bf-b653-4637-8010-5c1bebdf0970&rps=233',
      jobTitle: 'Senior Data Scientist /ML Developer',
      companyName: 'DER Touristik CZ a.s',
      location: 'Praha - Chodov',
      salary: null,
      publishedInfoText: 'Aktualizováno dnes',
      scrapedAt: '2026-03-05T10:00:00.000Z',
      source: 'jobs.cz',
      htmlDetailPageKey: 'job-html-2001095645.html',
    },
    expectedTitleTokens: ['data scientist', 'ml developer'],
    expectedSemanticTokens: ['pricingov', 'data scientist', 'ml'],
    minCleanDetailChars: 1_800,
  },
];

const fixturePathBySourceId = new Map(
  goldenParityCases.map((fixtureCase) => [
    fixtureCase.sourceId,
    path.resolve(fixtureDir, fixtureCase.fixtureFileName),
  ]),
);
const keepArtifacts = /^(1|true|yes)$/i.test(
  process.env.INGESTION_WORKER_V2_E2E_KEEP_ARTIFACTS ?? '',
);

let mongoClient: MongoClient | null = null;

before(async () => {
  if (skipReason) {
    return;
  }

  mongoClient = new MongoClient(mongoUri!);
  await mongoClient.connect();
  await mongoClient.db(sharedDbName).command({ ping: 1 });
});

after(async () => {
  if (!mongoClient) {
    return;
  }

  await mongoClient.close();
  mongoClient = null;
});

function getMongoClient(): MongoClient {
  assert.ok(mongoClient, 'Mongo client is not initialized.');
  return mongoClient;
}

function buildRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function buildRuntimeEnv(): EnvSchema {
  return {
    PORT: 0,
    SERVICE_NAME: 'ingestion-worker-v2-e2e',
    SERVICE_VERSION: '2.0.0-test',
    LOG_LEVEL: 'silent',
    MAX_CONCURRENT_RUNS: 2,
    CONTROL_AUTH_MODE: 'token',
    CONTROL_SHARED_TOKEN: 'test-token',
    CONTROL_JWT_PUBLIC_KEY: undefined,
    GCP_PROJECT_ID: 'test-project',
    PUBSUB_EVENTS_TOPIC: 'test-events',
    PUBSUB_EVENTS_SUBSCRIPTION: undefined,
    PUBSUB_AUTO_CREATE_SUBSCRIPTION: false,
    ENABLE_PUBSUB_CONSUMER: false,
    OUTPUTS_BUCKET: 'test-output-bucket',
    OUTPUTS_PREFIX: 'e2e',
    MONGODB_URI: mongoUri!,
    INGESTION_PARSER_BACKEND: parserBackend,
    GEMINI_API_KEY: geminiApiKey,
    LANGSMITH_API_KEY: langsmithApiKey,
    LLM_EXTRACTOR_PROMPT_NAME: 'jobcompass-job-ad-structured-extractor',
    LLM_CLEANER_PROMPT_NAME: 'jobcompass-job-ad-text-cleaner',
    GEMINI_MODEL: geminiModel,
    GEMINI_TEMPERATURE: 0,
    GEMINI_THINKING_LEVEL: 'LOW',
    GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS: 0.5,
    GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS: 3,
    DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS: 100,
    LOG_TEXT_TRANSFORM_CONTENT: false,
    LOG_TEXT_TRANSFORM_PREVIEW_CHARS: 800,
    PARSER_VERSION: parserVersion,
  };
}

function buildStartRunPayload(
  runId: string,
  records: Array<{
    source: string;
    sourceId: string;
    dedupeKey: string;
    detailHtmlPath: string;
    listingRecord: {
      sourceId: string;
      adUrl: string;
      jobTitle: string;
      companyName: string | null;
      location: string | null;
      salary: string | null;
      publishedInfoText: string | null;
      scrapedAt: string;
      source: string;
      htmlDetailPageKey: string;
    };
    datasetFileName?: string;
    datasetRecordIndex?: number;
  }>,
) {
  return ingestionStartRunRequestV2Schema.parse({
    contractVersion: 'v2',
    workerType: 'ingestion',
    runId,
    idempotencyKey: `idmp-${runId}`,
    requestedAt: new Date().toISOString(),
    correlationId: `corr-${runId}`,
    manifestVersion: 2,
    runtimeSnapshot: {
      ingestionConcurrency: 2,
      ingestionEnabled: true,
      debugLog: false,
    },
    inputRef: {
      crawlRunId: runId,
      searchSpaceId: 'search-space-e2e',
      records: records.map((record, index) => ({
        source: record.source,
        sourceId: record.sourceId,
        dedupeKey: record.dedupeKey,
        detailHtmlPath: record.detailHtmlPath,
        listingRecord: record.listingRecord,
        datasetFileName: record.datasetFileName ?? 'dataset.json',
        datasetRecordIndex: record.datasetRecordIndex ?? index,
      })),
    },
    persistenceTargets: {
      dbName: sharedDbName,
      crawlRunSummariesCollection: collections.crawlRunSummaries,
      ingestionRunSummariesCollection: collections.ingestionRunSummaries,
      ingestionTriggerRequestsCollection: collections.ingestionTriggerRequests,
      normalizedJobAdsCollection: collections.normalizedJobAds,
    },
    outputSinks: [
      {
        type: 'mongodb',
        collection: collections.normalizedJobAds,
        writeMode: 'upsert',
      },
      {
        type: 'downloadable_json',
        storageType: 'gcs',
        targetPath: `gs://test-output-bucket/e2e/${runId}`,
        writeMode: 'overwrite',
      },
    ],
    eventContext: {
      requestedBy: 'ingestion-worker-v2-e2e',
      tags: {
        suite: 'runtime',
      },
    },
  });
}

function toSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function assertContainsAnyToken(value: string, expectedTokens: string[], message: string): void {
  const haystack = toSearchText(value);
  const matched = expectedTokens.some((token) => haystack.includes(toSearchText(token)));
  assert.equal(
    matched,
    true,
    `${message}. Expected one of [${expectedTokens.join(', ')}], got "${value.slice(0, 200)}"`,
  );
}

async function createRuntimeFixture(): Promise<RuntimeFixture> {
  const topic = new FakePubSubTopic();
  const storage = new FakeStorage();
  const outputBucket = storage.bucket('test-output-bucket');
  const logger = new FakeLogger();
  const runtime = new IngestionWorkerRuntime({
    env: buildRuntimeEnv(),
    logger: logger.asFastifyLogger(),
    eventsTopic: topic as unknown as Topic,
    storage: storage as unknown as Storage,
    outputsBucket: outputBucket as unknown as Bucket,
    mongoClient: getMongoClient(),
  });

  await runtime.initialize();
  runtime.setPubSubConsumerReady(true);

  return { runtime, topic, outputBucket, logger };
}

function getRunView(runtime: IngestionWorkerRuntime, runId: string): RunView {
  return runtime.getRun(runId) as unknown as RunView;
}

async function waitForRunStatus(
  runtime: IngestionWorkerRuntime,
  runId: string,
  expected: RunView['status'],
): Promise<RunView> {
  const timeoutMs = runTimeoutMs;
  const pollIntervalMs = 40;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const run = getRunView(runtime, runId);
    if (run.status === expected) {
      return run;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  throw new Error(`Timed out waiting for run "${runId}" to reach status "${expected}".`);
}

async function waitForDocument<T>(input: {
  read: () => Promise<T | null>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<T> {
  const timeoutMs = input.timeoutMs ?? docTimeoutMs;
  const pollIntervalMs = input.pollIntervalMs ?? 50;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const doc = await input.read();
    if (doc) {
      return doc;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  throw new Error('Timed out waiting for persisted Mongo document.');
}

async function waitForEventType(
  topic: FakePubSubTopic,
  eventType: string,
  timeoutMs = eventTimeoutMs,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = topic.published.some((entry) => {
      const parsed = JSON.parse(entry.payload) as { eventType?: string };
      return parsed.eventType === eventType;
    });
    if (found) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
  }

  throw new Error(`Timed out waiting for event type "${eventType}".`);
}

async function cleanupRunDocuments(runId: string): Promise<void> {
  if (keepArtifacts) {
    return;
  }

  const db = getMongoClient().db(sharedDbName);
  await Promise.all([
    db.collection(collections.ingestionRunSummaries).deleteMany({ runId }),
    db.collection(collections.ingestionTriggerRequests).deleteMany({ crawlRunId: runId }),
    db.collection(collections.normalizedJobAds).deleteMany({ 'ingestion.runId': runId }),
  ]);
}

function logKeptRunDocuments(runId: string): void {
  if (!keepArtifacts) {
    return;
  }

  console.info(
    `[ingestion-worker-v2:e2e] kept Mongo documents for runId="${runId}" in ` +
      `${sharedDbName}.${collections.normalizedJobAds}`,
  );
}

const maybeSkip = skipReason ? { skip: skipReason } : {};

test(
  'processes StartRun input records and persists summary, triggers, and normalized documents',
  maybeSkip,
  async () => {
    const runId = buildRunId('e2e-start-run');
    await cleanupRunDocuments(runId);

    try {
      const { runtime, outputBucket, topic } = await createRuntimeFixture();
      const payload = buildStartRunPayload(
        runId,
        goldenParityCases.map((fixtureCase, index) => ({
          source: 'jobs.cz',
          sourceId: fixtureCase.sourceId,
          dedupeKey: `jobs.cz:search-space-e2e:${runId}:${fixtureCase.sourceId}`,
          detailHtmlPath: fixturePathBySourceId.get(fixtureCase.sourceId)!,
          listingRecord: fixtureCase.listingRecord,
          datasetRecordIndex: index,
        })),
      );

      const response = await runtime.startRun(payload);
      assert.equal(response.ok, true);
      assert.equal(response.accepted, true);
      assert.equal(response.deduplicated, false);

      const run = await waitForRunStatus(runtime, runId, 'succeeded');
      assert.equal(run.counters.received, goldenParityCases.length);
      assert.equal(run.counters.processed, goldenParityCases.length);
      assert.equal(run.counters.failed, 0);
      assert.equal(run.outputsCount, goldenParityCases.length);

      const db = getMongoClient().db(sharedDbName);
      const summary = await waitForDocument({
        read: async () => db.collection(collections.ingestionRunSummaries).findOne({ runId }),
      });
      assert.equal(summary.status, 'succeeded');
      assert.equal(summary.jobsProcessed, goldenParityCases.length);
      assert.equal(summary.jobsFailed, 0);
      assert.equal(summary.parserVersion, parserVersion);
      assert.equal(
        summary.extractorModel,
        parserBackend === 'gemini' ? geminiModel : 'fixture-parser',
      );
      assert.equal(summary.totalTokens, summary.llmTotalStats.totalTokens);
      assert.equal(summary.totalEstimatedCostUsd, summary.llmTotalStats.totalCostUsd);
      if (parserBackend === 'gemini') {
        assert.ok(Number(summary.totalTokens) > 0, 'Expected totalTokens > 0 for gemini backend');
        assert.ok(
          Number(summary.totalEstimatedCostUsd) > 0,
          'Expected totalEstimatedCostUsd > 0 for gemini backend',
        );
      }

      const itemTriggers = await db
        .collection(collections.ingestionTriggerRequests)
        .find({ crawlRunId: runId, triggerType: 'item', status: 'succeeded' })
        .toArray();
      assert.equal(itemTriggers.length, goldenParityCases.length);
      for (const itemTrigger of itemTriggers) {
        assert.ok(itemTrigger.result);
        if (parserBackend === 'gemini') {
          assert.ok(
            Number(itemTrigger.result.totalTokensUsed) > 0,
            'Expected per-item totalTokensUsed > 0 for gemini backend',
          );
        }
      }

      const runTrigger = await db
        .collection(collections.ingestionTriggerRequests)
        .findOne({ crawlRunId: runId, triggerType: 'run' });
      assert.ok(runTrigger);
      assert.ok(runTrigger.result);
      assert.equal(runTrigger.result.totalTokensUsed, summary.totalTokens);
      assert.equal(runTrigger.result.totalEstimatedCostUsd, summary.totalEstimatedCostUsd);

      const normalizedDocs = await db
        .collection(collections.normalizedJobAds)
        .find({ 'ingestion.runId': runId })
        .toArray();
      assert.equal(normalizedDocs.length, goldenParityCases.length);

      for (const fixtureCase of goldenParityCases) {
        const normalizedDoc = normalizedDocs.find((doc) => doc.sourceId === fixtureCase.sourceId);
        assert.ok(normalizedDoc, `Missing normalized doc for ${fixtureCase.sourceId}`);
        assert.equal('dedupeKey' in normalizedDoc, false);
        assert.equal('createdAt' in normalizedDoc, false);
        assert.equal(normalizedDoc.id, `jobs.cz:${fixtureCase.sourceId}`);
        assert.equal(normalizedDoc.source, 'jobs.cz');
        assert.equal(normalizedDoc.sourceId, fixtureCase.sourceId);
        assert.equal(normalizedDoc.adUrl, fixtureCase.listingRecord.adUrl);
        assert.match(normalizedDoc.adUrl, /\?searchId=.*&rps=\d+/);
        assert.equal(normalizedDoc.listing.jobTitle, fixtureCase.listingRecord.jobTitle);
        assert.equal(normalizedDoc.listing.companyName, fixtureCase.listingRecord.companyName);
        assert.equal(normalizedDoc.ingestion.runId, runId);
        assert.equal(normalizedDoc.ingestion.datasetFileName, 'dataset.json');
        assert.ok(
          Number(normalizedDoc.ingestion.llmTotalTokens) >= 0,
          `Invalid llmTotalTokens for ${fixtureCase.sourceId}`,
        );
        assert.ok(
          Number(normalizedDoc.rawDetailPage.cleanDetailText.charCount) >=
            fixtureCase.minCleanDetailChars,
          `cleanDetailText too short for ${fixtureCase.sourceId}`,
        );
        assertContainsAnyToken(
          String(normalizedDoc.detail.canonicalTitle ?? ''),
          fixtureCase.expectedTitleTokens,
          `canonicalTitle mismatch for ${fixtureCase.sourceId}`,
        );
        const semanticText = String(
          normalizedDoc.detail.jobDescription ?? normalizedDoc.rawDetailPage.cleanDetailText.text,
        );
        assertContainsAnyToken(
          semanticText,
          fixtureCase.expectedSemanticTokens,
          `semantic text mismatch for ${fixtureCase.sourceId}`,
        );
        assert.equal(
          String(normalizedDoc.detail.canonicalTitle ?? '').startsWith('Unknown title'),
          false,
        );
      }

      assert.equal(outputBucket.listObjectPaths().length, goldenParityCases.length);

      const publishedEventTypes = topic.published.map((entry) => {
        const parsed = JSON.parse(entry.payload) as { eventType: string };
        return parsed.eventType;
      });
      await waitForEventType(topic, 'ingestion.run.finished');
      assert.ok(publishedEventTypes.includes('ingestion.run.started'));
      assert.ok(publishedEventTypes.includes('ingestion.item.succeeded'));
      assert.ok(
        topic.published.some(
          (entry) => JSON.parse(entry.payload).eventType === 'ingestion.run.finished',
        ),
      );
      logKeptRunDocuments(runId);
    } finally {
      await cleanupRunDocuments(runId);
    }
  },
);

test(
  'handles crawler events and finalizes only after crawler.run.finished',
  maybeSkip,
  async () => {
    const runId = buildRunId('e2e-crawler-events');
    await cleanupRunDocuments(runId);

    try {
      const { runtime } = await createRuntimeFixture();
      const payload = buildStartRunPayload(runId, []);
      await runtime.startRun(payload);

      const initialState = getRunView(runtime, runId);
      assert.equal(initialState.status, 'running');
      assert.equal(initialState.waitForCrawlerFinished, true);
      assert.equal(initialState.crawlerFinished, false);

      const sourceId = '2001090812';
      const fixturePath = fixturePathBySourceId.get(sourceId)!;
      const detailEvent = buildCrawlerDetailCapturedEvent({
        runId,
        crawlRunId: runId,
        searchSpaceId: 'search-space-e2e',
        source: 'jobs.cz',
        sourceId,
        listingRecord: {
          sourceId,
          adUrl:
            'https://www.jobs.cz/rpd/2001090812/?searchId=793f06bf-b653-4637-8010-5c1bebdf0970&rps=233',
          jobTitle: 'IT Manažer',
          companyName: 'Gas Storage CZ, a.s.',
          location: 'Praha - Strašnice',
          salary: null,
          publishedInfoText: null,
          scrapedAt: '2026-03-05T10:00:00.000Z',
          source: 'jobs.cz',
          htmlDetailPageKey: 'job-html-2001090812.html',
        },
        artifact: {
          artifactType: 'html',
          storageType: 'local_filesystem',
          storagePath: fixturePath,
          checksum: 'checksum-2001090812',
          sizeBytes: 2048,
        },
      });

      await runtime.handlePubSubMessage(JSON.stringify(detailEvent));

      const midState = getRunView(runtime, runId);
      assert.equal(midState.status, 'running');

      const finishedEvent = buildCrawlerRunFinishedEvent({
        runId,
        crawlRunId: runId,
        searchSpaceId: 'search-space-e2e',
        status: 'succeeded',
        newJobsCount: 1,
        failedRequests: 0,
        stopReason: 'completed',
      });

      await runtime.handlePubSubMessage(JSON.stringify(finishedEvent));

      const completed = await waitForRunStatus(runtime, runId, 'succeeded');
      assert.equal(completed.counters.received, 1);
      assert.equal(completed.counters.processed, 1);
      assert.equal(completed.crawlerFinished, true);

      const db = getMongoClient().db(sharedDbName);
      const summary = await waitForDocument({
        read: async () => db.collection(collections.ingestionRunSummaries).findOne({ runId }),
      });
      assert.equal(summary.status, 'succeeded');
      logKeptRunDocuments(runId);
    } finally {
      await cleanupRunDocuments(runId);
    }
  },
);

test(
  'correlates crawler events by crawlRunId and succeeds with mongodb-only output sink',
  maybeSkip,
  async () => {
    const runId = buildRunId('e2e-crawler-correlation');
    const crawlRunId = `crawl-${runId}`;
    await cleanupRunDocuments(runId);

    try {
      const { runtime, outputBucket } = await createRuntimeFixture();
      const payload = buildStartRunPayload(runId, []);
      payload.inputRef.crawlRunId = crawlRunId;
      payload.outputSinks = [
        {
          type: 'mongodb',
          collection: collections.normalizedJobAds,
          writeMode: 'upsert',
        },
      ];

      await runtime.startRun(payload);

      const sourceId = '2001063102';
      const fixturePath = fixturePathBySourceId.get(sourceId)!;
      const detailEvent = buildCrawlerDetailCapturedEvent({
        runId: crawlRunId,
        crawlRunId,
        searchSpaceId: 'search-space-e2e',
        source: 'jobs.cz',
        sourceId,
        listingRecord: {
          sourceId,
          adUrl:
            'https://www.jobs.cz/rpd/2001063102/?searchId=793f06bf-b653-4637-8010-5c1bebdf0970&rps=233',
          jobTitle: 'Technical Program Manager',
          companyName: 'Univerzita Karlova – Matematicko-fyzikální fakulta',
          location: 'Praha – Malá Strana',
          salary: null,
          publishedInfoText: 'Aktualizováno dnes',
          scrapedAt: '2026-03-05T10:00:00.000Z',
          source: 'jobs.cz',
          htmlDetailPageKey: 'job-html-2001063102.html',
        },
        artifact: {
          artifactType: 'html',
          storageType: 'local_filesystem',
          storagePath: fixturePath,
          checksum: 'checksum-2001063102',
          sizeBytes: 4096,
        },
      });

      await runtime.handlePubSubMessage(JSON.stringify(detailEvent));

      const finishedEvent = buildCrawlerRunFinishedEvent({
        runId: crawlRunId,
        crawlRunId,
        searchSpaceId: 'search-space-e2e',
        status: 'succeeded',
        newJobsCount: 1,
        failedRequests: 0,
        stopReason: 'completed',
      });
      await runtime.handlePubSubMessage(JSON.stringify(finishedEvent));

      const completed = await waitForRunStatus(runtime, runId, 'succeeded');
      assert.equal(completed.counters.received, 1);
      assert.equal(completed.counters.processed, 1);
      assert.equal(completed.counters.failed, 0);
      assert.equal(completed.crawlerFinished, true);
      assert.equal(outputBucket.listObjectPaths().length, 0);

      const db = getMongoClient().db(sharedDbName);
      const summary = await waitForDocument({
        read: async () => db.collection(collections.ingestionRunSummaries).findOne({ runId }),
      });
      assert.equal(summary.status, 'succeeded');
      assert.equal(summary.crawlRunId, crawlRunId);
      logKeptRunDocuments(runId);
    } finally {
      const db = getMongoClient().db(sharedDbName);
      await db.collection(collections.ingestionTriggerRequests).deleteMany({ crawlRunId });
      await cleanupRunDocuments(runId);
    }
  },
);

test(
  'captures failures in observability collections when item ingestion fails',
  maybeSkip,
  async () => {
    const runId = buildRunId('e2e-failure');
    await cleanupRunDocuments(runId);

    try {
      const { runtime, topic, outputBucket, logger } = await createRuntimeFixture();
      const sourceId = 'missing-2000905776';
      const dedupeKey = `jobs.cz:search-space-e2e:${runId}:${sourceId}`;
      const payload = buildStartRunPayload(runId, [
        {
          source: 'jobs.cz',
          sourceId,
          dedupeKey,
          detailHtmlPath: `/tmp/ingestion-worker-v2-${runId}.html`,
          listingRecord: {
            sourceId,
            adUrl:
              'https://www.jobs.cz/rpd/missing-2000905776/?searchId=793f06bf-b653-4637-8010-5c1bebdf0970&rps=233',
            jobTitle: 'Missing Detail Fixture',
            companyName: null,
            location: null,
            salary: null,
            publishedInfoText: null,
            scrapedAt: new Date().toISOString(),
            source: 'jobs.cz',
            htmlDetailPageKey: 'missing-2000905776.html',
          },
        },
      ]);

      await runtime.startRun(payload);
      const run = await waitForRunStatus(runtime, runId, 'completed_with_errors');

      assert.equal(run.counters.received, 1);
      assert.equal(run.counters.processed, 0);
      assert.equal(run.counters.failed, 1);
      assert.equal(run.outputsCount, 0);
      assert.equal(outputBucket.listObjectPaths().length, 0);

      const db = getMongoClient().db(sharedDbName);
      const summary = await waitForDocument({
        read: async () => db.collection(collections.ingestionRunSummaries).findOne({ runId }),
      });
      assert.equal(summary.status, 'completed_with_errors');
      assert.equal(summary.jobsProcessed, 0);
      assert.equal(summary.jobsFailed, 1);

      const itemTrigger = await db
        .collection(collections.ingestionTriggerRequests)
        .findOne({ crawlRunId: runId, triggerType: 'item', sourceId });
      assert.ok(itemTrigger);
      assert.equal(itemTrigger.status, 'failed');
      assert.match(String(itemTrigger.errorMessage), /ENOENT/);

      const publishedEventTypes = topic.published.map((entry) => {
        const parsed = JSON.parse(entry.payload) as { eventType: string };
        return parsed.eventType;
      });
      await waitForEventType(topic, 'ingestion.run.finished');
      assert.ok(publishedEventTypes.includes('ingestion.item.failed'));
      assert.ok(
        topic.published.some(
          (entry) => JSON.parse(entry.payload).eventType === 'ingestion.run.finished',
        ),
      );

      const errorLogs = logger.entries.filter((entry) => entry.level === 'error');
      assert.equal(errorLogs.length, 0);
      logKeptRunDocuments(runId);
    } finally {
      await cleanupRunDocuments(runId);
    }
  },
);
