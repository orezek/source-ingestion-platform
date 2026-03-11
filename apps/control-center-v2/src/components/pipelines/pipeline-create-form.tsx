'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ControlPlanePipeline } from '@/lib/contracts';
import {
  CRAWLER_MAX_CONCURRENCY_MAX,
  CRAWLER_MAX_CONCURRENCY_MIN,
  CRAWLER_RPM_MAX,
  CRAWLER_RPM_MIN,
  INGESTION_CONCURRENCY_MAX,
  INGESTION_CONCURRENCY_MIN,
  MAX_ITEMS_MAX,
  MAX_ITEMS_MIN,
  MONGO_DB_NAME_MAX_BYTES,
  PIPELINE_NAME_MAX_LENGTH,
  buildCreatePipelinePayload,
  pipelineCreateFormSchema,
  type PipelineCreateFormData,
  type PipelineCreateFormValues,
} from '@/lib/forms';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const defaultValues: PipelineCreateFormValues = {
  name: '',
  source: 'jobs.cz',
  mode: 'crawl_and_ingest',
  searchSpaceName: '',
  searchSpaceDescription: '',
  startUrlsText: '',
  maxItems: 200,
  allowInactiveMarking: true,
  runtimeProfileName: '',
  crawlerMaxConcurrency: 3,
  crawlerMaxRequestsPerMinute: 60,
  ingestionConcurrency: 4,
  includeMongoOutput: true,
  includeDownloadableJson: false,
  operatorMongoUri: '',
  operatorDbName: '',
};

export function PipelineCreateForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const form = useForm<PipelineCreateFormValues, undefined, PipelineCreateFormData>({
    resolver: zodResolver(pipelineCreateFormSchema),
    defaultValues,
  });

  const mode = form.watch('mode');
  const includeMongoOutput = form.watch('includeMongoOutput');
  const canEditInactiveMarking = mode === 'crawl_and_ingest' && includeMongoOutput;

  const submit = form.handleSubmit(async (values) => {
    setErrorMessage(null);
    const payload = buildCreatePipelinePayload(values);
    const response = await fetch('/api/pipelines', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMessage(errorPayload?.error?.message ?? 'Unable to create pipeline.');
      return;
    }

    const pipeline = (await response.json()) as ControlPlanePipeline;
    router.push(`/pipelines/${pipeline.pipelineId}`);
    router.refresh();
  });

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Create Pipeline</CardTitle>
          <CardDescription>
            Freeze the pipeline-owned execution snapshot in one flow.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Pipeline Name" error={form.formState.errors.name?.message}>
            <Input
              {...form.register('name')}
              maxLength={PIPELINE_NAME_MAX_LENGTH}
              placeholder="Prague Tech Pipeline"
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Source" error={form.formState.errors.source?.message}>
              <Input {...form.register('source')} />
            </Field>
            <Field label="Mode" error={form.formState.errors.mode?.message}>
              <select
                className="flex h-11 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...form.register('mode')}
              >
                <option value="crawl_and_ingest">Crawl And Ingest</option>
                <option value="crawl_only">Crawl Only</option>
              </select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search Space</CardTitle>
          <CardDescription>Pipeline-owned crawl scope.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Search Space Name" error={form.formState.errors.searchSpaceName?.message}>
            <Input {...form.register('searchSpaceName')} placeholder="Prague Tech Jobs" />
          </Field>
          <Field label="Description" error={form.formState.errors.searchSpaceDescription?.message}>
            <Textarea {...form.register('searchSpaceDescription')} rows={3} />
          </Field>
          <Field label="Start URLs" error={form.formState.errors.startUrlsText?.message}>
            <Textarea
              {...form.register('startUrlsText')}
              rows={5}
              placeholder={
                'https://www.jobs.cz/prace/praha/?q=software\nhttps://www.jobs.cz/prace/praha/?q=data'
              }
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-[minmax(0,240px),1fr] md:items-end">
            <Field label="Max Items" error={form.formState.errors.maxItems?.message}>
              <Input
                type="number"
                min={MAX_ITEMS_MIN}
                max={MAX_ITEMS_MAX}
                {...form.register('maxItems', { valueAsNumber: true })}
              />
            </Field>
            <CheckboxField
              label="Allow inactive marking"
              disabled={!canEditInactiveMarking}
              {...form.register('allowInactiveMarking')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runtime Profile</CardTitle>
          <CardDescription>Snapshot the crawler and ingestion operating profile.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field
            label="Runtime Profile Name"
            error={form.formState.errors.runtimeProfileName?.message}
          >
            <Input {...form.register('runtimeProfileName')} placeholder="Prague Tech Runtime" />
          </Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="Crawler Max Concurrency"
              error={form.formState.errors.crawlerMaxConcurrency?.message}
            >
              <Input
                type="number"
                min={CRAWLER_MAX_CONCURRENCY_MIN}
                max={CRAWLER_MAX_CONCURRENCY_MAX}
                {...form.register('crawlerMaxConcurrency', { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Crawler RPM"
              error={form.formState.errors.crawlerMaxRequestsPerMinute?.message}
            >
              <Input
                type="number"
                min={CRAWLER_RPM_MIN}
                max={CRAWLER_RPM_MAX}
                {...form.register('crawlerMaxRequestsPerMinute', { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Ingestion Concurrency"
              error={form.formState.errors.ingestionConcurrency?.message}
            >
              <Input
                type="number"
                min={INGESTION_CONCURRENCY_MIN}
                max={INGESTION_CONCURRENCY_MAX}
                disabled={mode === 'crawl_only'}
                {...form.register('ingestionConcurrency', { valueAsNumber: true })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Structured Output</CardTitle>
          <CardDescription>
            Choose output sinks for the pipeline snapshot. Mongo sink options are configurable only
            when MongoDB output is selected.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <CheckboxField
            label="MongoDB"
            disabled={mode === 'crawl_only'}
            {...form.register('includeMongoOutput')}
          />
          <CheckboxField
            label="Downloadable JSON"
            disabled={mode === 'crawl_only'}
            {...form.register('includeDownloadableJson')}
          />

          {includeMongoOutput ? (
            <div className="mt-1 grid gap-4 rounded-sm border border-border bg-card/40 p-4">
              <Field label="MongoDB URI" error={form.formState.errors.operatorMongoUri?.message}>
                <Input
                  {...form.register('operatorMongoUri')}
                  autoComplete="off"
                  inputMode="url"
                  pattern="^mongodb(\\+srv)?:\\/\\/.+"
                  placeholder="mongodb+srv://cluster.example.net"
                />
              </Field>
              <Field label="Database Name" error={form.formState.errors.operatorDbName?.message}>
                <Input
                  {...form.register('operatorDbName')}
                  maxLength={MONGO_DB_NAME_MAX_BYTES}
                  pattern="[A-Za-z0-9_-]+"
                  placeholder="pl-prague-tech-01"
                />
              </Field>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {errorMessage ? <p className="text-sm text-destructive-foreground">{errorMessage}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Creating' : 'Create Pipeline'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm text-foreground">
      <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
      {error ? <span className="text-xs text-destructive-foreground">{error}</span> : null}
    </label>
  );
}

function CheckboxField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-sm border border-border px-3 py-3 text-sm text-foreground">
      <input className="h-4 w-4 accent-primary" type="checkbox" {...props} />
      <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
    </label>
  );
}
