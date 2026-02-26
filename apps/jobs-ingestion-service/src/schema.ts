import { z } from 'zod';

const toNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const unknownToNullableString = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])
  .transform((value) => toNullableString(value));

const llmNullishTextPattern = /^(?:n\/a|n\.a\.|none|null|undefined|not\s+available)$/i;

const normalizeDetailNullableText = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return llmNullishTextPattern.test(trimmed) ? null : trimmed;
};

const normalizeListItemText = (value: string): string | null => {
  const collapsedWhitespace = value.replace(/\s+/g, ' ').trim();
  if (collapsedWhitespace.length === 0) {
    return null;
  }

  return llmNullishTextPattern.test(collapsedWhitespace) ? null : collapsedWhitespace;
};

const dedupeStringsCaseInsensitive = <T extends string>(items: T[]): T[] => {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
};

const dedupeStringsExact = <T extends string>(items: T[]): T[] => {
  const seen = new Set<T>();
  const deduped: T[] = [];

  for (const item of items) {
    if (seen.has(item)) {
      continue;
    }

    seen.add(item);
    deduped.push(item);
  }

  return deduped;
};

const normalizeStringArray = (items: string[]): string[] =>
  dedupeStringsCaseInsensitive(
    items
      .map((item) => normalizeListItemText(item))
      .filter((item): item is string => item !== null),
  );

const techStackNoisePatterns = [
  /^komunikace$/i,
  /^komunika[čc]n[íi]\s+schopnosti?$/i,
  /^analytick[ée]\s+schopnosti?$/i,
  /^t[ýy]mov[ýy]\s+duch$/i,
  /^samostatnost$/i,
  /^pe[čc]livost$/i,
  /^zodpov[eě]dnost$/i,
  /^proaktivita$/i,
  /^flexibilita$/i,
  /^komunika[čc]n[íi]\s+dovednosti$/i,
  /^soft\s*skills?$/i,
  /^communication(?:\s+skills?)?$/i,
  /^analytical\s+skills?$/i,
  /^problem[\s-]*solving$/i,
  /^team(?:\s|-)?player$/i,
  /^teamwork$/i,
  /^backend$/i,
  /^frontend$/i,
  /^front-end$/i,
  /^back-end$/i,
  /^full[\s-]?stack$/i,
  /^developer$/i,
  /^program[aá]tor$/i,
  /^engineer$/i,
  /^analyst$/i,
  /^word$/i,
  /^excel$/i,
  /^outlook$/i,
  /^microsoft\s+word$/i,
  /^microsoft\s+excel$/i,
  /^microsoft\s+outlook$/i,
];

const techStackCanonicalForms: Array<[RegExp, string]> = [
  [/^cicd$/i, 'CI/CD'],
  [/^ci\s*[/\\-]\s*cd$/i, 'CI/CD'],
  [/^git\s*hub\s*actions$/i, 'GitHub Actions'],
  [/^github\s*actions$/i, 'GitHub Actions'],
  [/^javascript$/i, 'JavaScript'],
  [/^typescript$/i, 'TypeScript'],
  [/^node\s*\.?\s*js$/i, 'Node.js'],
  [/^react(?:\.?\s*js)?$/i, 'React'],
  [/^vue(?:\.?\s*js)?$/i, 'Vue.js'],
  [/^next(?:\.?\s*js)?$/i, 'Next.js'],
  [/^nuxt(?:\.?\s*js)?$/i, 'Nuxt.js'],
  [/^postgres(?:ql)?$/i, 'PostgreSQL'],
  [/^mongo\s*db$/i, 'MongoDB'],
  [/^ms\s*sql$/i, 'MS SQL'],
  [/^mssql$/i, 'MS SQL'],
  [/^sql\s*server$/i, 'SQL Server'],
  [/^k8s$/i, 'Kubernetes'],
  [/^dotnet$/i, '.NET'],
  [/^\.net$/i, '.NET'],
  [/^asp\s*\.?\s*net$/i, 'ASP.NET'],
];

const canonicalizeTechStackItem = (item: string): string => {
  for (const [pattern, canonical] of techStackCanonicalForms) {
    if (pattern.test(item)) {
      return canonical;
    }
  }

  return item;
};

