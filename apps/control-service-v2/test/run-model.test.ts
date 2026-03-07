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
      stopReason: 'cancel_requested',
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
