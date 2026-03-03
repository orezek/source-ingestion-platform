import {
  assertStructuredJsonStoragePathForRun,
  buildStructuredJsonStorageRef,
  downloadStoredArtifact,
  readStoredArtifactPreview,
} from '@repo/control-plane-adapters';
import type {
  BrokerEvent,
  RunManifest,
  StructuredOutputDestinationSnapshot,
} from '@repo/control-plane-contracts';
import { readBrokerEvents } from '@repo/control-plane-contracts';
import { controlPlaneBrokerRootDir } from '@/server/control-plane/paths';
import { env } from '@/server/env';
import { getRunManifest, getRunRecord } from '@/server/control-plane/store';
import { type ControlPlaneFilePreview } from '@/server/control-plane/file-previews';

type DownloadableJsonDestination = Extract<
  StructuredOutputDestinationSnapshot,
  { type: 'downloadable_json' }
>;

export type ControlPlaneStructuredOutputCapture = {
  eventId: string;
  occurredAt: string;
  producer: string;
  sourceId: string;
  dedupeKey: string;
  documentId: string | null;
  destinationId: string;
  destinationName: string;
  outputPath: string;
  outputStorageType: 'local_filesystem' | 'gcs';
  fileName: string;
};

export type ControlPlaneStructuredOutputPreview = {
  capture: ControlPlaneStructuredOutputCapture;
  preview: ControlPlaneFilePreview;
};

export type ControlPlaneStructuredOutputDownload = {
  capture: ControlPlaneStructuredOutputCapture;
  fileName: string;
  filePath: string;
  contents: Buffer;
  contentType: string;
};

function getDownloadableJsonDestinations(manifest: RunManifest): DownloadableJsonDestination[] {
  return manifest.structuredOutputDestinationSnapshots.filter(
    (destination): destination is DownloadableJsonDestination =>
      destination.type === 'downloadable_json',
  );
}

export function buildStructuredOutputCaptures(input: {
  events: BrokerEvent[];
  manifest: RunManifest;
}): ControlPlaneStructuredOutputCapture[] {
  const downloadableDestinations = getDownloadableJsonDestinations(input.manifest);
  if (downloadableDestinations.length === 0) {
    return [];
  }

  return input.events
    .filter((event): event is Extract<BrokerEvent, { eventType: 'ingestion.item.succeeded' }> => {
      return event.eventType === 'ingestion.item.succeeded';
    })
    .flatMap((event) =>
      downloadableDestinations.map((destination) => {
        const resolvedTarget = buildStructuredJsonStorageRef({
          destination,
          crawlRunId: input.manifest.runId,
          sourceId: event.payload.sourceId,
        });

        return {
          eventId: event.eventId,
          occurredAt: event.occurredAt,
          producer: event.producer,
          sourceId: event.payload.sourceId,
          dedupeKey: event.payload.dedupeKey,
          documentId: event.payload.documentId ?? null,
          destinationId: destination.id,
          destinationName: destination.name,
          outputPath: resolvedTarget.storagePath,
          outputStorageType: resolvedTarget.storageType,
          fileName: resolvedTarget.fileName,
        };
      }),
    );
}

async function getRunStructuredOutputCaptures(
  runId: string,
): Promise<{ captures: ControlPlaneStructuredOutputCapture[]; manifest: RunManifest }> {
  const run = await getRunRecord(runId);
  if (!run) {
    throw new Error(`Unknown run "${runId}".`);
  }

  const [events, manifest] = await Promise.all([
    readBrokerEvents(controlPlaneBrokerRootDir, runId),
    getRunManifest(runId),
  ]);

  if (!manifest) {
    throw new Error(`Run "${runId}" does not have a persisted manifest.`);
  }

  return {
    captures: buildStructuredOutputCaptures({ events, manifest }),
    manifest,
  };
}

async function getRunStructuredOutputCapture(input: {
  runId: string;
  destinationId: string;
  sourceId: string;
}): Promise<{
  capture: ControlPlaneStructuredOutputCapture;
  manifest: RunManifest;
  destination: DownloadableJsonDestination;
}> {
  const { captures, manifest } = await getRunStructuredOutputCaptures(input.runId);
  const destination = getDownloadableJsonDestinations(manifest).find(
    (candidate) => candidate.id === input.destinationId,
  );

  if (!destination) {
    throw new Error(
      `Run "${input.runId}" does not include downloadable output "${input.destinationId}".`,
    );
  }

  const capture = captures.find(
    (item) => item.destinationId === input.destinationId && item.sourceId === input.sourceId,
  );

  if (!capture) {
    throw new Error(
      `Run "${input.runId}" does not include downloadable output "${input.destinationId}" for "${input.sourceId}".`,
    );
  }

  return {
    capture,
    manifest,
    destination,
  };
}

export async function getControlPlaneRunStructuredOutputPreview(input: {
  runId: string;
  destinationId: string;
  sourceId: string;
  maxChars?: number;
}): Promise<ControlPlaneStructuredOutputPreview> {
  const { capture, destination, manifest } = await getRunStructuredOutputCapture(input);
  const resolvedOutputPath = assertStructuredJsonStoragePathForRun({
    destination,
    crawlRunId: manifest.runId,
    storagePath: capture.outputPath,
  });
  const preview = await readStoredArtifactPreview({
    storageType: capture.outputStorageType,
    storagePath: resolvedOutputPath,
    maxChars: input.maxChars ?? 24_000,
    projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
  });

  return {
    capture,
    preview: {
      path: capture.outputPath,
      contents: preview.exists ? preview.contents : null,
      exists: preview.exists,
      truncated: preview.truncated,
      sizeBytes: Buffer.byteLength(preview.contents, 'utf8'),
    },
  };
}

export async function getControlPlaneRunStructuredOutputDownload(input: {
  runId: string;
  destinationId: string;
  sourceId: string;
}): Promise<ControlPlaneStructuredOutputDownload> {
  const { capture, destination, manifest } = await getRunStructuredOutputCapture(input);
  const resolvedOutputPath = assertStructuredJsonStoragePathForRun({
    destination,
    crawlRunId: manifest.runId,
    storagePath: capture.outputPath,
  });

  return {
    capture,
    fileName: capture.fileName,
    filePath: resolvedOutputPath,
    contents: await downloadStoredArtifact({
      storageType: capture.outputStorageType,
      storagePath: resolvedOutputPath,
      projectId: env.CONTROL_PLANE_GCP_PROJECT_ID,
    }),
    contentType: 'application/json; charset=utf-8',
  };
}