const isTechStackNoise = (item: string): boolean =>
  techStackNoisePatterns.some((pattern) => pattern.test(item));

const getVersionlessTechBaseKey = (item: string): string | null => {
  const match = item.match(/^(.+?)\s+v?\d[\w.+/-]*(?:\s+v?\d[\w.+/-]*)*$/i);
  if (!match) {
    return null;
  }

  const base = canonicalizeTechStackItem(match[1]!.trim()).toLocaleLowerCase();
  return base.length > 0 ? base : null;
};

const collapseBaseAndVersionTechDuplicates = (items: string[]): string[] => {
  const versionedBaseKeys = new Set(
    items
      .map((item) => getVersionlessTechBaseKey(item))
      .filter((item): item is string => item !== null),
  );

  return items.filter((item) => {
    if (getVersionlessTechBaseKey(item) !== null) {
      return true;
    }

    const plainKey = canonicalizeTechStackItem(item).toLocaleLowerCase();
    return !versionedBaseKeys.has(plainKey);
  });
};

const normalizeTechStackArray = (items: string[]): string[] => {
  const normalized = items
    .map((item) => normalizeListItemText(item))
    .filter((item): item is string => item !== null)
    .map((item) => canonicalizeTechStackItem(item))
    .filter((item) => !isTechStackNoise(item));

  return collapseBaseAndVersionTechDuplicates(dedupeStringsCaseInsensitive(normalized));
};

const employmentTypeSchema = z.enum([
  'full-time',
  'part-time',
  'contract',
  'freelance',
  'internship',
  'temporary',
  'other',
]);

const workModeSchema = z.enum(['onsite', 'hybrid', 'remote', 'unknown']);
const seniorityLevelSchema = z
  .enum(['medior', 'senior', 'junior', 'absolvent'])
  .describe(
    "Infer level: 'absolvent' (0 exp/fresh grad), 'junior' (<2y), 'medior' (standard/mid), 'senior' (5y+ or lead).",
  );

const compensationPeriodSchema = z
  .enum(['hour', 'day', 'month', 'year', 'project', 'unknown'])
  .describe(
    "The time unit for the salary payment. Default to 'month' if ambiguous but likely monthly.",
  );

export const sourceListingRecordSchema = z.object({
  sourceId: z.union([z.string(), z.number()]).transform((value) => String(value)),
  adUrl: z.url(),
  jobTitle: z.string().min(1),
  companyName: unknownToNullableString,
  location: unknownToNullableString,
  salary: unknownToNullableString,
  publishedInfoText: unknownToNullableString,
  scrapedAt: z.string().min(1),
  source: z.string().min(1),
  htmlDetailPageKey: z.string().min(1),
});

export type SourceListingRecord = z.infer<typeof sourceListingRecordSchema>;

export const extractedSalarySchema = z.object({
  min: z
    .number()
    .nullable()
    .default(null)
    .describe(
      "The lower bound of the salary range. Numeric only (e.g. 30000). If '30k' is found, convert to 30000.",
    ),
  max: z
    .number()
    .nullable()
    .default(null)
    .describe(
      "The upper bound of the salary range. Numeric only. If fixed salary (e.g. '50000'), set both min and max to 50000.",
    ),
  currency: z
    .string()
    .nullable()
    .default('CZK')
    .describe("ISO currency code (e.g. CZK, EUR, USD). Infer from context (e.g. 'Kč' -> CZK)."),
  period: compensationPeriodSchema.default('unknown'),
  inferred: z
    .boolean()
    .default(false)
    .describe('ALWAYS FALSE for the LLM. This flag is reserved for post-processing updates.'),
});

export const extractedLocationSchema = z.object({
  city: z.string().nullable().default(null),
  region: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  addressText: z.string().nullable().default(null),
});

export const languageRequirementSchema = z.object({
  language: z.string(),
  level: z.string().nullable().default(null),
});

