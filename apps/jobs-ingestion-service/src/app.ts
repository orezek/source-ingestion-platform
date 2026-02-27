import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadEnv } from '@repo/env-config';
import { z } from 'zod';

import { GeminiDetailTextCleaner, GeminiJobDetailExtractor } from './extraction.js';
import { IncompleteDetailPageError } from './html-detail-loader.js';
import { LocalScrapedJobsInputProvider } from './input-provider.js';
import { JobParsingGraph } from './job-parsing-graph.js';
import { createLogger } from './logger.js';
import { pruneCrawlStateByDocIds, writeOutputToFile, writeOutputToMongo } from './repository.js';
import { sourceListingRecordSchema, type UnifiedJobAd } from './schema.js';

const toOptionalPositiveInt = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === 'all') {
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
  LOG_PRETTY: toBoolean.default(false),
  LOG_TEXT_TRANSFORM_CONTENT: toBoolean.default(false),
  LOG_TEXT_TRANSFORM_PREVIEW_CHARS: z.coerce.number().int().min(120).max(20_000).default(1200),
  INPUT_ROOT_DIR: z.string().default('scrapped_jobs'),
  INPUT_RECORDS_DIR_NAME: z.string().default('records'),
  INGESTION_SAMPLE_SIZE: toOptionalPositiveInt.default(null),
  INGESTION_CONCURRENCY: z.coerce.number().int().positive().max(32).default(1),
  GEMINI_API_KEY: z.string().optional(),
  LANGSMITH_API_KEY: z.string().optional(),
  LLM_EXTRACTOR_PROMPT_NAME: z.string().default('jobcompass-job-ad-structured-extractor'),
  LLM_CLEANER_PROMPT_NAME: z.string().default('jobcompass-job-ad-text-cleaner'),
  GEMINI_MODEL: z.string().default('gemini-3-flash-preview'),
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
  GEMINI_THINKING_LEVEL: thinkingLevelSchema.default('LOW'),
  DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS: z.coerce.number().int().min(100).max(300_000).default(700),
  GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS: z.coerce.number().nonnegative().default(0.5),
  GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS: z.coerce.number().nonnegative().default(3),
  OUTPUT_JSON_PATH: z.string().default('output/normalized-jobs.json'),
  CRAWL_RUNS_SUBDIR: z.string().default('runs'),
  INGESTION_API_HOST: z.string().default('127.0.0.1'),
  INGESTION_API_PORT: z.coerce.number().int().min(1).max(65_535).default(3010),
  ENABLE_MONGO_WRITE: toBoolean.default(false),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().default('jobCompass'),
  MONGODB_JOBS_COLLECTION: z.string().default('normalized_job_ads'),
  MONGODB_CRAWL_JOBS_COLLECTION: z.string().default('crawl_job_states'),
  MONGODB_RUN_SUMMARIES_COLLECTION: z.string().default('ingestion_run_summaries'),
  MONGODB_INGESTION_TRIGGERS_COLLECTION: z.string().default('ingestion_trigger_requests'),
  PARSER_VERSION: z.string().default('jobs-ingestion-service-v0.9.0'),
});

export type EnvSchema = z.infer<typeof envSchema>;

type ParseRunStats = {
  avgTimeToProcssSeconds: number;
  p50TimeToProcssSeconds: number;
  p95TimeToProcssSeconds: number;
  avgLlmCleanerCallDurationSeconds: number;
  avgLlmExtractorCallDurationSeconds: number;
  avgLlmTotalCallDurationSeconds: number;
  p50LlmTotalCallDurationSeconds: number;
  p95LlmTotalCallDurationSeconds: number;
  llmCleanerCalls: number;
  llmExtractorCalls: number;
  llmTotalCalls: number;
  llmCleanerInputTokens: number;
  llmCleanerOutputTokens: number;
  llmCleanerTotalTokens: number;
  llmCleanerInputCostUsd: number;
  llmCleanerOutputCostUsd: number;
  llmCleanerTotalCostUsd: number;
  llmExtractorInputTokens: number;
  llmExtractorOutputTokens: number;
  llmExtractorTotalTokens: number;
  llmExtractorInputCostUsd: number;
  llmExtractorOutputCostUsd: number;
  llmExtractorTotalCostUsd: number;
  llmTotalInputTokens: number;
  llmTotalOutputTokens: number;
  llmTotalTokens: number;
  llmTotalInputCostUsd: number;
  llmTotalOutputCostUsd: number;
  llmTotalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
};

