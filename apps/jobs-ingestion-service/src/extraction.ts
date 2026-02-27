import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import * as hub from 'langchain/hub/node';

import type { AppLogger } from './logger.js';
import {
  extractedJobDetailSchema,
  type ExtractedJobDetail,
  normalizedExtractedJobDetailSchema,
  type SourceListingRecord,
} from './schema.js';

const modelOutputJobDetailSchema = extractedJobDetailSchema;

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
  content?: unknown;
  usage_metadata?: UsageMetadata;
  response_metadata?: {
    tokenUsage?: TokenUsageMetadata;
  };
};

type StructuredInvokeResult = {
  raw?: RawLlmMessage;
  parsed?: unknown;
};

type HubPromptChain = {
  invoke(input: Record<string, string>): Promise<StructuredInvokeResult>;
};

type HubPromptRunnable = {
  inputVariables?: string[];
  invoke(input: Record<string, string>): Promise<unknown>;
  pipe(input: unknown): HubPromptChain;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isHubPromptRunnable = (value: unknown): value is HubPromptRunnable =>
  isObjectRecord(value) && typeof value.pipe === 'function';

type StructuredPromptContext = {
  detailText: string;
  listingJson: string;
};

const buildStructuredPromptContext = (
  listingRecord: SourceListingRecord,
  detailText: string,
): StructuredPromptContext => {
  const listingJson = JSON.stringify(listingRecord, null, 2);

  return {
    detailText,
    listingJson,
  };
};

const buildHubPromptInput = (
  listingRecord: SourceListingRecord,
  detailText: string,
  inputVariables: string[] | undefined,
): Record<string, string> => {
  const promptContext = buildStructuredPromptContext(listingRecord, detailText);
  const exactPromptInputs = {
    jobAdDetailText: promptContext.detailText,
    listingJson: promptContext.listingJson,
  } satisfies Record<string, string>;

  if (inputVariables && inputVariables.length > 0) {
    const unsupportedVariables = inputVariables.filter(
      (variable) => !(variable in exactPromptInputs),
    );
    if (unsupportedVariables.length > 0) {
      throw new Error(
        `Unsupported LangSmith extractDetail prompt input variables: ${unsupportedVariables.join(', ')}. Supported variables are: ${Object.keys(exactPromptInputs).join(', ')}`,
      );
    }

    return Object.fromEntries(
      inputVariables.map((variable) => [
        variable,
        exactPromptInputs[variable as keyof typeof exactPromptInputs],
      ]),
    );
  }

  return {
    jobAdDetailText: promptContext.detailText,
  };
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
  langsmithApiKey: string;
  langsmithPromptName: string;
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
  private readonly promptName: string;

  private readonly modelName: string;

  private readonly inputPriceUsdPerMillionTokens: number;

  private readonly outputPriceUsdPerMillionTokens: number;

  private readonly logger: AppLogger;

  private readonly structuredModel: {
    invoke(input: unknown): Promise<StructuredInvokeResult>;
  };

  private readonly hubPromptPromise: Promise<HubPromptRunnable>;

  constructor(config: GeminiExtractorConfig) {
    this.promptName = config.langsmithPromptName;
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

    this.structuredModel = model.withStructuredOutput(modelOutputJobDetailSchema, {
      name: 'extracted_job_detail',
      includeRaw: true,
    });

    this.hubPromptPromise = this.loadHubPrompt(config.langsmithApiKey, config.langsmithPromptName);
  }

  private async loadHubPrompt(apiKey: string, promptName: string): Promise<HubPromptRunnable> {
    const pulledPrompt = await hub.pull(promptName, {
      apiKey,
      includeModel: false,
    });

    if (!isHubPromptRunnable(pulledPrompt)) {
      throw new Error(
        `LangSmith Hub prompt "${promptName}" is not a runnable prompt template with pipe().`,
      );
    }

    return pulledPrompt;
  }

  getModelName(): string {
    return this.modelName;
  }

  async extractFromDetailPage(
    listingRecord: SourceListingRecord,
    detailPageText: string,
  ): Promise<ExtractionResult> {
    const prompt = await this.hubPromptPromise;
    const promptInput = buildHubPromptInput(listingRecord, detailPageText, prompt.inputVariables);
    this.logger.debug(
      {
        sourceId: listingRecord.sourceId,
        source: listingRecord.source,
        detailTextChars: detailPageText.length,
        model: this.modelName,
        promptName: this.promptName,
        inputVariables: prompt.inputVariables ?? [],
      },
      'Starting LLM detail extraction',
    );

    const startedAt = performance.now();
    const renderedPrompt = await prompt.invoke(promptInput);
    const response = await this.structuredModel.invoke(renderedPrompt);
    const llmCallDurationSeconds = (performance.now() - startedAt) / 1_000;

    const parsedDetail = modelOutputJobDetailSchema.parse(response.parsed);
    const detail = extractedJobDetailSchema.parse(
      normalizedExtractedJobDetailSchema.parse(parsedDetail),
    );
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
        jobDescriptionChars: detail.jobDescription?.length ?? 0,
        seniorityLevel: detail.seniorityLevel,
        promptName: this.promptName,
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
