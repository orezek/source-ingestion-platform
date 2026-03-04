import { readdir, readFile } from 'node:fs/promises';
import {
  nowIso,
  runtimeProfileSchema,
  searchSpaceSchema,
  structuredOutputDestinationSchema,
  type RuntimeProfile,
  type SearchSpace,
  type StructuredOutputDestination,
} from '@repo/control-plane-contracts';
import { searchSpaceConfigSchema } from '@repo/job-search-spaces';
import { bootstrapSearchSpacesDir } from '@/server/control-plane/paths';
import {
  ensureControlPlaneStorage,
  getRuntimeProfile,
  getStructuredOutputDestination,
  listSearchSpaces,
  writeRuntimeProfile,
  writeSearchSpace,
  writeStructuredOutputDestination,
} from '@/server/control-plane/store';
import { IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID } from '@/server/control-plane/builtin-outputs';

const DEFAULT_RUNTIME_PROFILE_ID = 'default-local-runtime';
const DEFAULT_MONGO_OUTPUT_DESTINATION_ID = 'mongo-normalized-jobs';

function toSearchSpaceRecord(input: {
  id: string;
  description: string;
  startUrls: string[];
  maxItemsDefault: number;
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

function buildDefaultMongoOutputDestination(): StructuredOutputDestination {
  const timestamp = nowIso();
  return structuredOutputDestinationSchema.parse({
    id: DEFAULT_MONGO_OUTPUT_DESTINATION_ID,
    name: 'Mongo normalized jobs',
    type: 'mongodb',
    config: {
      connectionUri: 'env:MONGODB_URI',
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

async function ensureDefaultStructuredOutputs(): Promise<void> {
  const mongo = await getStructuredOutputDestination(DEFAULT_MONGO_OUTPUT_DESTINATION_ID);
  if (!mongo) {
    await writeStructuredOutputDestination(buildDefaultMongoOutputDestination());
  }
}

export async function ensureControlPlaneBootstrap(): Promise<void> {
  await ensureControlPlaneStorage();
  await bootstrapSearchSpaces();
  await ensureDefaultRuntimeProfile();
  await ensureDefaultStructuredOutputs();
}

export const defaultControlPlaneIds = {
  runtimeProfileId: DEFAULT_RUNTIME_PROFILE_ID,
  jsonOutputDestinationId: IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID,
  mongoOutputDestinationId: DEFAULT_MONGO_OUTPUT_DESTINATION_ID,
} as const;