const detailPageQualitySignalsSchema = z.object({
  plainTextChars: z.number().int().nonnegative(),
  plainTextWords: z.number().int().nonnegative(),
  hasPrimaryJobContentContainer: z.boolean(),
  primaryJobContentContainerSelector: z.string().nullable(),
  primaryJobContentChars: z.number().int().nonnegative(),
  primaryJobContentWords: z.number().int().nonnegative(),
  detailSignalHits: z.number().int().nonnegative(),
  noiseSignalHits: z.number().int().nonnegative(),
});

const skippedIncompleteJobSchema = z.object({
  sourceId: z.string(),
  source: z.string(),
  datasetFileName: z.string(),
  datasetRecordIndex: z.number().int().nonnegative(),
  detailHtmlPath: z.string(),
  htmlDetailPageKey: z.string(),
  reason: z.string(),
  qualitySignals: detailPageQualitySignalsSchema,
  listing: sourceListingRecordSchema,
});

type SkippedIncompleteJob = z.infer<typeof skippedIncompleteJobSchema>;

const failedJobSchema = z.object({
  sourceId: z.string(),
  source: z.string(),
  datasetFileName: z.string(),
  datasetRecordIndex: z.number().int().nonnegative(),
  detailHtmlPath: z.string(),
  htmlDetailPageKey: z.string(),
  errorName: z.string(),
  errorMessage: z.string(),
  listing: sourceListingRecordSchema,
});

type FailedJob = z.infer<typeof failedJobSchema>;

const llmRunStatsSchema = z.object({
  calls: z.number().int().nonnegative(),
  avgCallDurationSeconds: z.number().nonnegative(),
  p50CallDurationSeconds: z.number().nonnegative(),
  p95CallDurationSeconds: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  inputCostUsd: z.number().nonnegative(),
  outputCostUsd: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});

