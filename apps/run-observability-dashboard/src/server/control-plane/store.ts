import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  ArtifactDestination,
  ControlPlaneRun,
  Pipeline,
  RunManifest,
  SearchSpace,
  StructuredOutputDestination,
  RuntimeProfile,
} from '@repo/control-plane-contracts';
import {
  artifactDestinationSchema,
  controlPlaneRunSchema,
  pipelineSchema,
  runManifestSchema,
  runtimeProfileSchema,
  searchSpaceSchema,
  structuredOutputDestinationSchema,
} from '@repo/control-plane-contracts';
import {
  buildRunManifestPath,
  buildRunRecordPath,
  buildRunWorkerRuntimePath,
  controlPlaneCollectionDirs,
} from '@/server/control-plane/paths';

export const workerRuntimeSchema = z.object({
  workerType: z.enum(['crawler', 'ingestion']),
  status: z.enum(['queued', 'running', 'succeeded', 'completed_with_errors', 'failed', 'stopped']),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  pid: z.number().int().positive().optional(),
  logPath: z.string().optional(),
  errorMessage: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  counters: z.record(z.string(), z.unknown()).default({}),
});

export type WorkerRuntime = z.infer<typeof workerRuntimeSchema>;

const collectionSchemas = {
  searchSpaces: searchSpaceSchema,
  runtimeProfiles: runtimeProfileSchema,
  artifactDestinations: artifactDestinationSchema,
  structuredOutputDestinations: structuredOutputDestinationSchema,
  pipelines: pipelineSchema,
} as const;

type CollectionName = keyof typeof collectionSchemas;

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return schema.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function ensureControlPlaneStorage(): Promise<void> {
  await Promise.all(Object.values(controlPlaneCollectionDirs).map((dirPath) => ensureDir(dirPath)));
}

export async function listCollectionRecords<T>(
  collectionName: CollectionName,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const dirPath = controlPlaneCollectionDirs[collectionName];
  await ensureDir(dirPath);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const record = await readJsonFile(path.join(dirPath, entry.name), schema);
        return record;
      }),
  );

  return records.filter((record) => record !== null) as T[];
}

export async function writeCollectionRecord<T extends { id: string }>(
  collectionName: CollectionName,
  schema: z.ZodType<T>,
  record: T,
): Promise<T> {
  const parsed = schema.parse(record);
  await writeJsonFile(
    path.join(controlPlaneCollectionDirs[collectionName], `${parsed.id}.json`),
    parsed,
  );
  return parsed;
}

export async function getCollectionRecord<T>(
  collectionName: CollectionName,
  schema: z.ZodType<T>,
  id: string,
): Promise<T | null> {
  return readJsonFile(path.join(controlPlaneCollectionDirs[collectionName], `${id}.json`), schema);
}

export async function listSearchSpaces(): Promise<SearchSpace[]> {
  return listCollectionRecords('searchSpaces', collectionSchemas.searchSpaces);
}

export async function writeSearchSpace(record: SearchSpace): Promise<SearchSpace> {
  return writeCollectionRecord('searchSpaces', collectionSchemas.searchSpaces, record);
}

export async function getSearchSpace(id: string): Promise<SearchSpace | null> {
  return getCollectionRecord('searchSpaces', collectionSchemas.searchSpaces, id);
}

export async function listRuntimeProfiles(): Promise<RuntimeProfile[]> {
  return listCollectionRecords('runtimeProfiles', collectionSchemas.runtimeProfiles);
}

export async function writeRuntimeProfile(record: RuntimeProfile): Promise<RuntimeProfile> {
  return writeCollectionRecord('runtimeProfiles', collectionSchemas.runtimeProfiles, record);
}

export async function getRuntimeProfile(id: string): Promise<RuntimeProfile | null> {
  return getCollectionRecord('runtimeProfiles', collectionSchemas.runtimeProfiles, id);
}

export async function listArtifactDestinations(): Promise<ArtifactDestination[]> {
  return listCollectionRecords('artifactDestinations', collectionSchemas.artifactDestinations);
}

export async function writeArtifactDestination(
  record: ArtifactDestination,
): Promise<ArtifactDestination> {
  return writeCollectionRecord(
    'artifactDestinations',
    collectionSchemas.artifactDestinations,
    record,
  );
}

export async function getArtifactDestination(id: string): Promise<ArtifactDestination | null> {
  return getCollectionRecord('artifactDestinations', collectionSchemas.artifactDestinations, id);
}

export async function listStructuredOutputDestinations(): Promise<StructuredOutputDestination[]> {
  return listCollectionRecords(
    'structuredOutputDestinations',
    collectionSchemas.structuredOutputDestinations,
  );
}

export async function writeStructuredOutputDestination(
  record: StructuredOutputDestination,
): Promise<StructuredOutputDestination> {
  return writeCollectionRecord(
    'structuredOutputDestinations',
    collectionSchemas.structuredOutputDestinations,
    record,
  );
}

export async function getStructuredOutputDestination(
  id: string,
): Promise<StructuredOutputDestination | null> {
  return getCollectionRecord(
    'structuredOutputDestinations',
    collectionSchemas.structuredOutputDestinations,
    id,
  );
}

export async function listPipelines(): Promise<Pipeline[]> {
  return listCollectionRecords('pipelines', collectionSchemas.pipelines);
}

export async function writePipeline(record: Pipeline): Promise<Pipeline> {
  return writeCollectionRecord('pipelines', collectionSchemas.pipelines, record);
}

export async function getPipeline(id: string): Promise<Pipeline | null> {
  return getCollectionRecord('pipelines', collectionSchemas.pipelines, id);
}

export async function writeRunRecord(record: ControlPlaneRun): Promise<ControlPlaneRun> {
  const parsed = controlPlaneRunSchema.parse(record);
  await writeJsonFile(buildRunRecordPath(parsed.runId), parsed);
  return parsed;
}

export async function getRunRecord(runId: string): Promise<ControlPlaneRun | null> {
  return readJsonFile(buildRunRecordPath(runId), controlPlaneRunSchema);
}

export async function listRunRecords(): Promise<ControlPlaneRun[]> {
  const runsDir = controlPlaneCollectionDirs.runs;
  await ensureDir(runsDir);
  const entries = await readdir(runsDir, { withFileTypes: true });
  const records = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => getRunRecord(entry.name)),
  );

  return records.filter((record) => record !== null) as ControlPlaneRun[];
}

export async function writeRunManifest(record: RunManifest): Promise<RunManifest> {
  const parsed = runManifestSchema.parse(record);
  await writeJsonFile(buildRunManifestPath(parsed.runId), parsed);
  return parsed;
}

export async function getRunManifest(runId: string): Promise<RunManifest | null> {
  return readJsonFile(buildRunManifestPath(runId), runManifestSchema);
}

export async function writeWorkerRuntime(
  runId: string,
  runtime: WorkerRuntime,
): Promise<WorkerRuntime> {
  const parsed = workerRuntimeSchema.parse(runtime);
  await writeJsonFile(buildRunWorkerRuntimePath(runId, parsed.workerType), parsed);
  return parsed;
}

export async function getWorkerRuntime(
  runId: string,
  workerType: 'crawler' | 'ingestion',
): Promise<WorkerRuntime | null> {
  return readJsonFile(buildRunWorkerRuntimePath(runId, workerType), workerRuntimeSchema);
}
