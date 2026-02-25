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
    runId: string; // shared run identifier for matching job docs to one run-summary document
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
- `LOG_PRETTY=true` to enable human-readable `pino-pretty` console logs in a TTY terminal (development/local use)
- `GEMINI_API_KEY` for model access
- `LANGSMITH_API_KEY` to authenticate prompt pulls from LangSmith Hub
- `LANGSMITH_PROMPT_NAME` (default `job-ad-extractor`)
- `GEMINI_MODEL` (default `gemini-3-flash-preview`)
- `GEMINI_THINKING_LEVEL` (`LOW`, `MEDIUM`, `HIGH`) to control reasoning depth vs latency
- `DETAIL_PAGE_MIN_RELEVANT_TEXT_CHARS` minimum required relevant text length for processing a detail page
- `GEMINI_INPUT_PRICE_USD_PER_1M_TOKENS` and `GEMINI_OUTPUT_PRICE_USD_PER_1M_TOKENS` for cost estimation
- `INGESTION_CONCURRENCY` to process multiple ads in parallel
- `INGESTION_SAMPLE_SIZE` for cost-controlled test runs (positive integer, `all`, or empty/unset to process all records)
- `ENABLE_MONGO_WRITE=true` + `MONGODB_URI` for Atlas persistence
- `OUTPUT_JSON_PATH` for structured output file
- `CRAWL_RUNS_SUBDIR` for crawl-run local handoff directories under `INPUT_ROOT_DIR` (default `runs`)
- `INGESTION_API_HOST` and `INGESTION_API_PORT` for the Fastify ingestion trigger API
- `MONGODB_JOBS_COLLECTION` for structured document output
- `MONGODB_RUN_SUMMARIES_COLLECTION` for one summary document per ingestion run (linked via `runId`)
- `MONGODB_INGESTION_TRIGGERS_COLLECTION` for idempotent ingestion trigger request state (`source + crawlRunId`)

Default token pricing currently reflects Gemini 3 Flash preview text pricing from Google AI pricing docs.
`rawDetailPage.tokenCountApprox` is a local approximation (`ceil(charCount / 4)`) for quick sizing/cost heuristics.
Detail-page plain text truncation is currently disabled; the full Cheerio-cleaned text is stored and sent downstream.

When Mongo persistence is enabled, each run writes:

- job documents to `MONGODB_JOBS_COLLECTION` with `ingestion.runId`
- one run-summary document to `MONGODB_RUN_SUMMARIES_COLLECTION` with the same `runId`

## Run

CLI (existing batch mode):

```bash
pnpm -C apps/job-ingestion-service dev
```

Fastify API (idempotent crawl-run trigger endpoint):

```bash
pnpm -C apps/job-ingestion-service dev-server
```

Start endpoint:

- `POST /ingestion/start`
- body: `{ "source": "jobs.cz", "crawlRunId": "<crawl-run-id>" }`
- behavior: idempotent by `source + crawlRunId`
- input source (MVP): local crawl artifacts in `INPUT_ROOT_DIR/<CRAWL_RUNS_SUBDIR>/<crawlRunId>/`
  - expected files: `dataset.json` and `records/*.html`

Trigger states are persisted to `MONGODB_INGESTION_TRIGGERS_COLLECTION` and return `running`, `succeeded`, `completed_with_errors`, or `failed`.

## Validate

```bash
pnpm -C apps/job-ingestion-service lint
pnpm -C apps/job-ingestion-service check-types
pnpm -C apps/job-ingestion-service build
```
