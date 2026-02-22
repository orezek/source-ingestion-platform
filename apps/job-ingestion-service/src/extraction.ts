import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import * as hub from 'langchain/hub/node';
import { z } from 'zod';

import type { AppLogger } from './logger.js';
import {
  extractedJobDetailSchema,
  type ExtractedJobDetail,
  normalizedExtractedJobDetailSchema,
  type SourceListingRecord,
} from './schema.js';

const parserInstructions = `You extract job ad detail information for a unified schema.

Rules:
- Input detail pages may be rendered with jobs.cz template OR arbitrary client/company templates.
- Extract only what is supported by evidence from the provided listing context and detail page text.
- Do not invent values. If unknown, use null for scalar fields and [] for arrays.
- Keep Czech content in Czech. Keep English content in English.
- detail.jobDescription is extracted in a dedicated node and provided in the prompt.
- Preserve detail.jobDescription as provided when it is present.
- Fill short fields first; fill long text fields last.
- Put recruiter contact information into detail.recruiterContacts object:
  - recruiterContacts.contactName
  - recruiterContacts.contactEmail
  - recruiterContacts.contactPhone
- Normalize workModes to one or more of:
  onsite, hybrid, remote, unknown.
- For detail.techStack:
  - Include only explicitly named technologies, languages, frameworks, databases, tools, protocols, or standards.
  - Exclude soft skills, personality traits, and generic job categories.
  - Exclude generic office tools (e.g. Word/Excel/Outlook) unless they are explicitly critical to the role.
  - Deduplicate and prefer canonical names; avoid emitting both generic and versioned variants of the same technology unless both are explicitly important.
- For detail.salary:
  - Use evidence from both the listing JSON context and the detail page text.
  - The list-page salary text may be present in listing JSON field "salary" even when the detail page hides salary.
  - Fill salary.min and salary.max as numeric values only (no units, no separators text).
  - Convert shorthand amounts like "30k" to 30000.
  - If salary is fixed, set both salary.min and salary.max to the same value.
  - Infer salary.currency from context (e.g. "Kč" => "CZK"); prefer ISO codes.
  - Normalize salary.period to one of: hour, day, month, year, project, unknown.
  - If period is ambiguous but likely monthly, use "month".
  - Always return salary.inferred = false (reserved for post-processing).
`;

const buildPrompt = (
  listingRecord: SourceListingRecord,
  detailText: string,
  extractedJobDescription: string | null,
): string => {
  const listingContext = JSON.stringify(listingRecord, null, 2);
  const descriptionSource = extractedJobDescription?.trim().length
    ? extractedJobDescription
    : '[not available]';

  return `${parserInstructions}

Listing JSON context:
${listingContext}

Listing salary hint (list page salary text):
${listingRecord.salary ?? '[not available]'}

Pre-extracted detail.jobDescription text:
${descriptionSource}

Detail page text (full cleaned body):
${detailText}`;
};

const modelOutputJobDetailSchema = extractedJobDetailSchema.extend({
  seniorityLevel: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Standardize to one of: medior, senior, junior, absolvent. Use signals from the whole ad context (listing JSON, pre-extracted jobDescription, and full detail text). If explicit, extract directly. Otherwise infer from required experience, responsibility scope, ownership, and title signals. Use "absolvent" for graduate/entry-level ads aimed at fresh graduates, "medior" for mid-level roles. Do not output synonyms like mid, lead, principal, or manager. Keep null only when there is truly no seniority signal.',
    ),
});

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
  invoke(input: Record<string, string>): Promise<unknown>;
};

