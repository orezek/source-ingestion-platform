import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PubSub, type Subscription } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import type {
  ArtifactStorageSnapshot,
  BrokerEvent,
  StoredArtifactRef,
  StructuredOutputDestinationSnapshot,
} from '@repo/control-plane-contracts';
import {
  brokerEventSchema,
  buildArtifactDatasetPath,
  buildArtifactHtmlFileName,
  buildArtifactRecordsDir,
  buildArtifactRunDir,
  buildStructuredJsonFileName,
  buildStructuredRunDir,
  readBrokerEvents,
  writeBrokerEvent,
} from '@repo/control-plane-contracts';

type ArtifactStorageLike = ArtifactStorageSnapshot;
type DownloadableJsonDestinationLike = Extract<
  StructuredOutputDestinationSnapshot,
  { type: 'downloadable_json' }
>;

export type BrokerTransportConfig =
  | {
      type: 'local';
      archiveRootDir: string;
    }
  | {
      type: 'gcp_pubsub';
      archiveRootDir: string;
      projectId: string;
      topicName: string;
      subscriptionNamePrefix?: string;
    };

export type BrokerRunConsumer = {
  poll: (options?: { timeoutMs?: number; maxMessages?: number }) => Promise<BrokerEvent[]>;
  close: () => Promise<void>;
  subscriptionName?: string;
};

export type StoredTextPreview = {
  exists: boolean;
  contents: string;
  truncated: boolean;
};

type GcsLocation = {
  bucket: string;
  objectPath: string;
};

const DEFAULT_PUBSUB_TIMEOUT_MS = 500;
const DEFAULT_PUBSUB_MAX_MESSAGES = 25;
const storageClients = new Map<string, Storage>();
const pubsubClients = new Map<string, PubSub>();

function getStorageClient(projectId?: string): Storage {
  const key = projectId ?? '__default__';
  const existing = storageClients.get(key);
  if (existing) {
    return existing;
  }

  const client = new Storage(projectId ? { projectId } : {});
  storageClients.set(key, client);
  return client;
}

function getPubSubClient(projectId: string): PubSub {
  const existing = pubsubClients.get(projectId);
  if (existing) {
    return existing;
  }

  const client = new PubSub({ projectId });
  pubsubClients.set(projectId, client);
  return client;
}

function normalizePrefix(prefix?: string): string {
  return (prefix ?? '').replace(/^\/+/u, '').replace(/\/+$/u, '');
}

function buildGsUri(bucket: string, objectPath: string): string {
  return `gs://${bucket}/${objectPath}`;
}

function buildGcsObjectPath(prefix: string | undefined, relativePath: string): string {
  const normalizedPrefix = normalizePrefix(prefix);
  const normalizedRelativePath = relativePath.replace(/^\/+/u, '');
  return normalizedPrefix.length > 0
    ? path.posix.join(normalizedPrefix, normalizedRelativePath)
    : normalizedRelativePath;
}

function parseGsUri(uri: string): GcsLocation {
  if (!uri.startsWith('gs://')) {
    throw new Error(`Expected a GCS URI, received "${uri}".`);
  }

  const withoutScheme = uri.slice('gs://'.length);
  const separatorIndex = withoutScheme.indexOf('/');
  if (separatorIndex <= 0) {
    throw new Error(`Invalid GCS URI "${uri}".`);
  }

  return {
    bucket: withoutScheme.slice(0, separatorIndex),
    objectPath: withoutScheme.slice(separatorIndex + 1),
  };
}

function sanitizePubSubNameSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9-_]/gu, '-').replace(/-+/gu, '-');
  return normalized.slice(0, 160);
}

async function readLocalFilePreview(
  filePath: string,
  maxChars: number,
): Promise<StoredTextPreview> {
  try {
    const contents = await readFile(filePath, 'utf8');
    return {
      exists: true,
      contents: contents.slice(0, maxChars),
      truncated: contents.length > maxChars,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {
        exists: false,
        contents: '',
        truncated: false,
      };
    }

    throw error;
  }
}

