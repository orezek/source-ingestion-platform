# Job Ingestion Service

`job-ingestion-service` parses scraped job listing records + corresponding detail HTML pages into a single unified JobCompass schema.

The parser currently supports this local input layout at app root:

```text
scrapped_jobs/
  *.json
  records/
    *.html   # gzip-compressed HTML is supported
```

## LangGraph Pipeline

The parser is implemented with `@langchain/langgraph` and runs these nodes per record:

1. `loadDetailPage`: reads `htmlDetailPageKey`, handles gzip, builds cleaned plain text with Cheerio, and checks page completeness.
2. `extractDetail`: pulls `job-ad-extractor` from LangSmith Hub (`langchain/hub/node`) and runs Gemini structured extraction with the Zod schema using listing context + detail text.
   - `seniorityLevel` is inferred from whole ad context when not explicitly stated.
3. `merge`: merges listing + detail into one Zod-validated structured document.

`loadDetailPage` now includes a completeness gate. If the details page does not contain enough relevant ad content, the ad is skipped entirely.

This is designed to be template-agnostic, so both jobs.cz detail pages and custom client pages can map into the same schema.
Set `LOG_LEVEL=debug` to see per-step logs for file loading, LLM extraction, merge, and persistence.

## Proposed Unified Schema Shape

The final schema is defined in `src/schema.ts` as `unifiedJobAdSchema`.

High-level shape:

```ts
{
  id: string; // "${source}:${sourceId}"
  source: string;
  sourceId: string;
  adUrl: string;
  htmlDetailPageKey: string;
  scrapedAt: string;
  listing: {
    jobTitle: string;
    companyName: string | null;
    locationText: string | null;
    salaryText: string | null;
    publishedInfoText: string | null;
  };
  detail: {
    canonicalTitle: string | null;
    seniorityLevel: "medior" | "senior" | "junior" | "absolvent" | null;
    employmentTypes: ("full-time" | "part-time" | "contract" | "freelance" | "internship" | "temporary" | "other")[];
    workModes: ("onsite" | "hybrid" | "remote" | "unknown")[];
    locations: { city: string | null; region: string | null; country: string | null; addressText: string | null }[];
    salary: {
      min: number | null;
      max: number | null;
      currency: string | null;
      period: "hour" | "day" | "month" | "year" | "project" | "unknown";
      inferred: boolean;
    };
    languageRequirements: { language: string; level: string | null }[];
    techStack: string[];
    travelRequirements: string | null;
    startDateText: string | null;
    applicationDeadlineText: string | null;
    applyUrl: string | null;
    recruiterContacts: {
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
    };
    responsibilities: string[];
    requirements: string[];
    niceToHave: string[];
    benefits: string[];
    hiringProcess: string[];
    summary: string | null; // derived deterministically from extracted fields + listing context
    jobDescription: string | null;
    companyDescription: string | null;
  };
  rawDetailPage: {
    text: string; // Cheerio-cleaned plain text from the details page (same source used for LLM input)
    charCount: number; // stored text length (full cleaned text)
    tokenCountApprox: number; // estimated as ceil(charCount / 4)
    tokenCountMethod: "chars_div_4";
  };
  ingestion: {
    datasetFileName: string;
    datasetRecordIndex: number;
    detailHtmlPath: string;
    detailHtmlSha256: string;
    extractorModel: string;
    extractedAt: string;
    parserVersion: string;
    timeToProcssSeconds: number;
    llmCallDurationSeconds: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmTotalTokens: number;
    llmInputCostUsd: number;
    llmOutputCostUsd: number;
    llmTotalCostUsd: number;
  };
}
```

## Environment

Copy `.env.example` to `.env` and configure:

- `LOG_LEVEL` for structured pino logs (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`)
- `GEMINI_API_KEY` for model access
- `LANGSMITH_API_KEY` to authenticate prompt pulls from LangSmith Hub
- `LANGSMITH_PROMPT_NAME` (default `job-ad-extractor`)
- `GEMINI_MODEL` (default `gemini-3-flash-preview`)
- `GEMINI_THINKING_LEVEL` (`LOW`, `MEDIUM`, `HIGH`) to control reasoning depth vs latency
- `DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS` minimum required relevant text length for processing a detail page
- `GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS` and `GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS` for cost estimation
- `INGESTION_CONCURRENCY` to process multiple ads in parallel
- `INGESTION_SAMPLE_SIZE` for cost-controlled test runs
- `ENABLE_MONGO_WRITE=true` + `MONGODB_URI` for Atlas persistence
- `OUTPUT_JSON_PATH` for structured output file
- `MONGODB_JOBS_COLLECTION` for structured document output

Default token pricing currently reflects Gemini 3 Flash preview text pricing from Google AI pricing docs.
`rawDetailPage.tokenCountApprox` is a local approximation (`ceil(charCount / 4)`) for quick sizing/cost heuristics.
Detail-page plain text truncation is currently disabled; the full Cheerio-cleaned text is stored and sent downstream.

## Run

```bash
pnpm -C apps/job-ingestion-service dev
```

## Validate

```bash
pnpm -C apps/job-ingestion-service lint
pnpm -C apps/job-ingestion-service check-types
pnpm -C apps/job-ingestion-service build
```