type HubPromptRunnable = {
  inputVariables?: string[];
  pipe(input: unknown): HubPromptChain;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isHubPromptRunnable = (value: unknown): value is HubPromptRunnable =>
  isObjectRecord(value) && typeof value.pipe === 'function';

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

type StandardSeniorityLevel = 'medior' | 'senior' | 'junior' | 'absolvent';

const seniorityPatternRules: Array<{ value: StandardSeniorityLevel; patterns: RegExp[] }> = [
  {
    value: 'absolvent',
    patterns: [
      /\babsolvent/i,
      /\bgraduate\b/i,
      /\bentry[\s-]?level\b/i,
      /\bbez\s+praxe\b/i,
      /\bfor\s+graduates\b/i,
      /\bpro\s+absolventy\b/i,
      /\bvhodn[eé]\s+i\s+pro\s+absolventy\b/i,
    ],
  },
  {
    value: 'junior',
    patterns: [
      /\bjunior\b/i,
      /\bjr\.?\b/i,
      /\bza[cč][aá]te[cč]n[ií]k/i,
      /\b1-2\s+roky/i,
      /\bdo\s+2\s+let\b/i,
    ],
  },
  {
    value: 'medior',
    patterns: [
      /\bmedior\b/i,
      /\bmid(?:dle)?\b/i,
      /\bintermediate\b/i,
      /\b2-4\s+roky/i,
      /\b3\s+roky/i,
    ],
  },
  {
    value: 'senior',
    patterns: [
      /\bsenior\b/i,
      /\bsr\.?\b/i,
      /\blead\b/i,
      /\bprincipal\b/i,
      /\bstaff\b/i,
      /\bexpert\b/i,
      /\b5\+\s*(?:years?|let)\b/i,
      /\b6\+\s*(?:years?|let)\b/i,
      /\barchitekt\b/i,
      /\bvedouc[ií]\b/i,
    ],
  },
];

const normalizeSeniorityLevel = (value: string | null): StandardSeniorityLevel | null => {
  if (!value) {
    return null;
  }

  const normalized = compactWhitespace(value).toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  for (const rule of seniorityPatternRules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.value;
    }
  }

  return null;
};

const inferSeniorityLevelFromContext = (
  listingRecord: SourceListingRecord,
  detailPageText: string,
  jobDescription: string | null,
): StandardSeniorityLevel | null => {
  const context = [
    listingRecord.jobTitle,
    listingRecord.publishedInfoText,
    listingRecord.salary,
    listingRecord.location,
    listingRecord.companyName,
    jobDescription,
    detailPageText,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');

  if (context.length === 0) {
    return null;
  }

  const scores: Record<StandardSeniorityLevel, number> = {
    absolvent: 0,
    junior: 0,
    medior: 0,
    senior: 0,
  };

  for (const rule of seniorityPatternRules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(context)) {
        scores[rule.value] += 1;
      }
    }
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [topLevel, topScore] = ranked[0] ?? [];
  if (!topLevel || typeof topScore !== 'number' || topScore <= 0) {
    return null;
  }

  return topLevel as StandardSeniorityLevel;
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

const toRawLlmMessage = (value: unknown): RawLlmMessage => {
  if (typeof value === 'string') {
    return { content: value };
  }

  if (isObjectRecord(value)) {
    return value as RawLlmMessage;
  }

  return {};
};

const extractTextPart = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (!isObjectRecord(value)) {
    return '';
  }

  const text = value.text;
  if (typeof text === 'string') {
    return text;
  }

  return '';
};

const extractTextContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => extractTextPart(part))
    .filter((part) => part.length > 0)
    .join('\n')
    .trim();
};

const hubPromptInputAliases = [
  'text',
  'raw_text',
  'rawText',
  'ad_text',
  'adText',
  'job_ad_text',
  'jobAdText',
  'detail_text',
  'detailText',
  'content',
  'input',
];

