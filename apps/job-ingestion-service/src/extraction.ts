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
- detail.summary may be null. Final detail.summary is derived deterministically in post-processing from structured fields and listing context.
- Fill short fields first; fill long text fields last.
- Put recruiter contact information into detail.recruiterContacts object:
  - recruiterContacts.contactName
  - recruiterContacts.contactEmail
  - recruiterContacts.contactPhone
- For detail.workModes:
  - Default to ["unknown"] unless the ad explicitly states remote, hybrid, or onsite.
  - Only infer onsite when there is an explicit place-of-work statement and no remote/hybrid hints.
  - Do not assume onsite just because a location or office address is present.
- For detail.seniorityLevel:
  - Keep null unless there is explicit evidence (e.g. junior/senior keyword, medior/mid/intermediate label) or at least 2 strong signals.
  - Strong signals include explicit years-of-experience requirements and leadership scope signals.
  - Do not infer "medior" from a generic role title alone.
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
      'Standardize to one of: medior, senior, junior, absolvent. Prefer explicit evidence (keywords such as junior/senior/medior/mid/intermediate, graduate/absolvent labels). If explicit evidence is absent, infer only when there are at least 2 strong signals (e.g. years of experience + leadership scope). Do not infer "medior" from a generic role title alone. Keep null when evidence is weak or ambiguous.',
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

const minimumJobDescriptionChars = 120;
const derivedSummaryMaxChars = 1_000;

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
type StandardWorkMode = 'onsite' | 'hybrid' | 'remote' | 'unknown';

const countRegexHits = (text: string, patterns: RegExp[]): number =>
  patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);