export const recruiterContactsSchema = z.object({
  contactName: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Recruiter or contact person name if explicitly present. Use null if missing or unclear. Do not invent a person from generic HR text.',
    ),
  contactEmail: z
    .string()
    .nullable()
    .default(null)
    .describe('Recruiter contact email if explicitly present. Use null if missing. Do not invent.'),
  contactPhone: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Recruiter contact phone number if explicitly present. Use null if missing. Do not invent.',
    ),
});

export const extractedJobDetailSchema = z.object({
  canonicalTitle: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Normalized job role title based on ad evidence. Remove obvious company/location noise when possible. Keep null if unclear.',
    ),
  seniorityLevel: seniorityLevelSchema
    .nullable()
    .default(null)
    .describe(
      'Standardize to one of: medior, senior, junior, absolvent. Prefer explicit evidence (keywords such as junior/senior/medior/mid/intermediate, graduate/absolvent labels). If explicit evidence is absent, infer only when there are at least 2 strong signals (e.g. years of experience + leadership scope). Do not infer "medior" from a generic role title alone. Keep null when evidence is weak or ambiguous.',
    ),
  employmentTypes: z
    .array(employmentTypeSchema)
    .default([])
    .describe(
      'Normalize to one or more of: full-time, part-time, contract, freelance, internship, temporary, other.',
    ),
  workModes: z
    .array(workModeSchema)
    .default([])
    .describe(
      'Use only explicit evidence from the ad. Default to ["unknown"] when remote/hybrid/onsite is not explicitly stated. Do not assume onsite from location alone.',
    ),
  locations: z.array(extractedLocationSchema).default([]),
  salary: extractedSalarySchema,
  languageRequirements: z.array(languageRequirementSchema).default([]),
  techStack: z
    .array(z.string())
    .default([])
    .describe(
      'Only explicitly named technologies, languages, frameworks, databases, tools, protocols, or standards (e.g. Java, SQL, React, OAuth2). Exclude soft skills, personality traits, and generic job categories. Exclude generic office tools like Word/Excel/Outlook unless critical.',
    ),
  travelRequirements: z
    .string()
    .nullable()
    .default(null)
    .describe('Travel requirement text if explicitly mentioned; otherwise null.'),
  startDateText: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Start date or candidate availability text exactly as stated in the ad; otherwise null.',
    ),
  applicationDeadlineText: z
    .string()
    .nullable()
    .default(null)
    .describe('Application deadline text exactly as stated in the ad; otherwise null.'),
  applyUrl: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Apply URL if explicitly provided in the ad; otherwise null. Prefer absolute URL when available.',
    ),
  recruiterContacts: recruiterContactsSchema.default({
    contactName: null,
    contactEmail: null,
    contactPhone: null,
  }),
  responsibilities: z
    .array(z.string())
    .default([])
    .describe('List of specific day-to-day duties. Split compound sentences.'),
  requirements: z
    .array(z.string())
    .default([])
    .describe('Hard skills, education, and experience requirements.'),
  niceToHave: z.array(z.string()).default([]).describe("Optional or 'advantage' skills."),
  benefits: z
    .array(z.string())
    .default([])
    .describe('Perks, hardware, holidays, or monetary bonuses.'),
  hiringProcess: z.array(z.string()).default([]),
  summary: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Optional for the LLM. It may return null. Final summary is derived deterministically in post-processing from extracted structured fields and listing context; do not invent narrative details.',
    ),
  jobDescription: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Role description content only (responsibilities, expectations, scope, context). Exclude unrelated site chrome or marketing text when possible. Use null if unavailable.',
    ),
  companyDescription: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Employer/company description text that is relevant to understanding the company. Use null if not present.',
    ),
});

export type ExtractedJobDetail = z.infer<typeof extractedJobDetailSchema>;

