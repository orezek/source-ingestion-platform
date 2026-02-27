import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import type { AppLogger } from './logger.js';
import { loadDetailPage, type LoadedDetailPage } from './html-detail-loader.js';
import type { LocalInputRecord } from './input-provider.js';
import {
  type ExtractionTelemetry,
  type LlmUsageTelemetry,
  GeminiDetailTextCleaner,
  GeminiJobDetailExtractor,
} from './extraction.js';
import { type ExtractedJobDetail, type UnifiedJobAd, unifiedJobAdSchema } from './schema.js';

type JobParsingGraphConfig = {
  textCleaner: GeminiDetailTextCleaner;
  extractor: GeminiJobDetailExtractor;
  minRelevantTextChars: number;
  logTextTransformContent: boolean;
  textTransformPreviewChars: number;
  parserVersion: string;
  runId: string;
  crawlRunId: string | null;
  logger: AppLogger;
};

const JobParsingGraphState = Annotation.Root({
  inputRecord: Annotation<LocalInputRecord>(),
  loadedDetailPage: Annotation<LoadedDetailPage>(),
  cleanedDetailText: Annotation<string>(),
  cleanerTelemetry: Annotation<LlmUsageTelemetry>(),
  extractedDetail: Annotation<ExtractedJobDetail>(),
  extractionTelemetry: Annotation<ExtractionTelemetry>(),
  unifiedJobAd: Annotation<UnifiedJobAd>(),
});

type JobParsingGraphStateType = typeof JobParsingGraphState.State;

const approximateTokenCountFromChars = (charCount: number): number => Math.ceil(charCount / 4);