const buildHubPromptInput = (
  rawAdText: string,
  inputVariables: string[] | undefined,
): Record<string, string> => {
  if (!inputVariables || inputVariables.length === 0) {
    return { text: rawAdText };
  }

  const allAliases = new Set([...inputVariables, ...hubPromptInputAliases]);
  const entries = Array.from(allAliases, (variable) => [variable, rawAdText] as const);
  return Object.fromEntries(entries);
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

export type LangSmithJobDescriptionExtractorConfig = {
  langsmithApiKey: string;
  promptName: string;
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

export type JobDescriptionExtractionResult = {
  jobDescription: string | null;
  telemetry: ExtractionTelemetry;
};

export const mergeExtractionTelemetry = (
  left: ExtractionTelemetry,
  right: ExtractionTelemetry,
): ExtractionTelemetry => ({
  llmCallDurationSeconds: left.llmCallDurationSeconds + right.llmCallDurationSeconds,
  llmInputTokens: left.llmInputTokens + right.llmInputTokens,
  llmOutputTokens: left.llmOutputTokens + right.llmOutputTokens,
  llmTotalTokens: left.llmTotalTokens + right.llmTotalTokens,
  llmInputCostUsd: left.llmInputCostUsd + right.llmInputCostUsd,
  llmOutputCostUsd: left.llmOutputCostUsd + right.llmOutputCostUsd,
  llmTotalCostUsd: left.llmTotalCostUsd + right.llmTotalCostUsd,
});

export class LangSmithJobDescriptionExtractor {
  private readonly promptName: string;

  private readonly modelName: string;

  private readonly inputPriceUsdPerMillionTokens: number;

  private readonly outputPriceUsdPerMillionTokens: number;

  private readonly logger: AppLogger;

  private readonly model: ChatGoogleGenerativeAI;

  private readonly hubPromptPromise: Promise<HubPromptRunnable>;

  constructor(config: LangSmithJobDescriptionExtractorConfig) {
    this.promptName = config.promptName;
    this.modelName = config.model;
    this.inputPriceUsdPerMillionTokens = config.inputPriceUsdPerMillionTokens;
    this.outputPriceUsdPerMillionTokens = config.outputPriceUsdPerMillionTokens;
    this.logger = config.logger.child({ component: 'LangSmithJobDescriptionExtractor' });

    this.model = new ChatGoogleGenerativeAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxRetries: 2,
      thinkingConfig: config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : undefined,
    });

    this.hubPromptPromise = this.loadHubPrompt(config.langsmithApiKey, config.promptName);
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

  async extractFromRawAdText(rawAdText: string): Promise<JobDescriptionExtractionResult> {
    const prompt = await this.hubPromptPromise;
    const promptInput = buildHubPromptInput(rawAdText, prompt.inputVariables);

    this.logger.debug(
      {
        promptName: this.promptName,
        model: this.modelName,
        rawAdTextChars: rawAdText.length,
        inputVariables: prompt.inputVariables ?? [],
      },
      'Starting jobDescription extraction with LangSmith Hub prompt',
    );

    const startedAt = performance.now();
    const response = await prompt.pipe(this.model).invoke(promptInput);
    const llmCallDurationSeconds = (performance.now() - startedAt) / 1_000;

    const rawMessage = toRawLlmMessage(response);
    const extractedText = extractTextContent(rawMessage.content);
    const jobDescription = normalizeJobDescription(extractedText);
    const usage = resolveTokenUsage(rawMessage);

    const llmInputCostUsd = tokensToUsd(usage.inputTokens, this.inputPriceUsdPerMillionTokens);
    const llmOutputCostUsd = tokensToUsd(usage.outputTokens, this.outputPriceUsdPerMillionTokens);

    this.logger.debug(
      {
        promptName: this.promptName,
        llmCallDurationSeconds,
        llmInputTokens: usage.inputTokens,
        llmOutputTokens: usage.outputTokens,
        llmTotalTokens: usage.totalTokens,
        jobDescriptionChars: jobDescription?.length ?? 0,
      },
      'Completed jobDescription extraction with LangSmith Hub prompt',
    );

    return {
      jobDescription,
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

    this.structuredModel = model.withStructuredOutput(modelOutputJobDetailSchema, {
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
    extractedJobDescription: string | null,
  ): Promise<ExtractionResult> {
    const prompt = buildPrompt(listingRecord, detailPageText, extractedJobDescription);
    this.logger.debug(
      {
        sourceId: listingRecord.sourceId,
        source: listingRecord.source,
        detailTextChars: detailPageText.length,
        extractedJobDescriptionChars: extractedJobDescription?.length ?? 0,
        model: this.modelName,
      },
      'Starting LLM detail extraction',
    );

    const startedAt = performance.now();
    const response = await this.structuredModel.invoke(prompt);
    const llmCallDurationSeconds = (performance.now() - startedAt) / 1_000;

    const parsedDetail = modelOutputJobDetailSchema.parse(response.parsed);
    const resolvedJobDescription =
      normalizeJobDescription(extractedJobDescription) ?? parsedDetail.jobDescription;
    const resolvedSeniorityLevel =
      normalizeSeniorityLevel(parsedDetail.seniorityLevel) ??
      inferSeniorityLevelFromContext(listingRecord, detailPageText, resolvedJobDescription);
    const resolvedSummary = buildFallbackSummary(
      listingRecord,
      parsedDetail.summary,
      resolvedJobDescription,
    );
    const detail = normalizedExtractedJobDetailSchema.parse({
      ...parsedDetail,
      summary: resolvedSummary,
      jobDescription: resolvedJobDescription,
      seniorityLevel: resolvedSeniorityLevel,
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
        seniorityLevel: detail.seniorityLevel,
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
