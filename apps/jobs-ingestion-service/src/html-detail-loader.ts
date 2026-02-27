import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { load, type CheerioAPI } from 'cheerio';

const gzipMagicNumberA = 0x1f;
const gzipMagicNumberB = 0x8b;

const nonContentSelectors = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'nav',
  'header',
  'footer',
  'form',
  'button',
  'input',
  'textarea',
  'select',
  'aside',
  '.cookie',
  '.cookies',
  '.consent',
  '.breadcrumb',
  '.breadcrumbs',
  '.social',
  '.share',
  '[role="navigation"]',
  '[aria-label*="cookie" i]',
];

const minimumDetailWords = 100;
const minimumDetailSignalToNoiseRatio = 0.2;

const primaryJobContentContainerSelectors = [
  '.cp-detail.text-content',
  '.cp-detail__content',
  '#capybara-position-detail',
  'article#capybara-position-detail',
  '.job-detail__description',
  '.job-detail__content',
  '.job-detail',
  '.m-detail__content',
  '.m-detail',
] as const;

const detailSignalPatterns = [
  /pracovn[íi]\s+nab[ií]dka/i,
  /n[aá]pl[nň]\s+pr[aá]ce/i,
  /po[zž]adavky/i,
  /co\s+v[aá]s\s+[čc]ek[aá]/i,
  /co\s+nab[ií]z[ií]me/i,
  /odpov[eě]dnosti/i,
  /benefity/i,
  /responsibilities/i,
  /requirements/i,
  /about\s+the\s+role/i,
  /what\s+you(?:'|’)ll\s+do/i,
];

const noiseSignalPatterns = [
  /alma\s+career\s+czechia/i,
  /vizu[aá]ln[íi]\s+podoba\s+webov[eé]/i,
  /autorsk[ýy]ch?\s+pr[aá]v/i,
  /kdy[zž]\s+l[eé]pe\s+pochop[ií]me,\s+co\s+v[aá]s\s+zaj[ií]m[aá]/i,
  /odpov[eě]di\s+jsou\s+anonymn[íi]/i,
  /cookies?/i,
];

const isGzipBuffer = (buffer: Buffer): boolean =>
  buffer.length >= 2 && buffer[0] === gzipMagicNumberA && buffer[1] === gzipMagicNumberB;

const normalizeTextPreservingLineBreaks = (input: string): string =>
  input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const addReadableBreakHints = (selection: ReturnType<CheerioAPI>): void => {
  selection.find('br').replaceWith('\n');
  selection.find('p').prepend('\n').append('\n');
  selection.find('li').prepend('\n- ').append('\n');
};

const extractReadableText = (selection: ReturnType<CheerioAPI>): string => {
  const clonedSelection = selection.clone();
  addReadableBreakHints(clonedSelection);

  return normalizeTextPreservingLineBreaks(clonedSelection.text());
};

const countPatternHits = (text: string, patterns: RegExp[]): number =>
  patterns.reduce((hits, pattern) => (pattern.test(text) ? hits + 1 : hits), 0);

const pruneNonContentNodes = (dom: CheerioAPI): void => {
  dom(nonContentSelectors.join(',')).remove();
};

const countWords = (text: string): number =>
  text.length > 0 ? text.trim().split(/\s+/).length : 0;

type PrimaryJobContentContainerMatch = {
  selector: (typeof primaryJobContentContainerSelectors)[number];
  text: string;
  chars: number;
  words: number;
};

const findPrimaryJobContentContainer = (
  dom: CheerioAPI,
): PrimaryJobContentContainerMatch | null => {
  const selectorPriority = new Map(
    primaryJobContentContainerSelectors.map((selector, index) => [selector, index] as const),
  );
  const seenNodes = new Set<unknown>();
  let bestMatch: PrimaryJobContentContainerMatch | null = null;

  for (const selector of primaryJobContentContainerSelectors) {
    dom(selector).each((_, elementNode) => {
      if (seenNodes.has(elementNode)) {
        return;
      }
      seenNodes.add(elementNode);

      const element = dom(elementNode);
      const text = extractReadableText(element);
      if (text.length === 0) {
        return;
      }

      const words = countWords(text);
      const candidate: PrimaryJobContentContainerMatch = {
        selector,
        text,
        chars: text.length,
        words,
      };

      if (bestMatch === null) {
        bestMatch = candidate;
        return;
      }

      const candidatePriority = selectorPriority.get(candidate.selector) ?? Number.MAX_SAFE_INTEGER;
      const bestPriority = selectorPriority.get(bestMatch.selector) ?? Number.MAX_SAFE_INTEGER;

      const isBetter =
        candidate.chars > bestMatch.chars ||
        (candidate.chars === bestMatch.chars && candidate.words > bestMatch.words) ||
        (candidate.chars === bestMatch.chars &&
          candidate.words === bestMatch.words &&
          candidatePriority < bestPriority);

      if (isBetter) {
        bestMatch = candidate;
      }
    });
  }

  return bestMatch;
};

const bufferToUtf8 = (buffer: Buffer): string => {
  if (isGzipBuffer(buffer)) {
    return gunzipSync(buffer).toString('utf8');
  }

  return buffer.toString('utf8');
};

type DecodedDetailHtmlFile = {
  rawHtml: string;
  htmlSha256: string;
  wasGzipCompressed: boolean;
  fileSizeBytes: number;
  rawHtmlChars: number;
};

type DetailPageTextAnalysis = {
  mergedText: string;
  plainTextWords: number;
  primaryJobContentContainer: PrimaryJobContentContainerMatch | null;
  detailSignalHits: number;
  noiseSignalHits: number;
  qualitySignals: DetailPageQualitySignals;
};

export type LoadedDetailPage = {
  rawHtml: string;
  textContent: string;
  htmlSha256: string;
  wasGzipCompressed: boolean;
  fileSizeBytes: number;
  rawHtmlChars: number;
  textContentChars: number;
};

export type DetailPageQualitySignals = {
  plainTextChars: number;
  plainTextWords: number;
  hasPrimaryJobContentContainer: boolean;
  primaryJobContentContainerSelector: string | null;
  primaryJobContentChars: number;
  primaryJobContentWords: number;
  detailSignalHits: number;
  noiseSignalHits: number;
};

export class IncompleteDetailPageError extends Error {
  readonly detailHtmlPath: string;

  readonly qualitySignals: DetailPageQualitySignals;

  constructor(detailHtmlPath: string, reason: string, qualitySignals: DetailPageQualitySignals) {
    super(`Incomplete detail page "${detailHtmlPath}": ${reason}`);
    this.name = 'IncompleteDetailPageError';
    this.detailHtmlPath = detailHtmlPath;
    this.qualitySignals = qualitySignals;
  }
}

const decodeDetailHtmlFile = async (detailHtmlPath: string): Promise<DecodedDetailHtmlFile> => {
  await access(detailHtmlPath);

  const fileBuffer = await readFile(detailHtmlPath);
  const wasGzipCompressed = isGzipBuffer(fileBuffer);
  const rawHtml = bufferToUtf8(fileBuffer);
  const htmlSha256 = createHash('sha256').update(rawHtml, 'utf8').digest('hex');

  return {
    rawHtml,
    htmlSha256,
    wasGzipCompressed,
    fileSizeBytes: fileBuffer.length,
    rawHtmlChars: rawHtml.length,
  };
};

const analyzeDetailPageText = (rawHtml: string): DetailPageTextAnalysis => {
  const dom = load(rawHtml);
  pruneNonContentNodes(dom);

  const mergedText = extractReadableText(dom('body'));
  const plainTextWords = countWords(mergedText);
  const primaryJobContentContainer = findPrimaryJobContentContainer(dom);
  const detailSignalHits = countPatternHits(mergedText, detailSignalPatterns);
  const noiseSignalHits = countPatternHits(mergedText, noiseSignalPatterns);

  const qualitySignals: DetailPageQualitySignals = {
    plainTextChars: mergedText.length,
    plainTextWords,
    hasPrimaryJobContentContainer: primaryJobContentContainer !== null,
    primaryJobContentContainerSelector: primaryJobContentContainer?.selector ?? null,
    primaryJobContentChars: primaryJobContentContainer?.chars ?? 0,
    primaryJobContentWords: primaryJobContentContainer?.words ?? 0,
    detailSignalHits,
    noiseSignalHits,
  };

  return {
    mergedText,
    plainTextWords,
    primaryJobContentContainer,
    detailSignalHits,
    noiseSignalHits,
    qualitySignals,
  };
};

const assertMinimumWholePageText = (
  detailHtmlPath: string,
  minRelevantTextChars: number,
  analysis: DetailPageTextAnalysis,
): void => {
  if (analysis.mergedText.length < minRelevantTextChars) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `plain text length ${analysis.mergedText.length} is below minimum ${minRelevantTextChars}`,
      analysis.qualitySignals,
    );
  }

  if (analysis.plainTextWords < minimumDetailWords) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `plain text word count ${analysis.plainTextWords} is below minimum ${minimumDetailWords}`,
      analysis.qualitySignals,
    );
  }
};