async function pollPubSubSubscription(
  subscription: Subscription,
  timeoutMs: number,
  maxMessages: number,
): Promise<BrokerEvent[]> {
  return new Promise<BrokerEvent[]>((resolve, reject) => {
    const events: BrokerEvent[] = [];
    let settled = false;

    const cleanup = () => {
      subscription.removeListener('message', handleMessage);
      subscription.removeListener('error', handleError);
      clearTimeout(timeoutHandle);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleMessage = (message: { data: Buffer; ack: () => void; nack: () => void }) => {
      try {
        const parsed = brokerEventSchema.parse(
          JSON.parse(message.data.toString('utf8')) as unknown,
        );
        message.ack();
        events.push(parsed);
        if (events.length >= maxMessages) {
          settle(() => resolve(events));
        }
      } catch (error) {
        message.nack();
        settle(() => reject(error));
      }
    };

    const handleError = (error: Error) => {
      settle(() => reject(error));
    };

    const timeoutHandle = setTimeout(() => {
      settle(() => resolve(events));
    }, timeoutMs);

    subscription.on('message', handleMessage);
    subscription.on('error', handleError);
  });
}

export function getManagedStorageRootLabel(destination: ArtifactStorageLike): string {
  if (destination.type === 'local_filesystem' && 'basePath' in destination.config) {
    return path.resolve(destination.config.basePath);
  }

  if (destination.type === 'gcs' && 'bucket' in destination.config) {
    const prefix = normalizePrefix(destination.config.prefix);
    return prefix.length > 0
      ? buildGsUri(destination.config.bucket, prefix)
      : `gs://${destination.config.bucket}`;
  }

  throw new Error(`Unsupported artifact storage type "${destination.type}".`);
}

export function buildArtifactRunLayout(
  destination: ArtifactStorageLike,
  crawlRunId: string,
): {
  rootLabel: string;
  runDir: string;
  recordsDir: string;
  datasetPath: string;
} {
  if (destination.type === 'local_filesystem' && 'basePath' in destination.config) {
    const rootLabel = path.resolve(destination.config.basePath);
    return {
      rootLabel,
      runDir: buildArtifactRunDir(rootLabel, crawlRunId),
      recordsDir: buildArtifactRecordsDir(rootLabel, crawlRunId),
      datasetPath: buildArtifactDatasetPath(rootLabel, crawlRunId),
    };
  }

  if (destination.type === 'gcs' && 'bucket' in destination.config) {
    const rootLabel = getManagedStorageRootLabel(destination);
    const relativeRunDir = path.posix.join('runs', crawlRunId);
    const runDir = buildGsUri(
      destination.config.bucket,
      buildGcsObjectPath(destination.config.prefix, relativeRunDir),
    );
    return {
      rootLabel,
      runDir,
      recordsDir: `${runDir}/records`,
      datasetPath: `${runDir}/dataset.json`,
    };
  }

  throw new Error(`Unsupported artifact storage type "${destination.type}".`);
}

export async function ensureArtifactRunReady(input: {
  destination: ArtifactStorageLike;
  crawlRunId: string;
  projectId?: string;
}): Promise<ReturnType<typeof buildArtifactRunLayout>> {
  const layout = buildArtifactRunLayout(input.destination, input.crawlRunId);

  if (input.destination.type === 'local_filesystem') {
    await mkdir(layout.recordsDir, { recursive: true });
  } else if (input.destination.type === 'gcs' && 'bucket' in input.destination.config) {
    const storage = getStorageClient(input.projectId);
    await storage.bucket(input.destination.config.bucket).getMetadata();
  }

  return layout;
}

export async function writeHtmlArtifact(input: {
  destination: ArtifactStorageLike;
  crawlRunId: string;
  sourceId: string;
  html: string;
  checksum: string;
  sizeBytes: number;
  projectId?: string;
}): Promise<StoredArtifactRef> {
  const fileName = buildArtifactHtmlFileName(input.sourceId);

  if (input.destination.type === 'local_filesystem' && 'basePath' in input.destination.config) {
    const targetPath = path.join(
      buildArtifactRecordsDir(path.resolve(input.destination.config.basePath), input.crawlRunId),
      fileName,
    );
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.html, 'utf8');
    return {
      artifactType: 'html',
      storageType: 'local_filesystem',
      storagePath: targetPath,
      checksum: input.checksum,
      sizeBytes: input.sizeBytes,
    };
  }

  if (input.destination.type === 'gcs' && 'bucket' in input.destination.config) {
    const storage = getStorageClient(input.projectId);
    const objectPath = buildGcsObjectPath(
      input.destination.config.prefix,
      path.posix.join('runs', input.crawlRunId, 'records', fileName),
    );
    await storage.bucket(input.destination.config.bucket).file(objectPath).save(input.html, {
      resumable: false,
      contentType: 'text/html; charset=utf-8',
    });

    return {
      artifactType: 'html',
      storageType: 'gcs',
      storagePath: buildGsUri(input.destination.config.bucket, objectPath),
      checksum: input.checksum,
      sizeBytes: input.sizeBytes,
    };
  }

  throw new Error('Unsupported artifact storage type.');
}

