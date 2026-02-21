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

const compensationPeriodSchema = z.enum(['hour', 'day', 'month', 'year', 'project', 'unknown']);

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
  rawText: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  minAmount: z.number().nullable().default(null),
  maxAmount: z.number().nullable().default(null),
  period: compensationPeriodSchema.default('unknown'),
  isGross: z.boolean().nullable().default(null),
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

export const extractedJobDetailSchema = z.object({
  canonicalTitle: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  responsibilities: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  benefits: z.array(z.string()).default([]),
  techStack: z.array(z.string()).default([]),
  seniorityLevel: z.string().nullable().default(null),
  employmentTypes: z.array(employmentTypeSchema).default([]),
  workModes: z.array(workModeSchema).default([]),
  locations: z.array(extractedLocationSchema).default([]),
  salary: extractedSalarySchema,
  languageRequirements: z.array(languageRequirementSchema).default([]),
  hiringProcess: z.array(z.string()).default([]),
  travelRequirements: z.string().nullable().default(null),
  startDateText: z.string().nullable().default(null),
  applicationDeadlineText: z.string().nullable().default(null),
  applyUrl: z.string().nullable().default(null),
  contactName: z.string().nullable().default(null),
  contactEmail: z.string().nullable().default(null),
  contactPhone: z.string().nullable().default(null),
  companyDescription: z.string().nullable().default(null),
});

export type ExtractedJobDetail = z.infer<typeof extractedJobDetailSchema>;

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