const assertPrimaryJobContentContainerSufficient = (
  detailHtmlPath: string,
  minRelevantTextChars: number,
  primaryJobContentContainer: PrimaryJobContentContainerMatch,
  qualitySignals: DetailPageQualitySignals,
): void => {
  if (primaryJobContentContainer.chars < minRelevantTextChars) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `primary job content container "${primaryJobContentContainer.selector}" text length ${primaryJobContentContainer.chars} is below minimum ${minRelevantTextChars}`,
      qualitySignals,
    );
  }

  if (primaryJobContentContainer.words < minimumDetailWords) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `primary job content container "${primaryJobContentContainer.selector}" word count ${primaryJobContentContainer.words} is below minimum ${minimumDetailWords}`,
      qualitySignals,
    );
  }
};

const assertFallbackHeuristicCompleteness = (
  detailHtmlPath: string,
  analysis: DetailPageTextAnalysis,
): void => {
  if (analysis.detailSignalHits === 0 && analysis.noiseSignalHits > 0) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      'page contains noise/legal signals but no job-detail signals',
      analysis.qualitySignals,
    );
  }

  const detailToNoiseRatio = analysis.detailSignalHits / (analysis.noiseSignalHits + 1);
  if (analysis.noiseSignalHits >= 4 && detailToNoiseRatio < minimumDetailSignalToNoiseRatio) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `job-detail signal ratio ${detailToNoiseRatio.toFixed(3)} is below minimum ${minimumDetailSignalToNoiseRatio} for noise-heavy page`,
      analysis.qualitySignals,
    );
  }
};

