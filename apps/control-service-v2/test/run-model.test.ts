import assert from 'node:assert/strict';
import test from 'node:test';
import {
  controlPlanePipelineV2Fixture,
  runtimeBrokerEventV2Schema,
} from '@repo/control-plane-contracts';
import {
  applyRuntimeEventToRun,
  buildInitialRun,
  buildRunManifest,
  markRunDispatchFailed,
} from '../src/run-model.js';

test('buildRunManifest keeps ingestion start-run event-driven only', () => {
  const runId = 'run-test-001';
  const manifest = buildRunManifest({
    pipeline: controlPlanePipelineV2Fixture,
    runId,
    createdBy: 'control-service-v2',
    artifactSink: {
      type: 'gcs',
      bucket: 'control-plane-artifacts',
      prefix: 'runs',
    },
  });

  assert.equal(manifest.workerCommands.crawler.runId, runId);
  assert.equal(manifest.workerCommands.crawler.artifactSink.type, 'gcs');
  assert.equal(manifest.workerCommands.ingestion?.runId, runId);
  assert.deepEqual(manifest.workerCommands.ingestion?.inputRef, {
    crawlRunId: runId,
    searchSpaceId: controlPlanePipelineV2Fixture.searchSpace.id,
  });
  assert.equal(manifest.workerCommands.ingestion?.outputSinks.length, 1);
  assert.deepEqual(manifest.workerCommands.ingestion?.outputSinks[0], {
    type: 'downloadable_json',
    delivery: {
      storageType: 'gcs',
      bucket: 'control-plane-artifacts',
      prefix: `runs/pipelines/${controlPlanePipelineV2Fixture.pipelineId}/runs/${runId}/outputs/downloadable-json`,
    },
  });
});

test('dispatch failure keeps overall run failed even after later worker stop events', () => {
  const runId = 'run-test-002';
  const initialRun = buildInitialRun({
    pipeline: controlPlanePipelineV2Fixture,
    runId,
  });
  const failedRun = markRunDispatchFailed(initialRun, 'crawler_dispatch_failed');
  const crawlerStoppedEvent = runtimeBrokerEventV2Schema.parse({
    eventId: 'evt-crawler-finished-001',
    eventVersion: 'v2',
    eventType: 'crawler.run.finished',
    occurredAt: '2026-03-07T10:30:00.000Z',
    runId,
    correlationId: runId,
    producer: 'crawler-worker-v2',
    payload: {
      crawlRunId: runId,
      source: controlPlanePipelineV2Fixture.source,
      searchSpaceId: controlPlanePipelineV2Fixture.searchSpace.id,
      status: 'stopped',
      stopReason: 'cancelled_by_operator',
    },
  });
  const ingestionStoppedEvent = runtimeBrokerEventV2Schema.parse({
    eventId: 'evt-ingestion-finished-001',
    eventVersion: 'v2',
    eventType: 'ingestion.run.finished',
    occurredAt: '2026-03-07T10:31:00.000Z',
    runId,
    correlationId: runId,
    producer: 'ingestion-worker-v2',
    payload: {
      runId,
      workerType: 'ingestion',
      status: 'stopped',
      counters: {
        jobsProcessed: 0,
        jobsFailed: 0,
        jobsRejected: 0,
      },
    },
  });

  const afterCrawlerEvent = applyRuntimeEventToRun(failedRun, crawlerStoppedEvent);
  const finalRun = applyRuntimeEventToRun(afterCrawlerEvent, ingestionStoppedEvent);

  assert.equal(finalRun.status, 'failed');
  assert.equal(finalRun.stopReason, 'crawler_dispatch_failed');
  assert.equal(finalRun.crawler.status, 'stopped');
  assert.equal(finalRun.ingestion.status, 'stopped');
});

test('late crawler.run.started does not regress terminal crawler status', () => {
  const runId = 'run-test-003';
  const initialRun = buildInitialRun({
    pipeline: controlPlanePipelineV2Fixture,
    runId,
  });

  const crawlerFinishedEvent = runtimeBrokerEventV2Schema.parse({
    eventId: 'evt-crawler-finished-003',
    eventVersion: 'v2',
    eventType: 'crawler.run.finished',
    occurredAt: '2026-03-08T20:05:56.979Z',
    runId,
    correlationId: runId,
    producer: 'crawler-worker-v2',
    payload: {
      crawlRunId: runId,
      source: controlPlanePipelineV2Fixture.source,
      searchSpaceId: controlPlanePipelineV2Fixture.searchSpace.id,
      status: 'succeeded',
      stopReason: 'no_new_jobs',
    },
  });
  const crawlerStartedLateEvent = runtimeBrokerEventV2Schema.parse({
    eventId: 'evt-crawler-started-late-003',
    eventVersion: 'v2',
    eventType: 'crawler.run.started',
    occurredAt: '2026-03-08T20:05:55.833Z',
    runId,
    correlationId: runId,
    producer: 'crawler-worker-v2',
    payload: {
      runId,
      workerType: 'crawler',
      status: 'running',
      counters: {},
    },
  });
  const ingestionFinishedEvent = runtimeBrokerEventV2Schema.parse({
    eventId: 'evt-ingestion-finished-003',
    eventVersion: 'v2',
    eventType: 'ingestion.run.finished',
    occurredAt: '2026-03-08T20:05:57.273Z',
    runId,
    correlationId: runId,
    producer: 'ingestion-worker-v2',
    payload: {
      runId,
      workerType: 'ingestion',
      status: 'succeeded',
      counters: {
        jobsProcessed: 0,
        jobsFailed: 0,
        jobsRejected: 0,
      },
    },
  });

  const afterCrawlerFinished = applyRuntimeEventToRun(initialRun, crawlerFinishedEvent);
  const afterLateStarted = applyRuntimeEventToRun(afterCrawlerFinished, crawlerStartedLateEvent);
  const finalRun = applyRuntimeEventToRun(afterLateStarted, ingestionFinishedEvent);

  assert.equal(finalRun.crawler.status, 'succeeded');
  assert.equal(finalRun.crawler.finishedAt, '2026-03-08T20:05:56.979Z');
  assert.equal(finalRun.crawler.startedAt, '2026-03-08T20:05:55.833Z');
  assert.equal(finalRun.status, 'succeeded');
});