const ingestionRunSummarySchema = z.object({
  id: z.string(),
  runId: z.string(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  runDurationSeconds: z.number().nonnegative(),
  parserVersion: z.string(),
  extractorModel: z.string(),
  llmExtractorPromptName: z.string(),
  llmCleanerPromptName: z.string(),
  sampleSize: z.union([z.number().int().positive(), z.literal('all')]),
  concurrency: z.number().int().positive(),
  jobsTotal: z.number().int().nonnegative(),
  jobsProcessed: z.number().int().nonnegative(),
  jobsSkippedIncomplete: z.number().int().nonnegative(),
  skippedIncompleteJobs: z.array(skippedIncompleteJobSchema),
  jobsFailed: z.number().int().nonnegative(),
  failedJobs: z.array(failedJobSchema),
  jobsNonSuccess: z.number().int().nonnegative(),
  jobsSuccessRate: z.number().min(0).max(1),
  jobsNonSuccessRate: z.number().min(0).max(1),
  jobsSkippedIncompleteRate: z.number().min(0).max(1),
  jobsFailedRate: z.number().min(0).max(1),
  mongoWritesStructured: z.number().int().nonnegative(),
  llmCleanerStats: llmRunStatsSchema,
  llmExtractorStats: llmRunStatsSchema,
  llmTotalStats: llmRunStatsSchema,
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalEstimatedCostUsd: z.number().nonnegative(),
  avgTimeToProcssSeconds: z.number().nonnegative(),
  p50TimeToProcssSeconds: z.number().nonnegative(),
  p95TimeToProcssSeconds: z.number().nonnegative(),
  avgLlmCleanerCallDurationSeconds: z.number().nonnegative(),
  avgLlmExtractorCallDurationSeconds: z.number().nonnegative(),
  avgLlmTotalCallDurationSeconds: z.number().nonnegative(),
  p50LlmTotalCallDurationSeconds: z.number().nonnegative(),
  p95LlmTotalCallDurationSeconds: z.number().nonnegative(),
});

type IngestionRunSummary = z.infer<typeof ingestionRunSummarySchema>;

export const envs: EnvSchema = loadEnv(envSchema, import.meta.url);
export const logger = createLogger(envs.LOG_LEVEL, { pretty: envs.LOG_PRETTY });
const llmExtractorPromptName = envs.LLM_EXTRACTOR_PROMPT_NAME;
const llmCleanerPromptName = envs.LLM_CLEANER_PROMPT_NAME;

export const appRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const inputRootDir = path.resolve(appRootDir, envs.INPUT_ROOT_DIR);
export const outputJsonPath = path.resolve(appRootDir, envs.OUTPUT_JSON_PATH);

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
  const buildLlmNodeStats = (input: {
    callDurations: number[];
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
  }) => ({
    calls: input.callDurations.length,
    avgCallDurationSeconds:
      input.callDurations.length === 0
        ? 0
        : input.callDurations.reduce((sum, value) => sum + value, 0) / input.callDurations.length,
    p50CallDurationSeconds: percentile(input.callDurations, 0.5),
    p95CallDurationSeconds: percentile(input.callDurations, 0.95),
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    inputCostUsd: input.inputCostUsd,
    outputCostUsd: input.outputCostUsd,
    totalCostUsd: input.totalCostUsd,
  });

  if (parsed.length === 0) {
    return {
      avgTimeToProcssSeconds: 0,
      p50TimeToProcssSeconds: 0,
      p95TimeToProcssSeconds: 0,
      avgLlmCleanerCallDurationSeconds: 0,
      avgLlmExtractorCallDurationSeconds: 0,
      avgLlmTotalCallDurationSeconds: 0,
      p50LlmTotalCallDurationSeconds: 0,
      p95LlmTotalCallDurationSeconds: 0,
      llmCleanerCalls: 0,
      llmExtractorCalls: 0,
      llmTotalCalls: 0,
      llmCleanerInputTokens: 0,
      llmCleanerOutputTokens: 0,
      llmCleanerTotalTokens: 0,
      llmCleanerInputCostUsd: 0,
      llmCleanerOutputCostUsd: 0,
      llmCleanerTotalCostUsd: 0,
      llmExtractorInputTokens: 0,
      llmExtractorOutputTokens: 0,
      llmExtractorTotalTokens: 0,
      llmExtractorInputCostUsd: 0,
      llmExtractorOutputCostUsd: 0,
      llmExtractorTotalCostUsd: 0,
      llmTotalInputTokens: 0,
      llmTotalOutputTokens: 0,
      llmTotalTokens: 0,
      llmTotalInputCostUsd: 0,
      llmTotalOutputCostUsd: 0,
      llmTotalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalEstimatedCostUsd: 0,
    };
  }

  const timeToProcssValues = parsed.map((item) => item.ingestion.timeToProcssSeconds);
  const llmCleanerStats = buildLlmNodeStats({
    callDurations: parsed.map((item) => item.ingestion.llmCleanerCallDurationSeconds),
    inputTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmCleanerInputTokens, 0),
    outputTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmCleanerOutputTokens, 0),
    totalTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmCleanerTotalTokens, 0),
    inputCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmCleanerInputCostUsd, 0),
    outputCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmCleanerOutputCostUsd, 0),
    totalCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmCleanerTotalCostUsd, 0),
  });
  const llmExtractorStats = buildLlmNodeStats({
    callDurations: parsed.map((item) => item.ingestion.llmExtractorCallDurationSeconds),
    inputTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmExtractorInputTokens, 0),
    outputTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmExtractorOutputTokens, 0),
    totalTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmExtractorTotalTokens, 0),
    inputCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmExtractorInputCostUsd, 0),
    outputCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmExtractorOutputCostUsd, 0),
    totalCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmExtractorTotalCostUsd, 0),
  });
  const llmTotalStats = buildLlmNodeStats({
    callDurations: parsed.map((item) => item.ingestion.llmTotalCallDurationSeconds),
    inputTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmTotalInputTokens, 0),
    outputTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmTotalOutputTokens, 0),
    totalTokens: parsed.reduce((sum, item) => sum + item.ingestion.llmTotalTokens, 0),
    inputCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmTotalInputCostUsd, 0),
    outputCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmTotalOutputCostUsd, 0),
    totalCostUsd: parsed.reduce((sum, item) => sum + item.ingestion.llmTotalCostUsd, 0),
  });

  return {
    avgTimeToProcssSeconds:
      timeToProcssValues.reduce((sum, value) => sum + value, 0) / timeToProcssValues.length,
    p50TimeToProcssSeconds: percentile(timeToProcssValues, 0.5),
    p95TimeToProcssSeconds: percentile(timeToProcssValues, 0.95),
    avgLlmCleanerCallDurationSeconds: llmCleanerStats.avgCallDurationSeconds,
    avgLlmExtractorCallDurationSeconds: llmExtractorStats.avgCallDurationSeconds,
    avgLlmTotalCallDurationSeconds: llmTotalStats.avgCallDurationSeconds,
    p50LlmTotalCallDurationSeconds: llmTotalStats.p50CallDurationSeconds,
    p95LlmTotalCallDurationSeconds: llmTotalStats.p95CallDurationSeconds,
    llmCleanerCalls: llmCleanerStats.calls,
    llmExtractorCalls: llmExtractorStats.calls,
    llmTotalCalls: llmTotalStats.calls,
    llmCleanerInputTokens: llmCleanerStats.inputTokens,
    llmCleanerOutputTokens: llmCleanerStats.outputTokens,
    llmCleanerTotalTokens: llmCleanerStats.totalTokens,
    llmCleanerInputCostUsd: llmCleanerStats.inputCostUsd,
    llmCleanerOutputCostUsd: llmCleanerStats.outputCostUsd,
    llmCleanerTotalCostUsd: llmCleanerStats.totalCostUsd,
    llmExtractorInputTokens: llmExtractorStats.inputTokens,
    llmExtractorOutputTokens: llmExtractorStats.outputTokens,
    llmExtractorTotalTokens: llmExtractorStats.totalTokens,
    llmExtractorInputCostUsd: llmExtractorStats.inputCostUsd,
    llmExtractorOutputCostUsd: llmExtractorStats.outputCostUsd,
    llmExtractorTotalCostUsd: llmExtractorStats.totalCostUsd,
    llmTotalInputTokens: llmTotalStats.inputTokens,
    llmTotalOutputTokens: llmTotalStats.outputTokens,
    llmTotalTokens: llmTotalStats.totalTokens,
    llmTotalInputCostUsd: llmTotalStats.inputCostUsd,
    llmTotalOutputCostUsd: llmTotalStats.outputCostUsd,
    llmTotalCostUsd: llmTotalStats.totalCostUsd,
    totalInputTokens: llmTotalStats.inputTokens,
    totalOutputTokens: llmTotalStats.outputTokens,
    totalTokens: llmTotalStats.totalTokens,
    totalEstimatedCostUsd: llmTotalStats.totalCostUsd,
  };
};

