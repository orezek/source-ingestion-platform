import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

import { GeminiJobDetailExtractor } from './extraction.js';
import { IncompleteDetailPageError } from './html-detail-loader.js';
import { LocalScrapedJobsInputProvider } from './input-provider.js';
import { JobParsingGraph } from './job-parsing-graph.js';
import { createLogger } from './logger.js';
import { writeOutputToFile, writeOutputToMongo } from './repository.js';
import type { UnifiedJobAd } from './schema.js';

const toOptionalPositiveInt = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return value;
}, z.coerce.number().int().positive().nullable());

const toBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === '') {
      return false;
    }
  }

  return value;
}, z.boolean());

const thinkingLevelSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return value;
  },
  z.enum(['THINKING_LEVEL_UNSPECIFIED', 'LOW', 'MEDIUM', 'HIGH']).nullable(),
);

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
  INPUT_ROOT_DIR: z.string().default('scrapped_jobs'),
  INPUT_RECORDS_DIR_NAME: z.string().default('records'),
  INGESTION_SAMPLE_SIZE: toOptionalPositiveInt.default(null),
  INGESTION_CONCURRENCY: z.coerce.number().int().positive().max(32).default(1),
  GEMINI_API_KEY: z.string().optional(),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROMPT_NAME: z.string().default('job-ad-extractor'),
  GEMINI_MODEL: z.string().default('gemini-3-flash-preview'),
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
  GEMINI_THINKING_LEVEL: thinkingLevelSchema.default('LOW'),
  DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS: z.coerce.number().int().min(100).max(300_000).default(700),
  GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS: z.coerce.number().nonnegative().default(0.5),
  GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS: z.coerce.number().nonnegative().default(3),
  OUTPUT_JSON_PATH: z.string().default('output/normalized-jobs.json'),
  ENABLE_MONGO_WRITE: toBoolean.default(false),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().default('jobcompass'),
  MONGODB_JOBS_COLLECTION: z.string().default('ingestionCollection'),
  PARSER_VERSION: z.string().default('job-ingestion-service-v0.5.0'),
});

export type EnvSchema = z.infer<typeof envSchema>;

type ParseRunStats = {
  avgTimeToProcssSeconds: number;
  p50TimeToProcssSeconds: number;
  p95TimeToProcssSeconds: number;
  avgLlmCallDurationSeconds: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
};

export const envs: EnvSchema = loadEnv(envSchema, import.meta.url);
const logger = createLogger(envs.LOG_LEVEL);

const appRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputRootDir = path.resolve(appRootDir, envs.INPUT_ROOT_DIR);
const outputJsonPath = path.resolve(appRootDir, envs.OUTPUT_JSON_PATH);

const percentile = (values: number[], ratio: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(sorted.length * ratio) - 1;
  const safeIndex = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[safeIndex] ?? 0;
};

const buildRunStats = (parsed: UnifiedJobAd[]): ParseRunStats => {
  if (parsed.length === 0) {
    return {
      avgTimeToProcssSeconds: 0,
      p50TimeToProcssSeconds: 0,
      p95TimeToProcssSeconds: 0,
      avgLlmCallDurationSeconds: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalEstimatedCostUsd: 0,
    };
  }

  const timeToProcssValues = parsed.map((item) => item.ingestion.timeToProcssSeconds);
  const llmCallDurations = parsed.map((item) => item.ingestion.llmCallDurationSeconds);
  const totalInputTokens = parsed.reduce((sum, item) => sum + item.ingestion.llmInputTokens, 0);
  const totalOutputTokens = parsed.reduce((sum, item) => sum + item.ingestion.llmOutputTokens, 0);
  const totalTokens = parsed.reduce((sum, item) => sum + item.ingestion.llmTotalTokens, 0);
  const totalEstimatedCostUsd = parsed.reduce(
    (sum, item) => sum + item.ingestion.llmTotalCostUsd,
    0,
  );

  return {
    avgTimeToProcssSeconds:
      timeToProcssValues.reduce((sum, value) => sum + value, 0) / timeToProcssValues.length,
    p50TimeToProcssSeconds: percentile(timeToProcssValues, 0.5),
    p95TimeToProcssSeconds: percentile(timeToProcssValues, 0.95),
    avgLlmCallDurationSeconds:
      llmCallDurations.reduce((sum, value) => sum + value, 0) / llmCallDurations.length,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalEstimatedCostUsd,
  };
};