const toTextPreview = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars)} ...[truncated]`;

const buildDocument = (
  state: JobParsingGraphStateType,
  parserVersion: string,
  runId: string,
  crawlRunId: string | null,
  extractorModel: string,
): UnifiedJobAd => {
  const { inputRecord, loadedDetailPage, extractedDetail, extractionTelemetry, cleanerTelemetry } =
    state;
  const { listingRecord } = inputRecord;
  const llmTotalInputTokens = cleanerTelemetry.llmInputTokens + extractionTelemetry.llmInputTokens;
  const llmTotalOutputTokens =
    cleanerTelemetry.llmOutputTokens + extractionTelemetry.llmOutputTokens;
  const llmTotalTokens = cleanerTelemetry.llmTotalTokens + extractionTelemetry.llmTotalTokens;
  const llmTotalInputCostUsd =
    cleanerTelemetry.llmInputCostUsd + extractionTelemetry.llmInputCostUsd;
  const llmTotalOutputCostUsd =
    cleanerTelemetry.llmOutputCostUsd + extractionTelemetry.llmOutputCostUsd;
  const llmTotalCostUsd = cleanerTelemetry.llmTotalCostUsd + extractionTelemetry.llmTotalCostUsd;
  const llmTotalCallDurationSeconds =
    cleanerTelemetry.llmCallDurationSeconds + extractionTelemetry.llmCallDurationSeconds;

  return unifiedJobAdSchema.parse({
    id: `${listingRecord.source}:${listingRecord.sourceId}`,
    source: listingRecord.source,
    sourceId: listingRecord.sourceId,
    crawlRunId,
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
    rawDetailPage: {
      loadDetailPageText: {
        text: loadedDetailPage.textContent,
        charCount: loadedDetailPage.textContentChars,
        tokenCountApprox: approximateTokenCountFromChars(loadedDetailPage.textContentChars),
        tokenCountMethod: 'chars_div_4',
      },
      cleanDetailText: {
        // Persist step-2 cleaner output to enable cheaper reprocessing without re-running cleaner.
        text: state.cleanedDetailText,
        charCount: state.cleanedDetailText.length,
        tokenCountApprox: approximateTokenCountFromChars(state.cleanedDetailText.length),
        tokenCountMethod: 'chars_div_4',
      },
    },
    ingestion: {
      runId,
      datasetFileName: inputRecord.datasetFileName,
      datasetRecordIndex: inputRecord.datasetRecordIndex,
      detailHtmlPath: inputRecord.detailHtmlPath,
      detailHtmlSha256: loadedDetailPage.htmlSha256,
      extractorModel,
      extractedAt: new Date().toISOString(),
      parserVersion,
      timeToProcssSeconds: 0,
      llmCleanerCallDurationSeconds: cleanerTelemetry.llmCallDurationSeconds,
      llmCleanerInputTokens: cleanerTelemetry.llmInputTokens,
      llmCleanerOutputTokens: cleanerTelemetry.llmOutputTokens,
      llmCleanerTotalTokens: cleanerTelemetry.llmTotalTokens,
      llmCleanerInputCostUsd: cleanerTelemetry.llmInputCostUsd,
      llmCleanerOutputCostUsd: cleanerTelemetry.llmOutputCostUsd,
      llmCleanerTotalCostUsd: cleanerTelemetry.llmTotalCostUsd,
      llmExtractorCallDurationSeconds: extractionTelemetry.llmCallDurationSeconds,
      llmExtractorInputTokens: extractionTelemetry.llmInputTokens,
      llmExtractorOutputTokens: extractionTelemetry.llmOutputTokens,
      llmExtractorTotalTokens: extractionTelemetry.llmTotalTokens,
      llmExtractorInputCostUsd: extractionTelemetry.llmInputCostUsd,
      llmExtractorOutputCostUsd: extractionTelemetry.llmOutputCostUsd,
      llmExtractorTotalCostUsd: extractionTelemetry.llmTotalCostUsd,
      llmTotalCallDurationSeconds,
      llmTotalInputTokens,
      llmTotalOutputTokens,
      llmTotalTokens,
      llmTotalInputCostUsd,
      llmTotalOutputCostUsd,
      llmTotalCostUsd,
    },
  });
};

export class JobParsingGraph {
  private readonly logger: AppLogger;

  private readonly graphApp: {
    invoke(input: Pick<JobParsingGraphStateType, 'inputRecord'>): Promise<JobParsingGraphStateType>;
  };

  constructor(config: JobParsingGraphConfig) {
    this.logger = config.logger.child({ component: 'JobParsingGraph', runId: config.runId });

    const loadDetailPageNode = async (
      state: JobParsingGraphStateType,
    ): Promise<Pick<JobParsingGraphStateType, 'loadedDetailPage'>> => {
      const loadedDetailPage = await loadDetailPage(
        state.inputRecord.detailHtmlPath,
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

      if (config.logTextTransformContent) {
        this.logger.info(
          {
            sourceId: state.inputRecord.listingRecord.sourceId,
            stage: 'loadDetailPage',
            textContentChars: loadedDetailPage.textContentChars,
            textContentPreview: toTextPreview(
              loadedDetailPage.textContent,
              config.textTransformPreviewChars,
            ),
          },
          'Text transform trace',
        );
      }

      return { loadedDetailPage };
    };

    const extractDetailNode = async (
      state: JobParsingGraphStateType,
    ): Promise<Pick<JobParsingGraphStateType, 'extractedDetail' | 'extractionTelemetry'>> => {
      if (config.logTextTransformContent) {
        this.logger.info(
          {
            sourceId: state.inputRecord.listingRecord.sourceId,
            stage: 'extractDetail_input',
            cleanedDetailTextChars: state.cleanedDetailText.length,
            cleanedDetailTextPreview: toTextPreview(
              state.cleanedDetailText,
              config.textTransformPreviewChars,
            ),
          },
          'Text transform trace',
        );
      }

      const extractionResult = await config.extractor.extractFromDetailPage(
        state.inputRecord.listingRecord,
        state.cleanedDetailText,
      );
      const extractionTelemetry = extractionResult.telemetry;

      this.logger.debug(
        {
          sourceId: state.inputRecord.listingRecord.sourceId,
          llmCallDurationSeconds: extractionTelemetry.llmCallDurationSeconds,
          llmTotalTokens: extractionTelemetry.llmTotalTokens,
          llmTotalCostUsd: extractionTelemetry.llmTotalCostUsd,
          jobDescriptionChars: extractionResult.detail.jobDescription?.length ?? 0,
        },
        'Extracted structured detail fields from LLM',
      );

      return {
        extractedDetail: extractionResult.detail,
        extractionTelemetry,
      };
    };

    const cleanDetailTextNode = async (
      state: JobParsingGraphStateType,
    ): Promise<Pick<JobParsingGraphStateType, 'cleanedDetailText' | 'cleanerTelemetry'>> => {
      const cleanerResult = await config.textCleaner.cleanText(state.loadedDetailPage.textContent);
      const cleanedDetailText = cleanerResult.text;

      this.logger.debug(
        {
          sourceId: state.inputRecord.listingRecord.sourceId,
          rawTextChars: state.loadedDetailPage.textContentChars,
          cleanedTextChars: cleanedDetailText.length,
          llmTotalTokens: cleanerResult.telemetry.llmTotalTokens,
          llmTotalCostUsd: cleanerResult.telemetry.llmTotalCostUsd,
        },
        'Cleaned detail text before extraction',
      );

      if (config.logTextTransformContent) {
        this.logger.info(
          {
            sourceId: state.inputRecord.listingRecord.sourceId,
            stage: 'cleanDetailText',
            beforeChars: state.loadedDetailPage.textContentChars,
            afterChars: cleanedDetailText.length,
            beforePreview: toTextPreview(
              state.loadedDetailPage.textContent,
              config.textTransformPreviewChars,
            ),
            afterPreview: toTextPreview(cleanedDetailText, config.textTransformPreviewChars),
          },
          'Text transform trace',
        );
      }

      return {
        cleanedDetailText,
        cleanerTelemetry: cleanerResult.telemetry,
      };
    };

    const mergeNode = (
      state: JobParsingGraphStateType,
    ): Pick<JobParsingGraphStateType, 'unifiedJobAd'> => {
      const unifiedJobAd = buildDocument(
        state,
        config.parserVersion,
        config.runId,
        config.crawlRunId,
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
      .addNode('cleanDetailText', cleanDetailTextNode)
      .addNode('extractDetail', extractDetailNode)
      .addNode('merge', mergeNode)
      .addEdge(START, 'loadDetailPage')
      .addEdge('loadDetailPage', 'cleanDetailText')
      .addEdge('cleanDetailText', 'extractDetail')
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
        llmCleanerCallDurationSeconds: structured.ingestion.llmCleanerCallDurationSeconds,
        llmExtractorCallDurationSeconds: structured.ingestion.llmExtractorCallDurationSeconds,
        llmTotalCallDurationSeconds: structured.ingestion.llmTotalCallDurationSeconds,
      },
      'Completed parsing record',
    );

    return structured;
  }
}
