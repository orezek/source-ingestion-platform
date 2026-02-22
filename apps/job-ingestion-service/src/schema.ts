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
  summary: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Write a rich analytical summary in the same language as the ad. Target 4-8 sentences and at least ~450 characters when enough evidence is available. Cover role scope, key responsibilities, required skills, seniority, location/work mode, and compensation when present.',
    ),
  jobDescription: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Role description content only (responsibilities, expectations, scope, context). Exclude unrelated site chrome or marketing text when possible. Use null if unavailable.',
    ),
  responsibilities: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  benefits: z.array(z.string()).default([]),
  techStack: z
    .array(z.string())
    .default([])
    .describe(
      'List only directly relevant technologies/tools/platforms for the role (languages, frameworks, databases, cloud, infrastructure, developer tools). Exclude generic office software (e.g. Word, Excel, PowerPoint) and broad non-technical business tools unless the role explicitly centers on them. Deduplicate.',
    ),
  seniorityLevel: seniorityLevelSchema
    .nullable()
    .default(null)
    .describe(
      'Standardize to one of: medior, senior, junior, absolvent. Use signals from the whole ad context (listing JSON, pre-extracted jobDescription, and full detail text). If explicit, extract directly. Otherwise infer from required experience, responsibility scope, ownership, and title signals. Use "absolvent" for graduate/entry-level ads aimed at fresh graduates, "medior" for mid-level roles. Do not output synonyms like mid, lead, principal, or manager. Keep null only when there is truly no seniority signal.',
    ),
  employmentTypes: z
    .array(employmentTypeSchema)
    .default([])
    .describe(
      'Normalize to one or more of: full-time, part-time, contract, freelance, internship, temporary, other.',
    ),
  workModes: z.array(workModeSchema).default([]),
  locations: z.array(extractedLocationSchema).default([]),
  salary: extractedSalarySchema,
  languageRequirements: z.array(languageRequirementSchema).default([]),
  hiringProcess: z.array(z.string()).default([]),
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
  companyDescription: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Employer/company description text that is relevant to understanding the company. Use null if not present.',
    ),
});

export type ExtractedJobDetail = z.infer<typeof extractedJobDetailSchema>;

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
