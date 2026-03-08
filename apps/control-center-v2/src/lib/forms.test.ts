import { describe, expect, it } from 'vitest';
import {
  PIPELINE_NAME_MAX_LENGTH,
  buildCreatePipelinePayload,
  buildRenamePipelinePayload,
  pipelineCreateFormSchema,
  pipelineRenameFormSchema,
} from '@/lib/forms';

describe('forms', () => {
  it('builds a crawl-and-ingest payload from the form snapshot', () => {
    const values = pipelineCreateFormSchema.parse({
      name: ' Prague Tech ',
      source: 'jobs.cz',
      mode: 'crawl_and_ingest',
      searchSpaceId: 'prague-tech',
      searchSpaceName: 'Prague Tech',
      searchSpaceDescription: '  curated roles  ',
      startUrlsText: ' https://example.com/one \n\n https://example.com/two ',
      maxItems: '200',
      allowInactiveMarking: true,
      runtimeProfileId: 'runtime-prague',
      runtimeProfileName: 'Runtime Prague',
      crawlerMaxConcurrency: '3',
      crawlerMaxRequestsPerMinute: '60',
      ingestionConcurrency: '4',
      ingestionEnabled: true,
      debugLog: false,
      includeMongoOutput: true,
      includeDownloadableJson: true,
    });

    expect(buildCreatePipelinePayload(values)).toEqual({
      name: 'Prague Tech',
      source: 'jobs.cz',
      mode: 'crawl_and_ingest',
      searchSpace: {
        id: 'prague-tech',
        name: 'Prague Tech',
        description: 'curated roles',
        startUrls: ['https://example.com/one', 'https://example.com/two'],
        maxItems: 200,
        allowInactiveMarking: true,
      },
      runtimeProfile: {
        id: 'runtime-prague',
        name: 'Runtime Prague',
        crawlerMaxConcurrency: 3,
        crawlerMaxRequestsPerMinute: 60,
        ingestionConcurrency: 4,
        ingestionEnabled: true,
        debugLog: false,
      },
      structuredOutput: {
        destinations: [{ type: 'mongodb' }, { type: 'downloadable_json' }],
      },
    });
  });

  it('drops ingestion-only settings for crawl-only pipelines', () => {
    const values = pipelineCreateFormSchema.parse({
      name: 'Crawler Only',
      source: 'jobs.cz',
      mode: 'crawl_only',
      searchSpaceId: 'crawler-only',
      searchSpaceName: 'Crawler Only',
      searchSpaceDescription: '',
      startUrlsText: 'https://example.com/jobs',
      maxItems: 50,
      allowInactiveMarking: false,
      runtimeProfileId: 'runtime-crawler',
      runtimeProfileName: 'Crawler Runtime',
      crawlerMaxConcurrency: 2,
      crawlerMaxRequestsPerMinute: 30,
      ingestionConcurrency: 9,
      ingestionEnabled: true,
      debugLog: true,
      includeMongoOutput: true,
      includeDownloadableJson: true,
    });

    expect(buildCreatePipelinePayload(values)).toMatchObject({
      mode: 'crawl_only',
      runtimeProfile: {
        ingestionConcurrency: undefined,
        ingestionEnabled: false,
      },
      structuredOutput: {
        destinations: [],
      },
    });
  });

  it('normalizes the rename payload', () => {
    expect(buildRenamePipelinePayload({ name: '  Renamed Pipeline  ' })).toEqual({
      name: 'Renamed Pipeline',
    });
  });

  it('rejects pipeline names longer than the shared UI limit', () => {
    expect(() =>
      pipelineCreateFormSchema.parse({
        name: 'x'.repeat(PIPELINE_NAME_MAX_LENGTH + 1),
        source: 'jobs.cz',
        mode: 'crawl_only',
        searchSpaceId: 'crawler-only',
        searchSpaceName: 'Crawler Only',
        searchSpaceDescription: '',
        startUrlsText: 'https://example.com/jobs',
        maxItems: 50,
        allowInactiveMarking: false,
        runtimeProfileId: 'runtime-crawler',
        runtimeProfileName: 'Crawler Runtime',
        crawlerMaxConcurrency: 2,
        crawlerMaxRequestsPerMinute: 30,
        ingestionConcurrency: 9,
        ingestionEnabled: true,
        debugLog: true,
        includeMongoOutput: true,
        includeDownloadableJson: true,
      }),
    ).toThrow(new RegExp(`at most ${PIPELINE_NAME_MAX_LENGTH} characters`, 'i'));
  });

  it('rejects rename payloads longer than the shared UI limit', () => {
    expect(() =>
      pipelineRenameFormSchema.parse({
        name: 'x'.repeat(PIPELINE_NAME_MAX_LENGTH + 1),
      }),
    ).toThrow(new RegExp(`at most ${PIPELINE_NAME_MAX_LENGTH} characters`, 'i'));
  });
});