export async function writeDatasetMetadata(input: {
  destination: ArtifactStorageLike;
  crawlRunId: string;
  datasetRecords: unknown[];
  projectId?: string;
}): Promise<string> {
  const raw = `${JSON.stringify(input.datasetRecords, null, 2)}\n`;

  if (input.destination.type === 'local_filesystem' && 'basePath' in input.destination.config) {
    const targetPath = buildArtifactDatasetPath(
      path.resolve(input.destination.config.basePath),
      input.crawlRunId,
    );
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, raw, 'utf8');
    return targetPath;
  }

  if (input.destination.type === 'gcs' && 'bucket' in input.destination.config) {
    const storage = getStorageClient(input.projectId);
    const objectPath = buildGcsObjectPath(
      input.destination.config.prefix,
      path.posix.join('runs', input.crawlRunId, 'dataset.json'),
    );
    await storage.bucket(input.destination.config.bucket).file(objectPath).save(raw, {
      resumable: false,
      contentType: 'application/json; charset=utf-8',
    });
    return buildGsUri(input.destination.config.bucket, objectPath);
  }

  throw new Error('Unsupported artifact storage type.');
}

export function assertArtifactStoragePathForRun(input: {
  destination: ArtifactStorageLike;
  crawlRunId: string;
  storagePath: string;
}): string {
  const layout = buildArtifactRunLayout(input.destination, input.crawlRunId);

  if (input.destination.type === 'local_filesystem') {
    const expectedRunDir = path.resolve(layout.runDir);
    const resolvedStoragePath = path.resolve(input.storagePath);
    const expectedPrefix = `${expectedRunDir}${path.sep}`;
    if (resolvedStoragePath !== expectedRunDir && !resolvedStoragePath.startsWith(expectedPrefix)) {
      throw new Error(
        `Artifact path "${input.storagePath}" resolved outside the run artifact directory.`,
      );
    }

    return resolvedStoragePath;
  }

  if (input.destination.type === 'gcs') {
    const { bucket, objectPath } = parseGsUri(input.storagePath);
    if (bucket !== input.destination.config.bucket) {
      throw new Error(`Artifact bucket "${bucket}" does not match the run destination bucket.`);
    }

    const expectedPrefix = buildGcsObjectPath(
      input.destination.config.prefix,
      `${path.posix.join('runs', input.crawlRunId)}/`,
    );
    if (!objectPath.startsWith(expectedPrefix)) {
      throw new Error(`Artifact path "${input.storagePath}" is outside the run artifact prefix.`);
    }

    return input.storagePath;
  }

  throw new Error('Unsupported artifact storage type.');
}

