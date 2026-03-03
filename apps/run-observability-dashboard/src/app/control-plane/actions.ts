'use server';

import { revalidatePath } from 'next/cache';
import {
  createArtifactDestination,
  createPipeline,
  createRuntimeProfile,
  createSearchSpace,
  createStructuredOutputDestination,
  startRun,
} from '@/server/control-plane/service';

function getRequiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required field "${key}".`);
  }

  return value.trim();
}

function getOptionalString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function getPositiveInt(formData: FormData, key: string): number {
  const value = Number.parseInt(getRequiredString(formData, key), 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Field "${key}" must be a positive integer.`);
  }

  return value;
}

function getBoolean(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on';
}

function parseMultilineUrls(value: string): string[] {
  return value
    .split(/\r?\n|,/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseStructuredOutputIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export async function createSearchSpaceAction(formData: FormData): Promise<void> {
  await createSearchSpace({
    id: getOptionalString(formData, 'id'),
    name: getRequiredString(formData, 'name'),
    description: getOptionalString(formData, 'description') ?? '',
    sourceType: 'jobs_cz',
    startUrls: parseMultilineUrls(getRequiredString(formData, 'startUrls')),
    maxItemsDefault: getPositiveInt(formData, 'maxItemsDefault'),
    maxConcurrencyDefault: getPositiveInt(formData, 'maxConcurrencyDefault'),
    maxRequestsPerMinuteDefault: getPositiveInt(formData, 'maxRequestsPerMinuteDefault'),
    allowInactiveMarkingOnPartialRuns: getBoolean(formData, 'allowInactiveMarkingOnPartialRuns'),
    status: 'active',
  });

  revalidatePath('/control-plane');
}

export async function createRuntimeProfileAction(formData: FormData): Promise<void> {
  await createRuntimeProfile({
    id: getOptionalString(formData, 'id'),
    name: getRequiredString(formData, 'name'),
    crawlerMaxConcurrency: getPositiveInt(formData, 'crawlerMaxConcurrency'),
    crawlerMaxRequestsPerMinute: getPositiveInt(formData, 'crawlerMaxRequestsPerMinute'),
    ingestionConcurrency: getPositiveInt(formData, 'ingestionConcurrency'),
    ingestionEnabled: getBoolean(formData, 'ingestionEnabled'),
    debugLog: getBoolean(formData, 'debugLog'),
    status: 'active',
  });

  revalidatePath('/control-plane');
}

export async function createArtifactDestinationAction(formData: FormData): Promise<void> {
  await createArtifactDestination({
    id: getOptionalString(formData, 'id'),
    name: getRequiredString(formData, 'name'),
    type: 'local_filesystem',
    config: {
      basePath: getRequiredString(formData, 'basePath'),
    },
    status: 'active',
  });

  revalidatePath('/control-plane');
}

export async function createStructuredOutputDestinationAction(formData: FormData): Promise<void> {
  const type = getRequiredString(formData, 'type');
  if (type === 'mongodb') {
    await createStructuredOutputDestination({
      id: getOptionalString(formData, 'id'),
      name: getRequiredString(formData, 'name'),
      type: 'mongodb',
      config: {
        connectionRef: getOptionalString(formData, 'connectionRef'),
        collectionName: getOptionalString(formData, 'collectionName') ?? 'normalized_job_ads',
      },
      status: 'active',
    });
  } else {
    await createStructuredOutputDestination({
      id: getOptionalString(formData, 'id'),
      name: getRequiredString(formData, 'name'),
      type: 'local_json',
      config: {
        basePath: getRequiredString(formData, 'basePath'),
      },
      status: 'active',
    });
  }

  revalidatePath('/control-plane');
}

export async function createPipelineAction(formData: FormData): Promise<void> {
  await createPipeline({
    id: getOptionalString(formData, 'id'),
    name: getRequiredString(formData, 'name'),
    searchSpaceId: getRequiredString(formData, 'searchSpaceId'),
    runtimeProfileId: getRequiredString(formData, 'runtimeProfileId'),
    artifactDestinationId: getRequiredString(formData, 'artifactDestinationId'),
    structuredOutputDestinationIds: parseStructuredOutputIds(
      getOptionalString(formData, 'structuredOutputDestinationIds'),
    ),
    mode: getRequiredString(formData, 'mode') === 'crawl_only' ? 'crawl_only' : 'crawl_and_ingest',
    status: 'active',
  });

  revalidatePath('/control-plane');
}

export async function startRunAction(formData: FormData): Promise<void> {
  await startRun({
    pipelineId: getRequiredString(formData, 'pipelineId'),
    createdBy: 'dashboard-ui',
  });

  revalidatePath('/control-plane');
}
