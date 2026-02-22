import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import type { AppLogger } from './logger.js';
import { loadDetailPage, type LoadedDetailPage } from './html-detail-loader.js';
import type { LocalInputRecord } from './input-provider.js';
import {
  type ExtractionTelemetry,
  GeminiJobDetailExtractor,
  LangSmithJobDescriptionExtractor,
  mergeExtractionTelemetry,
} from './extraction.js';
import { type ExtractedJobDetail, type UnifiedJobAd, unifiedJobAdSchema } from './schema.js';

type JobParsingGraphConfig = {
  extractor: GeminiJobDetailExtractor;
  jobDescriptionExtractor: LangSmithJobDescriptionExtractor;
  maxDetailChars: number;
  minRelevantTextChars: number;
  parserVersion: string;
  logger: AppLogger;
};

const JobParsingGraphState = Annotation.Root({
  inputRecord: Annotation<LocalInputRecord>(),
  loadedDetailPage: Annotation<LoadedDetailPage>(),
  extractedJobDescription: Annotation<string | null>(),
  jobDescriptionExtractionTelemetry: Annotation<ExtractionTelemetry>(),
  extractedDetail: Annotation<ExtractedJobDetail>(),
  extractionTelemetry: Annotation<ExtractionTelemetry>(),
  unifiedJobAd: Annotation<UnifiedJobAd>(),
});

type JobParsingGraphStateType = typeof JobParsingGraphState.State;

const buildDocument = (
  state: JobParsingGraphStateType,
  parserVersion: string,
  extractorModel: string,
): UnifiedJobAd => {
  const { inputRecord, loadedDetailPage, extractedDetail, extractionTelemetry } = state;
  const { listingRecord } = inputRecord;

  return unifiedJobAdSchema.parse({
    id: `${listingRecord.source}:${listingRecord.sourceId}`,
    source: listingRecord.source,
    sourceId: listingRecord.sourceId,
    adUrl: listingRecord.adUrl,
    htmlDetailPageKey: listingRecord.htmlDetailPageKey,
    scrapedAt: listingRecord.scrapedAt,
    listing: {
      jobTitle: listingRecord.jobTitle,
      companyName: listingRecord.companyName,
      locationText: listingRecord.location,
      salaryText: listingRecord.salary,
      publishedInfoText: listingRecord.publishedInfoText,
    },
    detail: extractedDetail,
    ingestion: {
      datasetFileName: inputRecord.datasetFileName,
      datasetRecordIndex: inputRecord.datasetRecordIndex,
      detailHtmlPath: inputRecord.detailHtmlPath,
      detailHtmlSha256: loadedDetailPage.htmlSha256,
      extractorModel,
      extractedAt: new Date().toISOString(),
      parserVersion,
      timeToProcssSeconds: 0,
      llmCallDurationSeconds: extractionTelemetry.llmCallDurationSeconds,
      llmInputTokens: extractionTelemetry.llmInputTokens,
      llmOutputTokens: extractionTelemetry.llmOutputTokens,
      llmTotalTokens: extractionTelemetry.llmTotalTokens,
      llmInputCostUsd: extractionTelemetry.llmInputCostUsd,
      llmOutputCostUsd: extractionTelemetry.llmOutputCostUsd,
      llmTotalCostUsd: extractionTelemetry.llmTotalCostUsd,
    },
  });
};

export class JobParsingGraph {
  private readonly logger: AppLogger;

  private readonly graphApp: {
    invoke(input: Pick<JobParsingGraphStateType, 'inputRecord'>): Promise<JobParsingGraphStateType>;
  };

