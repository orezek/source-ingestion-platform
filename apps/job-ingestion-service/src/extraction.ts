import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

import type { AppLogger } from './logger.js';
import {
  extractedJobDetailSchema,
  type ExtractedJobDetail,
  type SourceListingRecord,
} from './schema.js';

const parserInstructions = `You extract job ad detail information for a unified schema.

Rules:
- Input detail pages may be rendered with jobs.cz template OR arbitrary client/company templates.
- Extract only what is supported by evidence from the provided listing context and detail page text.
- Do not invent values. If unknown, use null for scalar fields and [] for arrays.
- Keep Czech content in Czech. Keep English content in English.
- For detail.jobDescription:
  - Use the provided "jobDescriptionSourceText" as the primary source whenever it is available.
  - Preserve source wording. Do not paraphrase, summarize, or translate.
  - Keep only role-relevant posting content (scope, responsibilities, requirements, conditions, benefits, process).
  - Exclude navigation, legal, cookie, and unrelated UI text.
- For detail.summary:
  - Write a rich analytical summary in the same language as the ad.
  - Target 4-8 sentences and at least ~450 characters when enough evidence is available.
  - Cover role scope, key responsibilities, required skills, seniority, location/work mode, and compensation when present.
- Normalize employmentTypes to one or more of:
  full-time, part-time, contract, freelance, internship, temporary, other.
- Normalize workModes to one or more of:
  onsite, hybrid, remote, unknown.
- For salary use numbers only when explicitly available; otherwise keep numbers as null and fill rawText when possible.
`;

const buildPrompt = (
  listingRecord: SourceListingRecord,
  detailText: string,
  jobDescriptionSourceText: string | null,
): string => {
  const listingContext = JSON.stringify(listingRecord, null, 2);
  const descriptionSource = jobDescriptionSourceText?.trim().length
    ? jobDescriptionSourceText
    : '[not available]';

  return `${parserInstructions}

Listing JSON context:
${listingContext}

jobDescriptionSourceText (pre-extracted from detail page; preserve wording in detail.jobDescription):
${descriptionSource}

Detail page text (full cleaned body):
${detailText}`;
};

type ThinkingLevel = 'THINKING_LEVEL_UNSPECIFIED' | 'LOW' | 'MEDIUM' | 'HIGH';

type UsageMetadata = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
};

type TokenUsageMetadata = {
  promptTokens?: unknown;
  completionTokens?: unknown;
  totalTokens?: unknown;
};

type RawLlmMessage = {
  usage_metadata?: UsageMetadata;
  response_metadata?: {
    tokenUsage?: TokenUsageMetadata;
  };
};

type StructuredInvokeResult = {
  raw?: RawLlmMessage;
  parsed?: unknown;
};

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  return Math.trunc(value);
};

const resolveTokenUsage = (raw: RawLlmMessage | undefined) => {
  const usageMetadata = raw?.usage_metadata;
  const responseTokenUsage = raw?.response_metadata?.tokenUsage;

  const inputTokens = toNonNegativeInt(
    usageMetadata?.input_tokens ?? responseTokenUsage?.promptTokens,
  );
  const outputTokens = toNonNegativeInt(
    usageMetadata?.output_tokens ?? responseTokenUsage?.completionTokens,
  );
  const totalTokens = toNonNegativeInt(
    usageMetadata?.total_tokens ?? responseTokenUsage?.totalTokens ?? inputTokens + outputTokens,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
};

const tokensToUsd = (tokens: number, usdPerMillionTokens: number): number =>
  (tokens / 1_000_000) * usdPerMillionTokens;

const minimumSummaryChars = 260;
const minimumJobDescriptionChars = 120;
const fallbackSummaryMaxChars = 1_400;

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const trimToWholeWord = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }

  const sliced = value.slice(0, maxChars);
  const lastSpaceIndex = sliced.lastIndexOf(' ');
  if (lastSpaceIndex <= 0) {
    return sliced.trim();
  }

  return sliced.slice(0, lastSpaceIndex).trim();
};

const normalizeJobDescription = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value
    .split('\n')
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

  return normalized.length >= minimumJobDescriptionChars ? normalized : null;
};