export const normalizedExtractedJobDetailSchema = extractedJobDetailSchema.transform((detail) => {
  const normalizedLanguageRequirements = detail.languageRequirements
    .map((item) => ({
      language: normalizeListItemText(item.language),
      level: normalizeDetailNullableText(item.level),
    }))
    .filter((item): item is { language: string; level: string | null } => item.language !== null)
    .filter((item, index, items) => {
      const normalizedKey = `${item.language.toLocaleLowerCase()}|${item.level?.toLocaleLowerCase() ?? ''}`;
      return (
        items.findIndex(
          (candidate) =>
            `${candidate.language.toLocaleLowerCase()}|${candidate.level?.toLocaleLowerCase() ?? ''}` ===
            normalizedKey,
        ) === index
      );
    });

  const normalizedLocations = detail.locations
    .map((location) => ({
      city: normalizeDetailNullableText(location.city),
      region: normalizeDetailNullableText(location.region),
      country: normalizeDetailNullableText(location.country),
      addressText: normalizeDetailNullableText(location.addressText),
    }))
    .filter(
      (location) =>
        location.city !== null ||
        location.region !== null ||
        location.country !== null ||
        location.addressText !== null,
    );

  return {
    ...detail,
    canonicalTitle: normalizeDetailNullableText(detail.canonicalTitle),
    summary: normalizeDetailNullableText(detail.summary),
    jobDescription: normalizeDetailNullableText(detail.jobDescription),
    responsibilities: normalizeStringArray(detail.responsibilities),
    requirements: normalizeStringArray(detail.requirements),
    niceToHave: normalizeStringArray(detail.niceToHave),
    benefits: normalizeStringArray(detail.benefits),
    techStack: normalizeTechStackArray(detail.techStack),
    employmentTypes: dedupeStringsExact(detail.employmentTypes),
    workModes: dedupeStringsExact(detail.workModes),
    locations: normalizedLocations,
    salary: {
      ...detail.salary,
      currency: normalizeDetailNullableText(detail.salary.currency),
    },
    languageRequirements: normalizedLanguageRequirements,
    hiringProcess: normalizeStringArray(detail.hiringProcess),
    travelRequirements: normalizeDetailNullableText(detail.travelRequirements),
    startDateText: normalizeDetailNullableText(detail.startDateText),
    applicationDeadlineText: normalizeDetailNullableText(detail.applicationDeadlineText),
    applyUrl: normalizeDetailNullableText(detail.applyUrl),
    recruiterContacts: {
      contactName: normalizeDetailNullableText(detail.recruiterContacts.contactName),
      contactEmail: normalizeDetailNullableText(detail.recruiterContacts.contactEmail),
      contactPhone: normalizeDetailNullableText(detail.recruiterContacts.contactPhone),
    },
    companyDescription: normalizeDetailNullableText(detail.companyDescription),
  };
});

export const rawDetailPageSchema = z.object({
  text: z.string(),
  charCount: z.number().int().nonnegative(),
  tokenCountApprox: z.number().int().nonnegative(),
  tokenCountMethod: z.enum(['chars_div_4']),
});

export type RawDetailPage = z.infer<typeof rawDetailPageSchema>;

export const unifiedJobAdSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceId: z.string(),
  crawlRunId: z.string().nullable(),
  adUrl: z.url(),
  htmlDetailPageKey: z.string(),
  scrapedAt: z.string(),
  listing: z.object({
    jobTitle: z.string(),
    companyName: z.string().nullable(),
    locationText: z.string().nullable(),
    salaryText: z.string().nullable(),
    publishedInfoText: z.string().nullable(),
  }),
  detail: extractedJobDetailSchema,
  rawDetailPage: rawDetailPageSchema,
  ingestion: z.object({
    runId: z.string(),
    datasetFileName: z.string(),
    datasetRecordIndex: z.number().int().nonnegative(),
    detailHtmlPath: z.string(),
    detailHtmlSha256: z.string(),
    extractorModel: z.string(),
    extractedAt: z.iso.datetime(),
    parserVersion: z.string(),
    timeToProcssSeconds: z.number().nonnegative(),
    llmCallDurationSeconds: z.number().nonnegative(),
    llmInputTokens: z.number().int().nonnegative(),
    llmOutputTokens: z.number().int().nonnegative(),
    llmTotalTokens: z.number().int().nonnegative(),
    llmInputCostUsd: z.number().nonnegative(),
    llmOutputCostUsd: z.number().nonnegative(),
    llmTotalCostUsd: z.number().nonnegative(),
  }),
});

export type UnifiedJobAd = z.infer<typeof unifiedJobAdSchema>;
