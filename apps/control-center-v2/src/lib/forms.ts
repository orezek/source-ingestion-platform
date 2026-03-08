import {
  createControlPlanePipelineRequestV2Schema,
  updateControlPlanePipelineRequestV2Schema,
} from '@repo/control-plane-contracts/v2';
import { z } from 'zod';
import type {
  CreateControlPlanePipelineRequest,
  UpdateControlPlanePipelineRequest,
} from '@/lib/contracts';
import { splitTextareaLines } from '@/lib/utils';

export const PIPELINE_NAME_MAX_LENGTH = 20;

export const pipelineCreateFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(PIPELINE_NAME_MAX_LENGTH, `Name must be at most ${PIPELINE_NAME_MAX_LENGTH} characters.`),
  source: z.string().trim().min(1, 'Source is required.'),
  mode: z.enum(['crawl_only', 'crawl_and_ingest']),
  searchSpaceId: z.string().trim().min(1, 'Search space ID is required.'),
  searchSpaceName: z.string().trim().min(1, 'Search space name is required.'),
  searchSpaceDescription: z.string().trim().default(''),
  startUrlsText: z.string().trim().min(1, 'At least one start URL is required.'),
  maxItems: z.coerce.number().int().positive('Max items must be positive.'),
  allowInactiveMarking: z.boolean().default(true),
  runtimeProfileId: z.string().trim().min(1, 'Runtime profile ID is required.'),
  runtimeProfileName: z.string().trim().min(1, 'Runtime profile name is required.'),
  crawlerMaxConcurrency: z.coerce.number().int().positive().optional(),
  crawlerMaxRequestsPerMinute: z.coerce.number().int().positive().optional(),
  ingestionConcurrency: z.coerce.number().int().positive().optional(),
  ingestionEnabled: z.boolean().default(true),
  debugLog: z.boolean().default(false),
  includeMongoOutput: z.boolean().default(true),
  includeDownloadableJson: z.boolean().default(false),
});

export type PipelineCreateFormValues = z.input<typeof pipelineCreateFormSchema>;
export type PipelineCreateFormData = z.output<typeof pipelineCreateFormSchema>;

export const pipelineRenameFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(PIPELINE_NAME_MAX_LENGTH, `Name must be at most ${PIPELINE_NAME_MAX_LENGTH} characters.`),
});

export type PipelineRenameFormValues = z.infer<typeof pipelineRenameFormSchema>;

export const buildCreatePipelinePayload = (
  values: PipelineCreateFormData,
): CreateControlPlanePipelineRequest => {
  const startUrls = splitTextareaLines(values.startUrlsText);
  const destinations =
    values.mode === 'crawl_only'
      ? []
      : [
          ...(values.includeMongoOutput ? [{ type: 'mongodb' as const }] : []),
          ...(values.includeDownloadableJson ? [{ type: 'downloadable_json' as const }] : []),
        ];

  return createControlPlanePipelineRequestV2Schema.parse({
    name: values.name,
    source: values.source,
    mode: values.mode,
    searchSpace: {
      id: values.searchSpaceId,
      name: values.searchSpaceName,
      description: values.searchSpaceDescription,
      startUrls,
      maxItems: values.maxItems,
      allowInactiveMarking: values.allowInactiveMarking,
    },
    runtimeProfile: {
      id: values.runtimeProfileId,
      name: values.runtimeProfileName,
      crawlerMaxConcurrency: values.crawlerMaxConcurrency,
      crawlerMaxRequestsPerMinute: values.crawlerMaxRequestsPerMinute,
      ingestionConcurrency: values.mode === 'crawl_only' ? undefined : values.ingestionConcurrency,
      ingestionEnabled: values.mode === 'crawl_only' ? false : values.ingestionEnabled,
      debugLog: values.debugLog,
    },
    structuredOutput: {
      destinations,
    },
  });
};

export const buildRenamePipelinePayload = (
  values: PipelineRenameFormValues,
): UpdateControlPlanePipelineRequest => updateControlPlanePipelineRequestV2Schema.parse(values);