const buildFallbackSummary = (
  listingRecord: SourceListingRecord,
  summary: string | null,
  jobDescription: string | null,
): string | null => {
  const normalizedSummary = summary ? compactWhitespace(summary) : null;
  if (normalizedSummary && normalizedSummary.length >= minimumSummaryChars) {
    return normalizedSummary;
  }

  if (!jobDescription) {
    return normalizedSummary;
  }

  const normalizedDescription = compactWhitespace(jobDescription.replace(/\n+/g, ' '));
  if (normalizedDescription.length === 0) {
    return normalizedSummary;
  }

  const heading = [listingRecord.jobTitle, listingRecord.companyName, listingRecord.location]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' | ');
  const descriptionSnippet = trimToWholeWord(normalizedDescription, fallbackSummaryMaxChars);

  if (heading.length === 0) {
    return descriptionSnippet;
  }

  return `${heading}. ${descriptionSnippet}`.trim();
};

export type GeminiExtractorConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  thinkingLevel: ThinkingLevel | null;
  inputPriceUsdPerMillionTokens: number;
  outputPriceUsdPerMillionTokens: number;
  logger: AppLogger;
};

export type ExtractionTelemetry = {
  llmCallDurationSeconds: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmTotalTokens: number;
  llmInputCostUsd: number;
  llmOutputCostUsd: number;
  llmTotalCostUsd: number;
};

export type ExtractionResult = {
  detail: ExtractedJobDetail;
  telemetry: ExtractionTelemetry;
};

export class GeminiJobDetailExtractor {
  private readonly modelName: string;

  private readonly inputPriceUsdPerMillionTokens: number;

  private readonly outputPriceUsdPerMillionTokens: number;

  private readonly logger: AppLogger;

  private readonly structuredModel: {
    invoke(input: string): Promise<StructuredInvokeResult>;
  };

  constructor(config: GeminiExtractorConfig) {
    this.modelName = config.model;
    this.inputPriceUsdPerMillionTokens = config.inputPriceUsdPerMillionTokens;
    this.outputPriceUsdPerMillionTokens = config.outputPriceUsdPerMillionTokens;
    this.logger = config.logger.child({ component: 'GeminiJobDetailExtractor' });

    const model = new ChatGoogleGenerativeAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxRetries: 2,
      thinkingConfig: config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : undefined,
    });

    this.structuredModel = model.withStructuredOutput(extractedJobDetailSchema, {
      name: 'extracted_job_detail',
      includeRaw: true,
    });
  }

  getModelName(): string {
    return this.modelName;
  }

  async extractFromDetailPage(
    listingRecord: SourceListingRecord,
    detailPageText: string,
    jobDescriptionSourceText: string | null,
  ): Promise<ExtractionResult> {
    const prompt = buildPrompt(listingRecord, detailPageText, jobDescriptionSourceText);
    this.logger.debug(
      {
        sourceId: listingRecord.sourceId,
        source: listingRecord.source,
        detailTextChars: detailPageText.length,
        jobDescriptionSourceTextChars: jobDescriptionSourceText?.length ?? 0,
        model: this.modelName,
      },
      'Starting LLM detail extraction',
    );

    const startedAt = performance.now();
    const response = await this.structuredModel.invoke(prompt);
    const llmCallDurationSeconds = (performance.now() - startedAt) / 1_000;

    const parsedDetail = extractedJobDetailSchema.parse(response.parsed);
    const resolvedJobDescription =
      normalizeJobDescription(jobDescriptionSourceText) ?? parsedDetail.jobDescription;
    const resolvedSummary = buildFallbackSummary(
      listingRecord,
      parsedDetail.summary,
      resolvedJobDescription,
    );
    const detail = extractedJobDetailSchema.parse({
      ...parsedDetail,
      summary: resolvedSummary,
      jobDescription: resolvedJobDescription,
    });
    const usage = resolveTokenUsage(response.raw);

    const llmInputCostUsd = tokensToUsd(usage.inputTokens, this.inputPriceUsdPerMillionTokens);
    const llmOutputCostUsd = tokensToUsd(usage.outputTokens, this.outputPriceUsdPerMillionTokens);
    this.logger.debug(
      {
        sourceId: listingRecord.sourceId,
        llmCallDurationSeconds,
        llmInputTokens: usage.inputTokens,
        llmOutputTokens: usage.outputTokens,
        llmTotalTokens: usage.totalTokens,
        summaryChars: detail.summary?.length ?? 0,
        jobDescriptionChars: detail.jobDescription?.length ?? 0,
        llmTotalCostUsd: llmInputCostUsd + llmOutputCostUsd,
      },
      'Completed LLM detail extraction',
    );

    return {
      detail,
      telemetry: {
        llmCallDurationSeconds,
        llmInputTokens: usage.inputTokens,
        llmOutputTokens: usage.outputTokens,
        llmTotalTokens: usage.totalTokens,
        llmInputCostUsd,
        llmOutputCostUsd,
        llmTotalCostUsd: llmInputCostUsd + llmOutputCostUsd,
      },
    };
  }
}
