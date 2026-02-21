import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { load, type CheerioAPI } from 'cheerio';

const gzipMagicNumberA = 0x1f;
const gzipMagicNumberB = 0x8b;

const contentBlockSelector = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,pre,td,th';

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

const candidateRootSelectors = [
  'main',
  'article',
  '[role="main"]',
  '[itemprop="description"]',
  '.job-detail',
  '.jobdetail',
  '.job-description',
  '.position-description',
  '.vacancy-detail',
  '.offer-detail',
];

const jobsSectionHeadingPattern = /^pracovn[íi]\s+nab[ií]dka$/i;
const jobsSectionStopPatterns = [
  /^podobn[ée]\s+nab[ií]dky/i,
  /^dal[sš][íi]\s+nab[ií]dky/i,
  /^sd[ií]let\s+nab[ií]dku/i,
  /^ulo[zž]enou?\s+nab[ií]dku/i,
  /^kam\s+v[aá]m\s+m[uů][zž]eme\s+nab[ií]dku/i,
  /^odpov[eě]zte\s+na\s+nab[ií]dku/i,
  /^more\s+jobs/i,
  /^related\s+jobs/i,
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

const lineNoisePatterns = [
  /ulo[zž]enou?\s+nab[ií]dku/i,
  /ulo[zž]en[ée]\s+nab[ií]dky/i,
  /kam\s+v[aá]m\s+m[uů][zž]eme\s+nab[ií]dku/i,
  /pou[zž][íi]v[aá]me\s+soubory\s+cookie/i,
  /cookies?/i,
  /^sign\s+in$/i,
  /^sign\s+up$/i,
  /^menu$/i,
];

const minimumUsefulJobDescriptionChars = 200;

const isGzipBuffer = (buffer: Buffer): boolean =>
  buffer.length >= 2 && buffer[0] === gzipMagicNumberA && buffer[1] === gzipMagicNumberB;

const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

const countPatternHits = (text: string, patterns: RegExp[]): number =>
  patterns.reduce((hits, pattern) => (pattern.test(text) ? hits + 1 : hits), 0);

const pruneNonContentNodes = (dom: CheerioAPI): void => {
  dom(nonContentSelectors.join(',')).remove();
};

const extractLinesFromRoot = (dom: CheerioAPI, selector: string): string[] => {
  const root = dom(selector).first();
  if (root.length === 0) {
    return [];
  }

  const blockElements = root.find(contentBlockSelector).toArray();
  if (blockElements.length > 0) {
    return blockElements
      .map((element) => normalizeWhitespace(dom(element).text()))
      .filter((line) => line.length > 0);
  }

  const fallback = normalizeWhitespace(root.text());
  return fallback.length > 0 ? [fallback] : [];
};

const dedupeConsecutiveLines = (lines: string[]): string[] => {
  const deduped: string[] = [];
  let previousLine: string | null = null;

  for (const line of lines) {
    if (line === previousLine) {
      continue;
    }

    deduped.push(line);
    previousLine = line;
  }

  return deduped;
};

const stripLineNoise = (lines: string[]): string[] =>
  lines.filter((line) => !lineNoisePatterns.some((pattern) => pattern.test(line)));

const toTrimmedText = (lines: string[], maxChars: number): string =>
  lines.join('\n').slice(0, maxChars).trim();

const extractJobsTemplateDescription = (lines: string[], maxChars: number): string | null => {
  const headingIndex = lines.findIndex((line) => jobsSectionHeadingPattern.test(line));
  if (headingIndex < 0) {
    return null;
  }

  const startIndex = Math.min(headingIndex + 1, lines.length);
  let endIndex = lines.length;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && jobsSectionStopPatterns.some((pattern) => pattern.test(line))) {
      endIndex = index;
      break;
    }
  }

  const sectionLines = lines.slice(startIndex, endIndex);
  const text = toTrimmedText(sectionLines, maxChars);
  return text.length >= minimumUsefulJobDescriptionChars ? text : null;
};

const extractDeterministicJobDescription = (rawHtml: string, maxChars: number): string | null => {
  const dom = load(rawHtml);
  pruneNonContentNodes(dom);

  const bodyLines = stripLineNoise(dedupeConsecutiveLines(extractLinesFromRoot(dom, 'body')));
  const jobsTemplateDescription = extractJobsTemplateDescription(bodyLines, maxChars);
  if (jobsTemplateDescription !== null) {
    return jobsTemplateDescription;
  }

  let bestCandidate = '';

  for (const selector of candidateRootSelectors) {
    const candidateLines = stripLineNoise(
      dedupeConsecutiveLines(extractLinesFromRoot(dom, selector)),
    );
    const candidateText = toTrimmedText(candidateLines, maxChars);

    if (candidateText.length > bestCandidate.length) {
      bestCandidate = candidateText;
    }
  }

  if (bestCandidate.length >= minimumUsefulJobDescriptionChars) {
    return bestCandidate;
  }

  const bodyText = toTrimmedText(bodyLines, maxChars);
  return bodyText.length >= minimumUsefulJobDescriptionChars ? bodyText : null;
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
  jobDescriptionSourceText: string | null;
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
  maxDetailChars: number,
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

  const textContent = mergedText.slice(0, maxDetailChars);
  const jobDescriptionSourceText = extractDeterministicJobDescription(rawHtml, maxDetailChars);

  return {
    rawHtml,
    textContent,
    jobDescriptionSourceText,
    htmlSha256,
    wasGzipCompressed,
    fileSizeBytes: fileBuffer.length,
    rawHtmlChars: rawHtml.length,
    textContentChars: textContent.length,
  };
};
