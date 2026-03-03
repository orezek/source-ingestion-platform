import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  deriveMongoDbName,
  buildActorInputFromSearchSpace,
  searchSpaceConfigSchema,
  searchSpaceIdSchema,
  type ActorInputOverrides,
  type ActorOperatorInput,
  type ResolvedActorRuntimeInput,
  type SearchSpaceConfig,
} from '@repo/job-search-spaces';
import { envs } from './env-setup.js';

const appRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSearchSpacesDir = path.join(appRootDir, 'search-spaces');
const searchSpacesDir = envs.JOB_COMPASS_SEARCH_SPACES_DIR
  ? path.resolve(envs.JOB_COMPASS_SEARCH_SPACES_DIR)
  : defaultSearchSpacesDir;

export type CliActorOverrides = Partial<ActorOperatorInput> & {
  useApifyProxy?: boolean;
};

export const parseCliActorOverrides = (argv: string[]): CliActorOverrides => {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const parsed = parseArgs({
    args: normalizedArgv,
    options: {
      'search-space': { type: 'string', short: 's' },
      'max-items': { type: 'string' },
      'max-concurrency': { type: 'string' },
      'max-requests-per-minute': { type: 'string' },
      'debug-log': { type: 'boolean' },
      'use-apify-proxy': { type: 'boolean' },
      'allow-inactive-marking-on-partial-runs': { type: 'boolean' },
    },
    allowPositionals: false,
  });

  const parseOptionalPositiveInt = (
    value: string | undefined,
    flagName: string,
  ): number | undefined => {
    if (value === undefined) {
      return undefined;
    }

    const parsedValue = Number.parseInt(value, 10);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new Error(`${flagName} must be a positive integer.`);
    }

    return parsedValue;
  };

  return {
    searchSpaceId:
      typeof parsed.values['search-space'] === 'string'
        ? searchSpaceIdSchema.parse(parsed.values['search-space'])
        : undefined,
    maxItems: parseOptionalPositiveInt(parsed.values['max-items'], '--max-items'),
    maxConcurrency: parseOptionalPositiveInt(parsed.values['max-concurrency'], '--max-concurrency'),
    maxRequestsPerMinute: parseOptionalPositiveInt(
      parsed.values['max-requests-per-minute'],
      '--max-requests-per-minute',
    ),
    debugLog: parsed.values['debug-log'],
    useApifyProxy: parsed.values['use-apify-proxy'],
    allowInactiveMarkingOnPartialRuns: parsed.values['allow-inactive-marking-on-partial-runs'],
  };
};

export const loadSearchSpaceConfig = async (searchSpaceId: string): Promise<SearchSpaceConfig> => {
  const normalizedSearchSpaceId = searchSpaceIdSchema.parse(searchSpaceId);
  const filePath = path.join(searchSpacesDir, `${normalizedSearchSpaceId}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    return searchSpaceConfigSchema.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      const availableSearchSpaceIds = await listAvailableSearchSpaceIds();
      throw new Error(
        [
          `Unknown searchSpaceId "${normalizedSearchSpaceId}".`,
          `Available search spaces: ${availableSearchSpaceIds.join(', ') || 'none found'}.`,
        ].join(' '),
      );
    }

    throw error;
  }
};

export const listAvailableSearchSpaceIds = async (): Promise<string[]> => {
  const searchSpaceEntries = await readdir(searchSpacesDir, { withFileTypes: true });
  return searchSpaceEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/u, ''))
    .sort((left, right) => left.localeCompare(right));
};

export const resolveActorInputForSearchSpace = async (input: {
  searchSpaceId: string;
  overrides?: ActorInputOverrides & { useApifyProxy?: boolean };
}): Promise<{ searchSpace: SearchSpaceConfig; actorInput: ResolvedActorRuntimeInput }> => {
  const searchSpace = await loadSearchSpaceConfig(input.searchSpaceId);
  const resolvedOverrides = input.overrides ?? {};
  const actorOverrides: ActorInputOverrides = {
    maxItems: resolvedOverrides.maxItems,
    maxConcurrency: resolvedOverrides.maxConcurrency,
    maxRequestsPerMinute: resolvedOverrides.maxRequestsPerMinute,
    debugLog: resolvedOverrides.debugLog,
    allowInactiveMarkingOnPartialRuns: resolvedOverrides.allowInactiveMarkingOnPartialRuns,
    proxyConfiguration:
      resolvedOverrides.proxyConfiguration ??
      (resolvedOverrides.useApifyProxy !== undefined
        ? { useApifyProxy: resolvedOverrides.useApifyProxy }
        : undefined),
  };

  return {
    searchSpace,
    actorInput: buildActorInputFromSearchSpace(searchSpace, actorOverrides),
  };
};

export const resolveSearchSpaceMongoDbName = (input: {
  dbPrefix: string;
  searchSpaceId: string;
  explicitDbName?: string | null;
}): string => deriveMongoDbName(input);