export async function readStoredArtifactPreview(input: {
  storageType: StoredArtifactRef['storageType'];
  storagePath: string;
  maxChars: number;
  projectId?: string;
}): Promise<StoredTextPreview> {
  if (input.storageType === 'local_filesystem') {
    return readLocalFilePreview(path.resolve(input.storagePath), input.maxChars);
  }

  if (input.storageType === 'gcs') {
    const { bucket, objectPath } = parseGsUri(input.storagePath);
    const storage = getStorageClient(input.projectId);
    const [contents] = await storage.bucket(bucket).file(objectPath).download();
    const raw = contents.toString('utf8');
    return {
      exists: true,
      contents: raw.slice(0, input.maxChars),
      truncated: raw.length > input.maxChars,
    };
  }

  throw new Error(`Unsupported artifact storage type "${input.storageType}".`);
}

export async function downloadStoredArtifact(input: {
  storageType: StoredArtifactRef['storageType'];
  storagePath: string;
  projectId?: string;
}): Promise<Buffer> {
  if (input.storageType === 'local_filesystem') {
    return readFile(path.resolve(input.storagePath));
  }

  if (input.storageType === 'gcs') {
    const { bucket, objectPath } = parseGsUri(input.storagePath);
    const storage = getStorageClient(input.projectId);
    const [contents] = await storage.bucket(bucket).file(objectPath).download();
    return contents;
  }

  throw new Error(`Unsupported artifact storage type "${input.storageType}".`);
}

export async function writeStructuredJsonDocument(input: {
  destination: DownloadableJsonDestinationLike;
  crawlRunId: string;
  sourceId: string;
  document: unknown;
  projectId?: string;
}): Promise<{ targetRef: string; writeMode: 'overwrite' }> {
  const raw = `${JSON.stringify(input.document, null, 2)}\n`;
  const resolvedTarget = buildStructuredJsonStorageRef({
    destination: input.destination,
    crawlRunId: input.crawlRunId,
    sourceId: input.sourceId,
  });

  if (resolvedTarget.storageType === 'local_filesystem') {
    await mkdir(path.dirname(resolvedTarget.storagePath), { recursive: true });
    await writeFile(resolvedTarget.storagePath, raw, 'utf8');
    return {
      targetRef: resolvedTarget.storagePath,
      writeMode: 'overwrite',
    };
  }

  if (resolvedTarget.storageType === 'gcs') {
    const storage = getStorageClient(input.projectId);
    const { bucket, objectPath } = parseGsUri(resolvedTarget.storagePath);
    await storage.bucket(bucket).file(objectPath).save(raw, {
      resumable: false,
      contentType: 'application/json; charset=utf-8',
    });

    return {
      targetRef: resolvedTarget.storagePath,
      writeMode: 'overwrite',
    };
  }

  throw new Error(
    `Structured JSON adapter only supports downloadable_json destinations, received "${input.destination.type}".`,
  );
}

export function buildStructuredJsonStorageRef(input: {
  destination: DownloadableJsonDestinationLike;
  crawlRunId: string;
  sourceId: string;
}): {
  storageType: 'local_filesystem' | 'gcs';
  storagePath: string;
  fileName: string;
} {
  const fileName = buildStructuredJsonFileName(input.sourceId);

  if (input.destination.config.storageType === 'local_filesystem') {
    return {
      storageType: 'local_filesystem',
      storagePath: path.join(
        buildStructuredRunDir(path.resolve(input.destination.config.basePath), input.crawlRunId),
        fileName,
      ),
      fileName,
    };
  }

  if (input.destination.config.storageType === 'gcs') {
    const objectPath = buildGcsObjectPath(
      input.destination.config.prefix,
      path.posix.join('runs', input.crawlRunId, 'records', fileName),
    );
    return {
      storageType: 'gcs',
      storagePath: buildGsUri(input.destination.config.bucket, objectPath),
      fileName,
    };
  }

  throw new Error('Unsupported downloadable_json storage type.');
}

