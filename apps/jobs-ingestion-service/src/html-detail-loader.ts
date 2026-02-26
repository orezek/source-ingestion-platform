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

const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

const countPatternHits = (text: string, patterns: RegExp[]): number =>
  patterns.reduce((hits, pattern) => (pattern.test(text) ? hits + 1 : hits), 0);

const pruneNonContentNodes = (dom: CheerioAPI): void => {
  dom(nonContentSelectors.join(',')).remove();
};

const bufferToUtf8 = (buffer: Buffer): string => {
  if (isGzipBuffer(buffer)) {
    return gunzipSync(buffer).toString('utf8');
  }

  return buffer.toString('utf8');
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

export const loadDetailPage = async (
  detailHtmlPath: string,
  minRelevantTextChars: number,
): Promise<LoadedDetailPage> => {
  await access(detailHtmlPath);

  const fileBuffer = await readFile(detailHtmlPath);
  const wasGzipCompressed = isGzipBuffer(fileBuffer);
  const rawHtml = bufferToUtf8(fileBuffer);
  const htmlSha256 = createHash('sha256').update(rawHtml, 'utf8').digest('hex');

  const dom = load(rawHtml);
  pruneNonContentNodes(dom);

  const mergedText = normalizeWhitespace(dom('body').text());
  const plainTextWords = mergedText.length > 0 ? mergedText.split(' ').length : 0;
  const detailSignalHits = countPatternHits(mergedText, detailSignalPatterns);
  const noiseSignalHits = countPatternHits(mergedText, noiseSignalPatterns);

  const qualitySignals: DetailPageQualitySignals = {
    plainTextChars: mergedText.length,
    plainTextWords,
    detailSignalHits,
    noiseSignalHits,
  };

  if (mergedText.length < minRelevantTextChars) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `plain text length ${mergedText.length} is below minimum ${minRelevantTextChars}`,
      qualitySignals,
    );
  }

  if (plainTextWords < minimumDetailWords) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `plain text word count ${plainTextWords} is below minimum ${minimumDetailWords}`,
      qualitySignals,
    );
  }

  if (detailSignalHits === 0 && noiseSignalHits > 0) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      'page contains noise/legal signals but no job-detail signals',
      qualitySignals,
    );
  }

  const detailToNoiseRatio = detailSignalHits / (noiseSignalHits + 1);
  if (noiseSignalHits >= 4 && detailToNoiseRatio < minimumDetailSignalToNoiseRatio) {
    throw new IncompleteDetailPageError(
      detailHtmlPath,
      `job-detail signal ratio ${detailToNoiseRatio.toFixed(3)} is below minimum ${minimumDetailSignalToNoiseRatio} for noise-heavy page`,
      qualitySignals,
    );
  }

  const textContent = mergedText;

  return {
    rawHtml,
    textContent,
    htmlSha256,
    wasGzipCompressed,
    fileSizeBytes: fileBuffer.length,
    rawHtmlChars: rawHtml.length,
    textContentChars: textContent.length,
  };
};
