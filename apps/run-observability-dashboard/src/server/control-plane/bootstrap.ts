import { readdir, readFile } from 'node:fs/promises';
import {
  artifactDestinationSchema,
  nowIso,
  runtimeProfileSchema,
  searchSpaceSchema,
  structuredOutputDestinationSchema,
  type ArtifactDestination,
  type RuntimeProfile,
  type SearchSpace,
  type StructuredOutputDestination,
} from '@repo/control-plane-contracts';
import { searchSpaceConfigSchema } from '@repo/job-search-spaces';
import {
  bootstrapSearchSpacesDir,
  defaultArtifactRootDir,
  defaultJsonOutputRootDir,
} from '@/server/control-plane/paths';
import {
  ensureControlPlaneStorage,
  getArtifactDestination,
  getRuntimeProfile,
  getStructuredOutputDestination,
  listSearchSpaces,
  writeArtifactDestination,
  writeRuntimeProfile,
  writeSearchSpace,
  writeStructuredOutputDestination,
} from '@/server/control-plane/store';

const DEFAULT_RUNTIME_PROFILE_ID = 'default-local-runtime';
const DEFAULT_ARTIFACT_DESTINATION_ID = 'local-shared-html';
const DEFAULT_JSON_OUTPUT_DESTINATION_ID = 'local-json-output';
const DEFAULT_MONGO_OUTPUT_DESTINATION_ID = 'mongo-normalized-jobs';

function toSearchSpaceRecord(input: {
  id: string;
  description: string;
  startUrls: string[];
  maxItemsDefault: number;
  maxConcurrencyDefault: number;
  maxRequestsPerMinuteDefault: number;
  allowInactiveMarkingOnPartialRuns: boolean;
}): SearchSpace {
  const timestamp = nowIso();
  return searchSpaceSchema.parse({
    id: input.id,
    name: input.id,
    description: input.description,
    sourceType: 'jobs_cz',
    startUrls: input.startUrls,
    maxItemsDefault: input.maxItemsDefault,
    maxConcurrencyDefault: input.maxConcurrencyDefault,
    maxRequestsPerMinuteDefault: input.maxRequestsPerMinuteDefault,
    allowInactiveMarkingOnPartialRuns: input.allowInactiveMarkingOnPartialRuns,
    status: 'active',
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function buildDefaultRuntimeProfile(): RuntimeProfile {
  const timestamp = nowIso();
  return runtimeProfileSchema.parse({
    id: DEFAULT_RUNTIME_PROFILE_ID,
    name: 'Default local runtime',
    crawlerMaxConcurrency: 1,
    crawlerMaxRequestsPerMinute: 30,
    ingestionConcurrency: 1,
    ingestionEnabled: true,
    debugLog: false,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function buildDefaultArtifactDestination(): ArtifactDestination {
  const timestamp = nowIso();
  return artifactDestinationSchema.parse({
    id: DEFAULT_ARTIFACT_DESTINATION_ID,
    name: 'Local shared HTML',
    type: 'local_filesystem',
    config: {
      basePath: defaultArtifactRootDir,
    },
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function buildDefaultJsonOutputDestination(): StructuredOutputDestination {
  const timestamp = nowIso();
  return structuredOutputDestinationSchema.parse({
    id: DEFAULT_JSON_OUTPUT_DESTINATION_ID,
    name: 'Local normalized JSON',
    type: 'local_json',
    config: {
      basePath: defaultJsonOutputRootDir,
    },
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function buildDefaultMongoOutputDestination(): StructuredOutputDestination {
  const timestamp = nowIso();
  return structuredOutputDestinationSchema.parse({
    id: DEFAULT_MONGO_OUTPUT_DESTINATION_ID,
    name: 'Mongo normalized jobs',
    type: 'mongodb',
    config: {
      connectionRef: 'env:MONGODB_URI',
      collectionName: 'normalized_job_ads',
    },
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

async function bootstrapSearchSpaces(): Promise<void> {
  const existing = await listSearchSpaces();
  if (existing.length > 0) {
    return;
  }

  const entries = await readdir(bootstrapSearchSpacesDir, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [];
      }

      throw error;
    },
  );

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const raw = await readFile(`${bootstrapSearchSpacesDir}/${entry.name}`, 'utf8');
        const parsed = searchSpaceConfigSchema.parse(JSON.parse(raw) as unknown);
        await writeSearchSpace(
          toSearchSpaceRecord({
            id: parsed.searchSpaceId,
            description: parsed.description,
            startUrls: parsed.startUrls,
            maxItemsDefault: parsed.crawlDefaults.maxItems,
            maxConcurrencyDefault: parsed.crawlDefaults.maxConcurrency,
            maxRequestsPerMinuteDefault: parsed.crawlDefaults.maxRequestsPerMinute,
            allowInactiveMarkingOnPartialRuns:
              parsed.reconciliation.allowInactiveMarkingOnPartialRuns,
          }),
        );
      }),
  );
}

async function ensureDefaultRuntimeProfile(): Promise<void> {
  const existing = await getRuntimeProfile(DEFAULT_RUNTIME_PROFILE_ID);
  if (!existing) {
    await writeRuntimeProfile(buildDefaultRuntimeProfile());
  }
}

async function ensureDefaultArtifactDestination(): Promise<void> {
  const existing = await getArtifactDestination(DEFAULT_ARTIFACT_DESTINATION_ID);
  if (!existing) {
    await writeArtifactDestination(buildDefaultArtifactDestination());
  }
}

async function ensureDefaultStructuredOutputs(): Promise<void> {
  const localJson = await getStructuredOutputDestination(DEFAULT_JSON_OUTPUT_DESTINATION_ID);
  if (!localJson) {
    await writeStructuredOutputDestination(buildDefaultJsonOutputDestination());
  }

  const mongo = await getStructuredOutputDestination(DEFAULT_MONGO_OUTPUT_DESTINATION_ID);
  if (!mongo) {
    await writeStructuredOutputDestination(buildDefaultMongoOutputDestination());
  }
}

export async function ensureControlPlaneBootstrap(): Promise<void> {
  await ensureControlPlaneStorage();
  await bootstrapSearchSpaces();
  await ensureDefaultRuntimeProfile();
  await ensureDefaultArtifactDestination();
  await ensureDefaultStructuredOutputs();
}

export const defaultControlPlaneIds = {
  runtimeProfileId: DEFAULT_RUNTIME_PROFILE_ID,
  artifactDestinationId: DEFAULT_ARTIFACT_DESTINATION_ID,
  jsonOutputDestinationId: DEFAULT_JSON_OUTPUT_DESTINATION_ID,
  mongoOutputDestinationId: DEFAULT_MONGO_OUTPUT_DESTINATION_ID,
} as const;
