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
- Normalize employmentTypes to one or more of:
  full-time, part-time, contract, freelance, internship, temporary, other.
- Normalize workModes to one or more of:
  onsite, hybrid, remote, unknown.
- For salary use numbers only when explicitly available; otherwise keep numbers as null and fill rawText when possible.
`;

const buildPrompt = (listingRecord: SourceListingRecord, detailText: string): string => {
  const listingContext = JSON.stringify(listingRecord, null, 2);

  return `${parserInstructions}

Listing JSON context:
${listingContext}

Detail page text:
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
  ): Promise<ExtractionResult> {
    const prompt = buildPrompt(listingRecord, detailPageText);
    this.logger.debug(
      {
        sourceId: listingRecord.sourceId,
        source: listingRecord.source,
        detailTextChars: detailPageText.length,
        model: this.modelName,
      },
      'Starting LLM detail extraction',
    );

    const startedAt = performance.now();
    const response = await this.structuredModel.invoke(prompt);
    const llmCallDurationSeconds = (performance.now() - startedAt) / 1_000;

    const detail = extractedJobDetailSchema.parse(response.parsed);
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