const buildRunSummaryDocument = (input: {
  runId: string;
  startedAtIso: string;
  completedAtIso: string;
  runDurationSeconds: number;
  stats: ParseRunStats;
  structuredParsed: UnifiedJobAd[];
  skippedIncomplete: number;
  skippedIncompleteJobs: SkippedIncompleteJob[];
  failed: number;
  failedJobs: FailedJob[];
  mongoWritesStructured: number;
  workerCount: number;
  sampleSize: number | null;
}): IngestionRunSummary =>
  (() => {
    const jobsTotal = input.structuredParsed.length + input.skippedIncomplete + input.failed;
    const jobsNonSuccess = input.skippedIncomplete + input.failed;
    const rate = (value: number): number => (jobsTotal === 0 ? 0 : value / jobsTotal);

    return ingestionRunSummarySchema.parse({
      id: input.runId,
      runId: input.runId,
      startedAt: input.startedAtIso,
      completedAt: input.completedAtIso,
      runDurationSeconds: input.runDurationSeconds,
      parserVersion: envs.PARSER_VERSION,
      extractorModel: envs.GEMINI_MODEL,
      llmExtractorPromptName,
      llmCleanerPromptName,
      sampleSize: input.sampleSize ?? 'all',
      concurrency: input.workerCount,
      jobsTotal,
      jobsProcessed: input.structuredParsed.length,
      jobsSkippedIncomplete: input.skippedIncomplete,
      skippedIncompleteJobs: input.skippedIncompleteJobs,
      jobsFailed: input.failed,
      failedJobs: input.failedJobs,
      jobsNonSuccess,
      jobsSuccessRate: rate(input.structuredParsed.length),
      jobsNonSuccessRate: rate(jobsNonSuccess),
      jobsSkippedIncompleteRate: rate(input.skippedIncomplete),
      jobsFailedRate: rate(input.failed),
      mongoWritesStructured: input.mongoWritesStructured,
      llmCleanerStats: {
        calls: input.stats.llmCleanerCalls,
        avgCallDurationSeconds: input.stats.avgLlmCleanerCallDurationSeconds,
        p50CallDurationSeconds: percentile(
          input.structuredParsed.map((item) => item.ingestion.llmCleanerCallDurationSeconds),
          0.5,
        ),
        p95CallDurationSeconds: percentile(
          input.structuredParsed.map((item) => item.ingestion.llmCleanerCallDurationSeconds),
          0.95,
        ),
        inputTokens: input.stats.llmCleanerInputTokens,
        outputTokens: input.stats.llmCleanerOutputTokens,
        totalTokens: input.stats.llmCleanerTotalTokens,
        inputCostUsd: input.stats.llmCleanerInputCostUsd,
        outputCostUsd: input.stats.llmCleanerOutputCostUsd,
        totalCostUsd: input.stats.llmCleanerTotalCostUsd,
      },
      llmExtractorStats: {
        calls: input.stats.llmExtractorCalls,
        avgCallDurationSeconds: input.stats.avgLlmExtractorCallDurationSeconds,
        p50CallDurationSeconds: percentile(
          input.structuredParsed.map((item) => item.ingestion.llmExtractorCallDurationSeconds),
          0.5,
        ),
        p95CallDurationSeconds: percentile(
          input.structuredParsed.map((item) => item.ingestion.llmExtractorCallDurationSeconds),
          0.95,
        ),
        inputTokens: input.stats.llmExtractorInputTokens,
        outputTokens: input.stats.llmExtractorOutputTokens,
        totalTokens: input.stats.llmExtractorTotalTokens,
        inputCostUsd: input.stats.llmExtractorInputCostUsd,
        outputCostUsd: input.stats.llmExtractorOutputCostUsd,
        totalCostUsd: input.stats.llmExtractorTotalCostUsd,
      },
      llmTotalStats: {
        calls: input.stats.llmTotalCalls,
        avgCallDurationSeconds: input.stats.avgLlmTotalCallDurationSeconds,
        p50CallDurationSeconds: input.stats.p50LlmTotalCallDurationSeconds,
        p95CallDurationSeconds: input.stats.p95LlmTotalCallDurationSeconds,
        inputTokens: input.stats.llmTotalInputTokens,
        outputTokens: input.stats.llmTotalOutputTokens,
        totalTokens: input.stats.llmTotalTokens,
        inputCostUsd: input.stats.llmTotalInputCostUsd,
        outputCostUsd: input.stats.llmTotalOutputCostUsd,
        totalCostUsd: input.stats.llmTotalCostUsd,
      },
      totalInputTokens: input.stats.totalInputTokens,
      totalOutputTokens: input.stats.totalOutputTokens,
      totalTokens: input.stats.totalTokens,
      totalEstimatedCostUsd: input.stats.totalEstimatedCostUsd,
      avgTimeToProcssSeconds: input.stats.avgTimeToProcssSeconds,
      p50TimeToProcssSeconds: input.stats.p50TimeToProcssSeconds,
      p95TimeToProcssSeconds: input.stats.p95TimeToProcssSeconds,
      avgLlmCleanerCallDurationSeconds: input.stats.avgLlmCleanerCallDurationSeconds,
      avgLlmExtractorCallDurationSeconds: input.stats.avgLlmExtractorCallDurationSeconds,
      avgLlmTotalCallDurationSeconds: input.stats.avgLlmTotalCallDurationSeconds,
      p50LlmTotalCallDurationSeconds: input.stats.p50LlmTotalCallDurationSeconds,
      p95LlmTotalCallDurationSeconds: input.stats.p95LlmTotalCallDurationSeconds,
    });
  })();