const collectSeniorityContext = (
  listingRecord: SourceListingRecord,
  detailPageText: string,
  jobDescription: string | null,
): string =>
  [
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

const explicitSenioritySignals: Array<{ value: StandardSeniorityLevel; patterns: RegExp[] }> = [
  {
    value: 'absolvent',
    patterns: [
      /\babsolvent/i,
      /\bgraduate\b/i,
      /\bentry[\s-]?level\b/i,
      /\bfor\s+graduates\b/i,
      /\bpro\s+absolventy\b/i,
      /\bvhodn[eé]\s+i\s+pro\s+absolventy\b/i,
      /\bjunior\s+absolvent/i,
    ],
  },
  {
    value: 'junior',
    patterns: [/\bjunior\b/i, /\bjr\.?\b/i, /\bza[cč][aá]te[cč]n[ií]k/i],
  },
  {
    value: 'medior',
    patterns: [/\bmedior\b/i, /\bmid(?:dle)?[\s-]?level\b/i, /\bintermediate\b/i],
  },
  {
    value: 'senior',
    patterns: [/\bsenior\b/i, /\bsr\.?\b/i, /\bprincipal\b/i, /\bstaff\b/i, /\blead\b/i],
  },
];

const strongSenioritySignals: Array<{ value: StandardSeniorityLevel; patterns: RegExp[] }> = [
  {
    value: 'absolvent',
    patterns: [/\bbez\s+praxe\b/i, /\bno\s+experience\s+required\b/i, /\b0\s*(?:-|to)\s*1\s+rok/i],
  },
  {
    value: 'junior',
    patterns: [/\b1-2\s+roky/i, /\bdo\s+2\s+let\b/i, /\b1\+\s*(?:years?|let)\b/i],
  },
  {
    value: 'medior',
    patterns: [/\b2-4\s+roky/i, /\b3\+\s*(?:years?|let)\b/i, /\b4\+\s*(?:years?|let)\b/i],
  },
  {
    value: 'senior',
    patterns: [
      /\b5\+\s*(?:years?|let)\b/i,
      /\b6\+\s*(?:years?|let)\b/i,
      /\b7\+\s*(?:years?|let)\b/i,
      /\barchitekt\b/i,
      /\bteam\s+lead\b/i,
      /\bleading\s+(?:a\s+)?team\b/i,
      /\bvede(?:n[ií])?\s+t[ýy]m/i,
      /\bmentoring\b/i,
      /\bmentor(?:ing)?\b/i,
    ],
  },
];

const resolveExplicitSeniorityLevelFromContext = (
  context: string,
): StandardSeniorityLevel | null => {
  if (context.length === 0) {
    return null;
  }

  const scores: Record<StandardSeniorityLevel, number> = {
    absolvent: 0,
    junior: 0,
    medior: 0,
    senior: 0,
  };

  for (const rule of explicitSenioritySignals) {
    scores[rule.value] = countRegexHits(context, rule.patterns);
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [topLevel, topScore] = ranked[0] ?? [];
  const secondScore = typeof ranked[1]?.[1] === 'number' ? ranked[1][1] : 0;
  if (!topLevel || typeof topScore !== 'number' || topScore <= 0 || topScore === secondScore) {
    return null;
  }

  return topLevel as StandardSeniorityLevel;
};

const inferSeniorityLevelFromStrongSignals = (context: string): StandardSeniorityLevel | null => {
  if (context.length === 0) {
    return null;
  }

  const scores: Record<StandardSeniorityLevel, number> = {
    absolvent: 0,
    junior: 0,
    medior: 0,
    senior: 0,
  };

  for (const rule of strongSenioritySignals) {
    scores[rule.value] = countRegexHits(context, rule.patterns);
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [topLevel, topScore] = ranked[0] ?? [];
  const secondScore = typeof ranked[1]?.[1] === 'number' ? ranked[1][1] : 0;
  if (!topLevel || typeof topScore !== 'number' || topScore < 2 || topScore === secondScore) {
    return null;
  }

  return topLevel as StandardSeniorityLevel;
};

const resolveSeniorityLevelFromContext = (
  listingRecord: SourceListingRecord,
  detailPageText: string,
  jobDescription: string | null,
): StandardSeniorityLevel | null => {
  const context = collectSeniorityContext(listingRecord, detailPageText, jobDescription);
  return (
    resolveExplicitSeniorityLevelFromContext(context) ??
    inferSeniorityLevelFromStrongSignals(context)
  );
};

const explicitRemotePatterns = [
  /\bremote\b/i,
  /\bfull[\s-]?remote\b/i,
  /\bhome\s*office\b/i,
  /\bwork\s+from\s+home\b/i,
  /\bna\s+d[aá]lku\b/i,
  /\bpr[aá]ce\s+z\s+domova\b/i,
];

const explicitHybridPatterns = [
  /\bhybrid\b/i,
  /\bhybridn[ěe]\b/i,
  /\bhybridn[ií]\s+re[zž]im\b/i,
  /\bkombinace\b.*\b(?:home\s*office|domov|kancel[aá][řr])\b/i,
  /\bpartly\s+remote\b/i,
];

const explicitOnsitePatterns = [
  /\bonsite\b/i,
  /\bon[\s-]?site\b/i,
  /\bna\s+pracovi[sš]ti\b/i,
  /\bm[ií]sto\s+v[ýy]konu\s+pr[aá]ce\b/i,
  /\bplace\s+of\s+work\b/i,
];

const resolveWorkModesFromContext = (
  listingRecord: SourceListingRecord,
  detailPageText: string,
  jobDescription: string | null,
): StandardWorkMode[] => {
  const context = [
    listingRecord.jobTitle,
    listingRecord.publishedInfoText,
    listingRecord.location,
    jobDescription,
    detailPageText,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');

  if (context.length === 0) {
    return ['unknown'];
  }

  const hasRemote = explicitRemotePatterns.some((pattern) => pattern.test(context));
  const hasHybrid = explicitHybridPatterns.some((pattern) => pattern.test(context));
  const hasOnsite = explicitOnsitePatterns.some((pattern) => pattern.test(context));

  const resolved: StandardWorkMode[] = [];
  if (hasRemote) {
    resolved.push('remote');
  }

  if (hasHybrid) {
    resolved.push('hybrid');
  }

  if (hasOnsite && !hasHybrid && !hasRemote) {
    resolved.push('onsite');
  }

  return resolved.length > 0 ? resolved : ['unknown'];
};

const formatListPreview = (items: string[], limit: number): string | null => {
  if (items.length === 0) {
    return null;
  }

  const selected = items.slice(0, limit).join(', ');
  const remaining = items.length - limit;
  return remaining > 0 ? `${selected} (+${remaining} more)` : selected;
};

const formatSalarySummary = (
  listingRecord: SourceListingRecord,
  detail: ExtractedJobDetail,
): string | null => {
  const { salary } = detail;
  const formattedMin = salary.min !== null ? salary.min.toLocaleString('en-US') : null;
  const formattedMax = salary.max !== null ? salary.max.toLocaleString('en-US') : null;
  const currency = salary.currency ?? null;
  const periodSuffix = salary.period !== 'unknown' ? `/${salary.period}` : '';

  if (formattedMin !== null || formattedMax !== null) {
    const amountText =
      formattedMin !== null && formattedMax !== null
        ? formattedMin === formattedMax
          ? formattedMin
          : `${formattedMin}-${formattedMax}`
        : (formattedMin ?? formattedMax);

    if (!amountText) {
      return null;
    }

    const currencySuffix = currency ? ` ${currency}` : '';
    return `${amountText}${currencySuffix}${periodSuffix}`.trim();
  }

  if (listingRecord.salary && listingRecord.salary.trim().length > 0) {
    return compactWhitespace(listingRecord.salary);
  }

  return null;
};

const formatLocationsSummary = (
  listingRecord: SourceListingRecord,
  detail: ExtractedJobDetail,
): string | null => {
  const locations = detail.locations
    .map((location) =>
      [location.city, location.region, location.country]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(', '),
    )
    .filter((value) => value.length > 0);

  if (locations.length > 0) {
    return formatListPreview(locations, 2);
  }

  if (listingRecord.location && listingRecord.location.trim().length > 0) {
    return compactWhitespace(listingRecord.location);
  }

  return null;
};

const formatEnumListSummary = (items: string[]): string | null => {
  if (items.length === 0) {
    return null;
  }

  return items.join(', ');
};

const buildDerivedSummary = (
  listingRecord: SourceListingRecord,
  detail: ExtractedJobDetail,
): string | null => {
  const title = detail.canonicalTitle ?? listingRecord.jobTitle;
  const company = listingRecord.companyName ?? null;
  const seniority = detail.seniorityLevel ?? null;
  const employment = formatEnumListSummary(detail.employmentTypes);
  const workModes = formatEnumListSummary(detail.workModes.filter((mode) => mode !== 'unknown'));
  const locations = formatLocationsSummary(listingRecord, detail);
  const salary = formatSalarySummary(listingRecord, detail);
  const languages = formatListPreview(
    detail.languageRequirements.map((item) =>
      item.level ? `${item.language} (${item.level})` : item.language,
    ),
    3,
  );
  const tech = formatListPreview(detail.techStack, 6);
  const responsibilities = formatListPreview(detail.responsibilities, 3);
  const requirements = formatListPreview(detail.requirements, 4);
  const niceToHave = formatListPreview(detail.niceToHave, 3);
  const benefits = formatListPreview(detail.benefits, 4);
  const hiringProcess = formatListPreview(detail.hiringProcess, 3);

  const leadSegments = [
    title,
    seniority ? `Seniority: ${seniority}` : null,
    company ? `Company: ${company}` : null,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const detailSegments = [
    employment ? `Employment: ${employment}` : null,
    workModes ? `Work mode: ${workModes}` : null,
    locations ? `Location: ${locations}` : null,
    salary ? `Salary: ${salary}` : null,
    languages ? `Languages: ${languages}` : null,
    tech ? `Tech: ${tech}` : null,
    responsibilities ? `Responsibilities: ${responsibilities}` : null,
    requirements ? `Requirements: ${requirements}` : null,
    niceToHave ? `Nice to have: ${niceToHave}` : null,
    benefits ? `Benefits: ${benefits}` : null,
    hiringProcess ? `Hiring process: ${hiringProcess}` : null,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const summaryParts = [
    leadSegments.length > 0 ? leadSegments.join(' | ') : null,
    ...detailSegments,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (summaryParts.length === 0) {
    return null;
  }

  return trimToWholeWord(summaryParts.join('. '), derivedSummaryMaxChars);
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
    const normalizedDetail = normalizedExtractedJobDetailSchema.parse({
      ...parsedDetail,
      summary: parsedDetail.summary,
      jobDescription: resolvedJobDescription,
    });
    const resolvedSeniorityLevel = resolveSeniorityLevelFromContext(
      listingRecord,
      detailPageText,
      normalizedDetail.jobDescription,
    );
    const resolvedWorkModes = resolveWorkModesFromContext(
      listingRecord,
      detailPageText,
      normalizedDetail.jobDescription,
    );
    const summaryDetailContext = {
      ...normalizedDetail,
      seniorityLevel: resolvedSeniorityLevel,
      workModes: resolvedWorkModes,
    };
    const resolvedSummary = buildDerivedSummary(listingRecord, summaryDetailContext);
    const detail = extractedJobDetailSchema.parse({
      ...normalizedDetail,
      seniorityLevel: resolvedSeniorityLevel,
      workModes: resolvedWorkModes,
      summary: resolvedSummary,
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
