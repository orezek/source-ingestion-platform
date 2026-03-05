import { createHash } from 'node:crypto';

type ListingData = {
  adUrl?: string;
  companyName?: string | null;
  location?: string | null;
  jobTitle?: string | null;
};

export type NormalizeHtmlInput = {
  crawlRunId: string;
  runId: string;
  searchSpaceId: string;
  source: string;
  sourceId: string;
  dedupeKey: string;
  html: string;
  parserVersion: string;
  listing?: ListingData;
};

export type NormalizedJobAdDoc = {
  dedupeKey: string;
  source: string;
  sourceId: string;
  crawlRunId: string;
  ingestion: {
    runId: string;
    searchSpaceId: string;
    parserVersion: string;
    parsedAt: string;
  };
  adUrl: string | null;
  jobTitle: string | null;
  companyName: string | null;
  location: string | null;
  htmlDigestSha256: string;
  textPreview: string;
  textLength: number;
};

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

function inferTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return null;
  }

  const cleaned = match[1].replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeHtml(input: NormalizeHtmlInput): NormalizedJobAdDoc {
  const text = htmlToText(input.html);
  const inferredTitle = inferTitle(input.html);

  return {
    dedupeKey: input.dedupeKey,
    source: input.source,
    sourceId: input.sourceId,
    crawlRunId: input.crawlRunId,
    ingestion: {
      runId: input.runId,
      searchSpaceId: input.searchSpaceId,
      parserVersion: input.parserVersion,
      parsedAt: new Date().toISOString(),
    },
    adUrl: input.listing?.adUrl ?? null,
    jobTitle: input.listing?.jobTitle ?? inferredTitle ?? null,
    companyName: input.listing?.companyName ?? null,
    location: input.listing?.location ?? null,
    htmlDigestSha256: createHash('sha256').update(input.html).digest('hex'),
    textPreview: text.slice(0, 1000),
    textLength: text.length,
  };
}