type ParseRecordsOptions = {
  runId: string;
  crawlRunId: string | null;
  inputRootDir: string;
  recordsDirName: string;
  sampleSize: number | null;
};

const parseRecords = async (
  options: ParseRecordsOptions,
): Promise<{
  structuredParsed: UnifiedJobAd[];
  failed: number;
  skippedIncomplete: number;
  skippedIncompleteJobs: SkippedIncompleteJob[];
  failedJobs: FailedJob[];
  stats: ParseRunStats;
  workerCount: number;
}> => {
  const {
    runId,
    crawlRunId,
    inputRootDir: recordsInputRootDir,
    recordsDirName,
    sampleSize,
  } = options;
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
    inputRootDir: recordsInputRootDir,
    recordsDirName,
    sampleSize,
  });

  const extractor = new GeminiJobDetailExtractor({
    langsmithApiKey: envs.LANGSMITH_API_KEY,
    langsmithPromptName: llmExtractorPromptName,
    apiKey: envs.GEMINI_API_KEY,
    model: envs.GEMINI_MODEL,
    temperature: envs.GEMINI_TEMPERATURE,
    thinkingLevel: envs.GEMINI_THINKING_LEVEL,
    inputPriceUsdPerMillionTokens: envs.GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS,
    outputPriceUsdPerMillionTokens: envs.GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS,
    logger,
  });
  const textCleaner = new GeminiDetailTextCleaner({
    langsmithApiKey: envs.LANGSMITH_API_KEY,
    langsmithPromptName: llmCleanerPromptName,
    apiKey: envs.GEMINI_API_KEY,
    model: envs.GEMINI_MODEL,
    temperature: envs.GEMINI_TEMPERATURE,
    thinkingLevel: envs.GEMINI_THINKING_LEVEL,
    inputPriceUsdPerMillionTokens: envs.GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS,
    outputPriceUsdPerMillionTokens: envs.GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS,
    logger,
  });

  const parserGraph = new JobParsingGraph({
    textCleaner,
    extractor,
    minRelevantTextChars: envs.DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS,
    logTextTransformContent: envs.LOG_TEXT_TRANSFORM_CONTENT,
    textTransformPreviewChars: envs.LOG_TEXT_TRANSFORM_PREVIEW_CHARS,
    parserVersion: envs.PARSER_VERSION,
    runId,
    crawlRunId,
    logger,
  });

  const workerCount = Math.max(1, Math.min(envs.INGESTION_CONCURRENCY, inputRecords.length));
  const parsedByIndex: Array<UnifiedJobAd | null> = new Array(inputRecords.length).fill(null);
  let failed = 0;
  let skippedIncomplete = 0;
  const skippedIncompleteJobs: SkippedIncompleteJob[] = [];
  const failedJobs: FailedJob[] = [];
  let nextIndex = 0;

  logger.info(
    {
      inputRecords: inputRecords.length,
      sampleSize: sampleSize ?? 'all',
      model: envs.GEMINI_MODEL,
      llmExtractorPromptName,
      llmCleanerPromptName,
      concurrency: workerCount,
      minRelevantTextChars: envs.DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS,
      logTextTransformContent: envs.LOG_TEXT_TRANSFORM_CONTENT,
      textTransformPreviewChars: envs.LOG_TEXT_TRANSFORM_PREVIEW_CHARS,
      runId,
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
          skippedIncompleteJobs.push(
            skippedIncompleteJobSchema.parse({
              sourceId: inputRecord.listingRecord.sourceId,
              source: inputRecord.listingRecord.source,
              datasetFileName: inputRecord.datasetFileName,
              datasetRecordIndex: inputRecord.datasetRecordIndex,
              detailHtmlPath: inputRecord.detailHtmlPath,
              htmlDetailPageKey: inputRecord.listingRecord.htmlDetailPageKey,
              reason: error.message,
              qualitySignals: error.qualitySignals,
              listing: inputRecord.listingRecord,
            }),
          );
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
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        failedJobs.push(
          failedJobSchema.parse({
            sourceId: inputRecord.listingRecord.sourceId,
            source: inputRecord.listingRecord.source,
            datasetFileName: inputRecord.datasetFileName,
            datasetRecordIndex: inputRecord.datasetRecordIndex,
            detailHtmlPath: inputRecord.detailHtmlPath,
            htmlDetailPageKey: inputRecord.listingRecord.htmlDetailPageKey,
            errorName: normalizedError.name,
            errorMessage: normalizedError.message,
            listing: inputRecord.listingRecord,
          }),
        );
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

  return {
    structuredParsed,
    failed,
    skippedIncomplete,
    skippedIncompleteJobs,
    failedJobs,
    stats,
    workerCount,
  };
};

export type IngestionRunStatus = 'succeeded' | 'completed_with_errors';

export type RunIngestionWorkflowOptions = {
  runId?: string;
  crawlRunId?: string | null;
  inputRootDirOverride?: string;
  recordsDirNameOverride?: string;
  sampleSizeOverride?: number | null;
  outputJsonPathOverride?: string;
};

export type RunIngestionWorkflowResult = {
  runId: string;
  crawlRunId: string | null;
  status: IngestionRunStatus;
  runSummaryDocument: IngestionRunSummary;
  structuredParsed: UnifiedJobAd[];
  failed: number;
  skippedIncomplete: number;
  skippedIncompleteJobs: SkippedIncompleteJob[];
  failedJobs: FailedJob[];
  stats: ParseRunStats;
  workerCount: number;
  outputJsonPath: string;
  mongoWritesStructured: number;
  mongoWritesRunSummary: number;
};

const inferCrawlRunIdFromInputRootDir = (resolvedInputRootDir: string): string | null => {
  const normalizedInputRootDir = path.resolve(resolvedInputRootDir);
  const parentDir = path.basename(path.dirname(normalizedInputRootDir));
  const currentDir = path.basename(normalizedInputRootDir);

  if (parentDir === envs.CRAWL_RUNS_SUBDIR && currentDir.length > 0) {
    return currentDir;
  }

  return null;
};

export const runIngestionWorkflow = async (
  options: RunIngestionWorkflowOptions = {},
): Promise<RunIngestionWorkflowResult> => {
  const runId = options.runId ?? randomUUID();
  const runStartedAtIso = new Date().toISOString();
  const resolvedInputRootDir = options.inputRootDirOverride
    ? path.resolve(options.inputRootDirOverride)
    : inputRootDir;
  const resolvedOutputJsonPath = options.outputJsonPathOverride
    ? path.resolve(options.outputJsonPathOverride)
    : outputJsonPath;
  const resolvedRecordsDirName = options.recordsDirNameOverride ?? envs.INPUT_RECORDS_DIR_NAME;
  const resolvedSampleSize =
    options.sampleSizeOverride !== undefined
      ? options.sampleSizeOverride
      : envs.INGESTION_SAMPLE_SIZE;
  const resolvedCrawlRunId =
    options.crawlRunId !== undefined
      ? options.crawlRunId
      : inferCrawlRunIdFromInputRootDir(resolvedInputRootDir);

  logger.info(
    {
      runId,
      crawlRunId: resolvedCrawlRunId,
      inputRootDir: resolvedInputRootDir,
      outputJsonPath: resolvedOutputJsonPath,
      enableMongoWrite: envs.ENABLE_MONGO_WRITE,
      mongoDbName: envs.MONGODB_DB_NAME,
      mongoCollectionStructured: envs.MONGODB_JOBS_COLLECTION,
      mongoCollectionCrawlJobs: envs.MONGODB_CRAWL_JOBS_COLLECTION,
      mongoCollectionRunSummaries: envs.MONGODB_RUN_SUMMARIES_COLLECTION,
      model: envs.GEMINI_MODEL,
      llmExtractorPromptName,
      llmCleanerPromptName,
      minRelevantTextChars: envs.DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS,
      logLevel: envs.LOG_LEVEL,
      logPretty: envs.LOG_PRETTY,
    },
    'Run configuration',
  );

  const startedAt = performance.now();
  const {
    structuredParsed,
    failed,
    skippedIncomplete,
    skippedIncompleteJobs,
    failedJobs,
    stats,
    workerCount,
  } = await parseRecords({
    runId,
    crawlRunId: resolvedCrawlRunId,
    inputRootDir: resolvedInputRootDir,
    recordsDirName: resolvedRecordsDirName,
    sampleSize: resolvedSampleSize,
  });

  await writeOutputToFile(
    resolvedOutputJsonPath,
    structuredParsed,
    logger.child({ component: 'FileRepository' }),
  );

  let mongoWrittenStructured = 0;
  let mongoWrittenRunSummary = 0;
  let mongoPrunedCrawlStateNonSuccess = 0;
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

    mongoPrunedCrawlStateNonSuccess = await pruneCrawlStateByDocIds(
      {
        mongoUri: envs.MONGODB_URI,
        dbName: envs.MONGODB_DB_NAME,
        crawlJobsCollectionName: envs.MONGODB_CRAWL_JOBS_COLLECTION,
      },
      [
        ...skippedIncompleteJobs.map((job) => `${job.source}:${job.sourceId}`),
        ...failedJobs.map((job) => `${job.source}:${job.sourceId}`),
      ],
      logger.child({ component: 'MongoRepository', outputType: 'crawl-state-prune' }),
    );
  }

  const runCompletedAtIso = new Date().toISOString();
  const runDurationSeconds = (performance.now() - startedAt) / 1_000;
  const runSummaryDocument = buildRunSummaryDocument({
    runId,
    startedAtIso: runStartedAtIso,
    completedAtIso: runCompletedAtIso,
    runDurationSeconds,
    stats,
    structuredParsed,
    skippedIncomplete,
    skippedIncompleteJobs,
    failed,
    failedJobs,
    mongoWritesStructured: mongoWrittenStructured,
    workerCount,
    sampleSize: resolvedSampleSize,
  });

  if (envs.ENABLE_MONGO_WRITE && envs.MONGODB_URI) {
    mongoWrittenRunSummary = await writeOutputToMongo(
      {
        mongoUri: envs.MONGODB_URI,
        dbName: envs.MONGODB_DB_NAME,
        collectionName: envs.MONGODB_RUN_SUMMARIES_COLLECTION,
      },
      [runSummaryDocument],
      logger.child({ component: 'MongoRepository', outputType: 'run-summary' }),
    );
  }

  logger.info(
    {
      runId,
      parsedStructured: structuredParsed.length,
      failed,
      skippedIncomplete,
      outputJsonPath: resolvedOutputJsonPath,
      mongoWritesStructured: mongoWrittenStructured,
      mongoWritesRunSummary: mongoWrittenRunSummary,
      mongoPrunedCrawlStateNonSuccess,
      runDurationSeconds,
    },
    'Completed parse run',
  );
  logger.info(
    {
      runId,
      avgTimeToProcssSeconds: stats.avgTimeToProcssSeconds,
      p50TimeToProcssSeconds: stats.p50TimeToProcssSeconds,
      p95TimeToProcssSeconds: stats.p95TimeToProcssSeconds,
      avgLlmCleanerCallDurationSeconds: stats.avgLlmCleanerCallDurationSeconds,
      avgLlmExtractorCallDurationSeconds: stats.avgLlmExtractorCallDurationSeconds,
      avgLlmTotalCallDurationSeconds: stats.avgLlmTotalCallDurationSeconds,
      p50LlmTotalCallDurationSeconds: stats.p50LlmTotalCallDurationSeconds,
      p95LlmTotalCallDurationSeconds: stats.p95LlmTotalCallDurationSeconds,
      llmCleanerTotalTokens: stats.llmCleanerTotalTokens,
      llmExtractorTotalTokens: stats.llmExtractorTotalTokens,
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens: stats.totalOutputTokens,
      totalTokens: stats.totalTokens,
      totalEstimatedCostUsd: stats.totalEstimatedCostUsd,
    },
    'Parse run stats',
  );
  logger.info(
    {
      runId,
      jobsProcessed: structuredParsed.length,
      jobsTotal: runSummaryDocument.jobsTotal,
      jobsSkippedIncomplete: skippedIncomplete,
      jobsFailed: failed,
      jobsNonSuccess: runSummaryDocument.jobsNonSuccess,
      jobsSuccessRate: runSummaryDocument.jobsSuccessRate,
      jobsNonSuccessRate: runSummaryDocument.jobsNonSuccessRate,
      totalTokensUsed: stats.totalTokens,
      totalEstimatedCostUsd: stats.totalEstimatedCostUsd,
      mongoPrunedCrawlStateNonSuccess,
      runDurationSeconds,
    },
    'Parse run summary',
  );

  return {
    runId,
    crawlRunId: resolvedCrawlRunId,
    status: failed > 0 || skippedIncomplete > 0 ? 'completed_with_errors' : 'succeeded',
    runSummaryDocument,
    structuredParsed,
    failed,
    skippedIncomplete,
    skippedIncompleteJobs,
    failedJobs,
    stats,
    workerCount,
    outputJsonPath: resolvedOutputJsonPath,
    mongoWritesStructured: mongoWrittenStructured,
    mongoWritesRunSummary: mongoWrittenRunSummary,
  };
};

async function main(): Promise<void> {
  await runIngestionWorkflow();
}

const isEntrypoint = (importMetaUrl: string): boolean => {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }

  return importMetaUrl === pathToFileURL(argvPath).href;
};

if (isEntrypoint(import.meta.url)) {
  void main().catch((error) => {
    logger.fatal({ err: error }, 'Unhandled fatal error in ingestion runner');
    process.exitCode = 1;
  });
}