export function assertStructuredJsonStoragePathForRun(input: {
  destination: DownloadableJsonDestinationLike;
  crawlRunId: string;
  storagePath: string;
}): string {
  if (input.destination.config.storageType === 'local_filesystem') {
    const expectedRunDir = path.resolve(
      buildStructuredRunDir(path.resolve(input.destination.config.basePath), input.crawlRunId),
    );
    const resolvedStoragePath = path.resolve(input.storagePath);
    const expectedPrefix = `${expectedRunDir}${path.sep}`;
    if (resolvedStoragePath !== expectedRunDir && !resolvedStoragePath.startsWith(expectedPrefix)) {
      throw new Error(
        `Structured output path "${input.storagePath}" resolved outside the run output directory.`,
      );
    }

    return resolvedStoragePath;
  }

  if (input.destination.config.storageType === 'gcs') {
    const { bucket, objectPath } = parseGsUri(input.storagePath);
    if (bucket !== input.destination.config.bucket) {
      throw new Error(
        `Structured output bucket "${bucket}" does not match the run destination bucket.`,
      );
    }

    const expectedPrefix = buildGcsObjectPath(
      input.destination.config.prefix,
      `${path.posix.join('runs', input.crawlRunId)}/`,
    );
    if (!objectPath.startsWith(expectedPrefix)) {
      throw new Error(
        `Structured output path "${input.storagePath}" is outside the run output prefix.`,
      );
    }

    return input.storagePath;
  }

  throw new Error('Unsupported downloadable_json storage type.');
}

export async function publishBrokerEvent(input: {
  broker: BrokerTransportConfig;
  event: BrokerEvent;
}): Promise<{ archivePath: string; messageId?: string }> {
  const archivePath = await writeBrokerEvent(input.broker.archiveRootDir, input.event);

  if (input.broker.type === 'local') {
    return { archivePath };
  }

  const pubsub = getPubSubClient(input.broker.projectId);
  const topic = pubsub.topic(input.broker.topicName);
  const messageId = await topic.publishMessage({
    data: Buffer.from(JSON.stringify(input.event)),
    attributes: {
      runId: input.event.runId,
      eventType: input.event.eventType,
      producer: input.event.producer,
      occurredAt: input.event.occurredAt,
      correlationId: input.event.correlationId,
    },
  });

  return { archivePath, messageId };
}

export async function readArchivedBrokerEvents(input: {
  broker: Pick<BrokerTransportConfig, 'archiveRootDir'>;
  runId: string;
}): Promise<BrokerEvent[]> {
  return readBrokerEvents(input.broker.archiveRootDir, input.runId);
}

export async function createBrokerRunConsumer(input: {
  broker: BrokerTransportConfig;
  runId: string;
}): Promise<BrokerRunConsumer> {
  if (input.broker.type === 'local') {
    return {
      poll: () => readBrokerEvents(input.broker.archiveRootDir, input.runId),
      close: async () => undefined,
    };
  }

  const pubsub = getPubSubClient(input.broker.projectId);
  const topic = pubsub.topic(input.broker.topicName);
  const subscriptionName = [
    input.broker.subscriptionNamePrefix ?? 'omnicrawl-control-plane-run',
    sanitizePubSubNameSegment(input.runId),
    randomUUID().slice(0, 8),
  ].join('-');

  await topic.createSubscription(subscriptionName, {
    filter: `attributes.runId="${input.runId}"`,
  });

  const subscription = pubsub.subscription(subscriptionName, {
    flowControl: {
      maxMessages: DEFAULT_PUBSUB_MAX_MESSAGES,
    },
  });

  return {
    subscriptionName,
    poll: (options) =>
      pollPubSubSubscription(
        subscription,
        options?.timeoutMs ?? DEFAULT_PUBSUB_TIMEOUT_MS,
        options?.maxMessages ?? DEFAULT_PUBSUB_MAX_MESSAGES,
      ),
    close: async () => {
      await subscription.close().catch(() => undefined);
      await subscription.delete().catch(() => undefined);
    },
  };
}