  constructor(config: JobParsingGraphConfig) {
    this.logger = config.logger.child({ component: 'JobParsingGraph' });

    const loadDetailPageNode = async (
      state: JobParsingGraphStateType,
    ): Promise<Pick<JobParsingGraphStateType, 'loadedDetailPage'>> => {
      const loadedDetailPage = await loadDetailPage(
        state.inputRecord.detailHtmlPath,
        config.maxDetailChars,
        config.minRelevantTextChars,
      );
      this.logger.debug(
        {
          sourceId: state.inputRecord.listingRecord.sourceId,
          detailHtmlPath: state.inputRecord.detailHtmlPath,
          wasGzipCompressed: loadedDetailPage.wasGzipCompressed,
          fileSizeBytes: loadedDetailPage.fileSizeBytes,
          rawHtmlChars: loadedDetailPage.rawHtmlChars,
          textContentChars: loadedDetailPage.textContentChars,
        },
        'Loaded detail HTML file',
      );

      return { loadedDetailPage };
    };

    const extractJobDescriptionNode = async (
      state: JobParsingGraphStateType,
    ): Promise<
      Pick<
        JobParsingGraphStateType,
        'extractedJobDescription' | 'jobDescriptionExtractionTelemetry'
      >
    > => {
      const jobDescriptionResult = await config.jobDescriptionExtractor.extractFromRawAdText(
        state.loadedDetailPage.textContent,
      );
      const extractedJobDescription = jobDescriptionResult.jobDescription;

      this.logger.debug(
        {
          sourceId: state.inputRecord.listingRecord.sourceId,
          extractedJobDescriptionChars: extractedJobDescription?.length ?? 0,
          llmCallDurationSeconds: jobDescriptionResult.telemetry.llmCallDurationSeconds,
          llmTotalTokens: jobDescriptionResult.telemetry.llmTotalTokens,
          llmTotalCostUsd: jobDescriptionResult.telemetry.llmTotalCostUsd,
          emptyJobDescriptionFromHubPrompt: jobDescriptionResult.jobDescription === null,
        },
        'Extracted detail.jobDescription using LangSmith Hub prompt',
      );

      return {
        extractedJobDescription,
        jobDescriptionExtractionTelemetry: jobDescriptionResult.telemetry,
      };
    };

    const extractDetailNode = async (
      state: JobParsingGraphStateType,
    ): Promise<Pick<JobParsingGraphStateType, 'extractedDetail' | 'extractionTelemetry'>> => {
      const extractionResult = await config.extractor.extractFromDetailPage(
        state.inputRecord.listingRecord,
        state.loadedDetailPage.textContent,
        state.extractedJobDescription,
      );
      const extractionTelemetry = mergeExtractionTelemetry(
        state.jobDescriptionExtractionTelemetry,
        extractionResult.telemetry,
      );

      this.logger.debug(
        {
          sourceId: state.inputRecord.listingRecord.sourceId,
          llmCallDurationSeconds: extractionTelemetry.llmCallDurationSeconds,
          llmTotalTokens: extractionTelemetry.llmTotalTokens,
          llmTotalCostUsd: extractionTelemetry.llmTotalCostUsd,
          summaryChars: extractionResult.detail.summary?.length ?? 0,
          jobDescriptionChars: extractionResult.detail.jobDescription?.length ?? 0,
        },
        'Extracted structured detail fields from LLM',
      );

      return {
        extractedDetail: extractionResult.detail,
        extractionTelemetry,
      };
    };

    const mergeNode = (
      state: JobParsingGraphStateType,
    ): Pick<JobParsingGraphStateType, 'unifiedJobAd'> => {
      const unifiedJobAd = buildDocument(
        state,
        config.parserVersion,
        config.extractor.getModelName(),
      );
      this.logger.debug(
        {
          id: unifiedJobAd.id,
          sourceId: unifiedJobAd.sourceId,
          extractorModel: unifiedJobAd.ingestion.extractorModel,
        },
        'Merged structured document',
      );

      return { unifiedJobAd };
    };

    this.graphApp = new StateGraph(JobParsingGraphState)
      .addNode('loadDetailPage', loadDetailPageNode)
      .addNode('extractJobDescription', extractJobDescriptionNode)
      .addNode('extractDetail', extractDetailNode)
      .addNode('merge', mergeNode)
      .addEdge(START, 'loadDetailPage')
      .addEdge('loadDetailPage', 'extractJobDescription')
      .addEdge('extractJobDescription', 'extractDetail')
      .addEdge('extractDetail', 'merge')
      .addEdge('merge', END)
      .compile();
  }

  async parseRecord(inputRecord: LocalInputRecord): Promise<UnifiedJobAd> {
    this.logger.info(
      {
        sourceId: inputRecord.listingRecord.sourceId,
        source: inputRecord.listingRecord.source,
      },
      'Start parsing record',
    );

    const startedAt = performance.now();
    const result = await this.graphApp.invoke({ inputRecord });
    const timeToProcssSeconds = (performance.now() - startedAt) / 1_000;

    const structured = unifiedJobAdSchema.parse({
      ...result.unifiedJobAd,
      ingestion: {
        ...result.unifiedJobAd.ingestion,
        timeToProcssSeconds,
      },
    });

    this.logger.info(
      {
        id: structured.id,
        sourceId: structured.sourceId,
        timeToProcssSeconds,
        llmCallDurationSeconds: structured.ingestion.llmCallDurationSeconds,
      },
      'Completed parsing record',
    );

    return structured;
  }
}
