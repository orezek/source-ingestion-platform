import {
  downloadStoredArtifact,
  readStoredArtifactPreview,
  assertArtifactStoragePathForRun,
} from '@repo/control-plane-adapters';
import type { BrokerEvent, RunManifest } from '@repo/control-plane-contracts';
import { readBrokerEvents } from '@repo/control-plane-contracts';
import { controlPlaneBrokerRootDir } from '@/server/control-plane/paths';
import { env } from '@/server/env';
import { getRunManifest, getRunRecord } from '@/server/control-plane/store';
import { type ControlPlaneFilePreview } from '@/server/control-plane/file-previews';

export type ControlPlaneArtifactCapture = {
  eventId: string;
  occurredAt: string;
  producer: string;
  source: string;
  sourceId: string;
  dedupeKey: string;
  adUrl: string;
  jobTitle: string;
  artifactPath: string;
  artifactStorageType: 'local_filesystem' | 'gcs';
  artifactSizeBytes: number;
  checksum: string;
  htmlDetailPageKey: string;
};

export type ControlPlaneArtifactPreview = {
  capture: ControlPlaneArtifactCapture;
  preview: ControlPlaneFilePreview;
};

export type ControlPlaneArtifactDownload = {
  capture: ControlPlaneArtifactCapture;
  fileName: string;
  filePath: string;
  contents: Buffer;
  contentType: string;
};

export function buildArtifactCaptures(events: BrokerEvent[]): ControlPlaneArtifactCapture[] {
  return events
    .filter((event): event is Extract<BrokerEvent, { eventType: 'crawler.detail.captured' }> => {
      return event.eventType === 'crawler.detail.captured';
    })
    .map((event) => ({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      producer: event.producer,
      source: event.payload.source,
      sourceId: event.payload.sourceId,
      dedupeKey: event.payload.dedupeKey,
      adUrl: event.payload.listingRecord.adUrl,
      jobTitle: event.payload.listingRecord.jobTitle,
      artifactPath: event.payload.artifact.storagePath,
      artifactStorageType: event.payload.artifact.storageType,
      artifactSizeBytes: event.payload.artifact.sizeBytes,
      checksum: event.payload.artifact.checksum,
      htmlDetailPageKey: event.payload.listingRecord.htmlDetailPageKey,
    }));
}

async function getRunArtifactCaptures(runId: string): Promise<ControlPlaneArtifactCapture[]> {
  const run = await getRunRecord(runId);
  if (!run) {
    throw new Error(`Unknown run "${runId}".`);
  }

  const events = await readBrokerEvents(controlPlaneBrokerRootDir, runId);
  return buildArtifactCaptures(events);
}

async function assertRunArtifactStoragePath(
  runId: string,
  manifest: RunManifest,
  capture: ControlPlaneArtifactCapture,
): Promise<string> {
  return assertArtifactStoragePathForRun({
    destination: manifest.artifactStorageSnapshot,
    crawlRunId: runId,
    storagePath: capture.artifactPath,
  });
}

async function getRunArtifactCapture(input: {
  runId: string;
  sourceId: string;
}): Promise<{ capture: ControlPlaneArtifactCapture; manifest: RunManifest }> {
  const [captures, manifest] = await Promise.all([
    getRunArtifactCaptures(input.runId),
    getRunManifest(input.runId),
  ]);

  if (!manifest) {
    throw new Error(`Run "${input.runId}" does not have a persisted manifest.`);
  }

  const capture = captures.find((item) => item.sourceId === input.sourceId);
  if (!capture) {
    throw new Error(`Run "${input.runId}" does not include artifact "${input.sourceId}".`);
  }

  return { capture, manifest };
}

export async function getControlPlaneRunArtifactPreview(input: {
  runId: string;
  sourceId: string;
  maxChars?: number;
}): Promise<ControlPlaneArtifactPreview> {
  const { capture, manifest } = await getRunArtifactCapture(input);
  const resolvedArtifactPath = await assertRunArtifactStoragePath(input.runId, manifest, capture);
  const preview = await readStoredArtifactPreview({
    storageType: capture.artifactStorageType,
    storagePath: resolvedArtifactPath,
    maxChars: input.maxChars ?? 24_000,
    projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
  });

  return {
    capture,
    preview: {
      path: capture.artifactPath,
      contents: preview.exists ? preview.contents : null,
      exists: preview.exists,
      truncated: preview.truncated,
      sizeBytes: capture.artifactSizeBytes,
    },
  };
}

export async function getControlPlaneRunArtifactDownload(input: {
  runId: string;
  sourceId: string;
}): Promise<ControlPlaneArtifactDownload> {
  const { capture, manifest } = await getRunArtifactCapture(input);
  const resolvedArtifactPath = await assertRunArtifactStoragePath(input.runId, manifest, capture);

  return {
    capture,
    fileName: capture.htmlDetailPageKey,
    filePath: resolvedArtifactPath,
    contents: await downloadStoredArtifact({
      storageType: capture.artifactStorageType,
      storagePath: resolvedArtifactPath,
      projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
    }),
    contentType: 'text/html; charset=utf-8',
  };
}