const parseRecords = async (): Promise<{
  structuredParsed: UnifiedJobAd[];
  failed: number;
  skippedIncomplete: number;
  stats: ParseRunStats;
}> => {
  if (!envs.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required to run detail-page extraction.');
  }
  if (!envs.LANGSMITH_API_KEY) {
    throw new Error(
      'LANGSMITH_API_KEY is required to pull the extractDetail prompt from LangSmith Hub.',
    );
  }

  const inputProvider = new LocalScrapedJobsInputProvider(
    logger.child({ component: 'InputProvider' }),
  );
  const inputRecords = await inputProvider.loadInputRecords({
    inputRootDir,
    recordsDirName: envs.INPUT_RECORDS_DIR_NAME,
    sampleSize: envs.INGESTION_SAMPLE_SIZE,
  });

  const extractor = new GeminiJobDetailExtractor({
    langsmithApiKey: envs.LANGSMITH_API_KEY,
    langsmithPromptName: envs.LANGSMITH_PROMPT_NAME,
    apiKey: envs.GEMINI_API_KEY,
    model: envs.GEMINI_MODEL,
    temperature: envs.GEMINI_TEMPERATURE,
    thinkingLevel: envs.GEMINI_THINKING_LEVEL,
    inputPriceUsdPerMillionTokens: envs.GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS,
    outputPriceUsdPerMillionTokens: envs.GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS,
    logger,
  });

  const parserGraph = new JobParsingGraph({
    extractor,
    minRelevantTextChars: envs.DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS,
    parserVersion: envs.PARSER_VERSION,
    logger,
  });

  const workerCount = Math.max(1, Math.min(envs.INGESTION_CONCURRENCY, inputRecords.length));
  const parsedByIndex: Array<UnifiedJobAd | null> = new Array(inputRecords.length).fill(null);
  let failed = 0;
  let skippedIncomplete = 0;
  let nextIndex = 0;

  logger.info(
    {
      inputRecords: inputRecords.length,
      sampleSize: envs.INGESTION_SAMPLE_SIZE ?? 'all',
      model: envs.GEMINI_MODEL,
      langsmithPromptName: envs.LANGSMITH_PROMPT_NAME,
      concurrency: workerCount,
      minRelevantTextChars: envs.DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS,
    },
    'Starting parse run',
  );

  const runWorker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= inputRecords.length) {
        return;
      }

      const inputRecord = inputRecords[currentIndex];
      if (!inputRecord) {
        return;
      }

      try {
        const parsedRecord = await parserGraph.parseRecord(inputRecord);
        parsedByIndex[currentIndex] = parsedRecord;
      } catch (error) {
        if (error instanceof IncompleteDetailPageError) {
          skippedIncomplete += 1;
          logger.warn(
            {
              sourceId: inputRecord.listingRecord.sourceId,
              source: inputRecord.listingRecord.source,
              detailHtmlPath: inputRecord.detailHtmlPath,
              reason: error.message,
              qualitySignals: error.qualitySignals,
            },
            'Skipped record because detail page is incomplete',
          );
          continue;
        }

        failed += 1;
        logger.error(
          {
            err: error,
            sourceId: inputRecord.listingRecord.sourceId,
            source: inputRecord.listingRecord.source,
            detailHtmlPath: inputRecord.detailHtmlPath,
          },
          'Failed parsing record',
        );
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const structuredParsed = parsedByIndex.filter((item): item is UnifiedJobAd => item !== null);
  const stats = buildRunStats(structuredParsed);

  return { structuredParsed, failed, skippedIncomplete, stats };
};

async function main(): Promise<void> {
  logger.info(
    {
      inputRootDir,
      outputJsonPath,
      enableMongoWrite: envs.ENABLE_MONGO_WRITE,
      mongoDbName: envs.MONGODB_DB_NAME,
      mongoCollectionStructured: envs.MONGODB_JOBS_COLLECTION,
      model: envs.GEMINI_MODEL,
      langsmithPromptName: envs.LANGSMITH_PROMPT_NAME,
      minRelevantTextChars: envs.DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS,
      logLevel: envs.LOG_LEVEL,
    },
    'Run configuration',
  );

  const startedAt = performance.now();
  const { structuredParsed, failed, skippedIncomplete, stats } = await parseRecords();
  const runDurationSeconds = (performance.now() - startedAt) / 1_000;

  await writeOutputToFile(
    outputJsonPath,
    structuredParsed,
    logger.child({ component: 'FileRepository' }),
  );

  let mongoWrittenStructured = 0;
  if (envs.ENABLE_MONGO_WRITE) {
    if (!envs.MONGODB_URI) {
      throw new Error('ENABLE_MONGO_WRITE=true requires MONGODB_URI to be configured.');
    }

    mongoWrittenStructured = await writeOutputToMongo(
      {
        mongoUri: envs.MONGODB_URI,
        dbName: envs.MONGODB_DB_NAME,
        collectionName: envs.MONGODB_JOBS_COLLECTION,
      },
      structuredParsed,
      logger.child({ component: 'MongoRepository', outputType: 'structured' }),
    );
  }

  logger.info(
    {
      parsedStructured: structuredParsed.length,
      failed,
      skippedIncomplete,
      outputJsonPath,
      mongoWritesStructured: mongoWrittenStructured,
      runDurationSeconds,
    },
    'Completed parse run',
  );
  logger.info(
    {
      avgTimeToProcssSeconds: stats.avgTimeToProcssSeconds,
      p50TimeToProcssSeconds: stats.p50TimeToProcssSeconds,
      p95TimeToProcssSeconds: stats.p95TimeToProcssSeconds,
      avgLlmCallDurationSeconds: stats.avgLlmCallDurationSeconds,
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens: stats.totalOutputTokens,
      totalTokens: stats.totalTokens,
      totalEstimatedCostUsd: stats.totalEstimatedCostUsd,
    },
    'Parse run stats',
  );
}

void main().catch((error) => {
  logger.fatal({ err: error }, 'Unhandled fatal error in ingestion runner');
  process.exitCode = 1;
});