const buildLoadedDetailPage = (
  decodedFile: DecodedDetailHtmlFile,
  textContent: string,
): LoadedDetailPage => ({
  rawHtml: decodedFile.rawHtml,
  textContent,
  htmlSha256: decodedFile.htmlSha256,
  wasGzipCompressed: decodedFile.wasGzipCompressed,
  fileSizeBytes: decodedFile.fileSizeBytes,
  rawHtmlChars: decodedFile.rawHtmlChars,
  textContentChars: textContent.length,
});

export const loadDetailPage = async (
  detailHtmlPath: string,
  minRelevantTextChars: number,
): Promise<LoadedDetailPage> => {
  const decodedFile = await decodeDetailHtmlFile(detailHtmlPath);
  const analysis = analyzeDetailPageText(decodedFile.rawHtml);

  assertMinimumWholePageText(detailHtmlPath, minRelevantTextChars, analysis);

  if (analysis.primaryJobContentContainer !== null) {
    assertPrimaryJobContentContainerSufficient(
      detailHtmlPath,
      minRelevantTextChars,
      analysis.primaryJobContentContainer,
      analysis.qualitySignals,
    );

    // Prefer the best primary content container text to reduce cookie/legal/footer noise
    // while keeping the raw HTML dump for auditing and reprocessing.
    return buildLoadedDetailPage(decodedFile, analysis.primaryJobContentContainer.text);
  }

  assertFallbackHeuristicCompleteness(detailHtmlPath, analysis);

  return buildLoadedDetailPage(decodedFile, analysis.mergedText);
};
