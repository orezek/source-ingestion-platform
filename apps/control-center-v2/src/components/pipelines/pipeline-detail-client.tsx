'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EmptyLabTray } from '@/components/state/empty-lab-tray';
import { StatusBadge } from '@/components/state/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ControlPlanePipeline, ControlPlaneRun } from '@/lib/contracts';
import {
  buildUpdatePipelinePayload,
  pipelineUpdateFormSchema,
  type PipelineUpdateFormData,
  type PipelineUpdateFormValues,
} from '@/lib/forms';
import { upsertRun, useControlStream } from '@/lib/live';
import { cn, formatDateTime } from '@/lib/utils';
import { useForm } from 'react-hook-form';

type EditablePipelineDraft = {
  draft: PipelineUpdateFormValues;
};

const activeRunStatuses = new Set(['queued', 'running']);
const DELETE_STATUS_POLL_INTERVAL_MS = 1_000;
const DELETE_STATUS_POLL_MAX_ATTEMPTS = 90;

function createInitialDraft(pipeline: ControlPlanePipeline): EditablePipelineDraft {
  return {
    draft: {
      name: pipeline.name,
      mode: pipeline.mode,
      searchSpaceName: pipeline.searchSpace.name,
      searchSpaceDescription: pipeline.searchSpace.description,
      startUrlsText: pipeline.searchSpace.startUrls.join('\n'),
      maxItems: pipeline.searchSpace.maxItems,
      allowInactiveMarking: pipeline.searchSpace.allowInactiveMarking,
      runtimeProfileName: pipeline.runtimeProfile.name,
      crawlerMaxConcurrency: pipeline.runtimeProfile.crawlerMaxConcurrency,
      crawlerMaxRequestsPerMinute: pipeline.runtimeProfile.crawlerMaxRequestsPerMinute,
      ingestionConcurrency: pipeline.runtimeProfile.ingestionConcurrency,
      includeMongoOutput: pipeline.structuredOutput.destinations.some(
        (destination) => destination.type === 'mongodb',
      ),
      includeDownloadableJson: pipeline.structuredOutput.destinations.some(
        (destination) => destination.type === 'downloadable_json',
      ),
      operatorMongoUri: '',
      operatorDbName: pipeline.operatorSink.dbName,
    },
  };
}

export function PipelineDetailClient({
  pipeline,
  initialRuns,
}: {
  pipeline: ControlPlanePipeline;
  initialRuns: ControlPlaneRun[];
}) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [editSnapshot, setEditSnapshot] = useState<EditablePipelineDraft | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const deleteDialogContentId = `pipeline-delete-dialog-${pipeline.pipelineId}`;
  const initialDraft = useMemo(() => createInitialDraft(pipeline).draft, [pipeline]);
  const form = useForm<PipelineUpdateFormValues, undefined, PipelineUpdateFormData>({
    resolver: zodResolver(pipelineUpdateFormSchema),
    defaultValues: initialDraft,
    mode: 'onTouched',
    reValidateMode: 'onChange',
  });
  useControlStream({
    pipelineId: pipeline.pipelineId,
    onRunUpserted: (run) => {
      if (run.pipelineId === pipeline.pipelineId) {
        setRuns((current) => upsertRun(current, run));
      }
    },
  });

  const watchedName = form.watch('name');
  const watchedMode = form.watch('mode');
  const watchedIncludeMongoOutput = form.watch('includeMongoOutput');
  const hasActiveRun = useMemo(() => runs.some((run) => activeRunStatuses.has(run.status)), [runs]);
  const canEditInactiveMarking = watchedMode === 'crawl_and_ingest' && watchedIncludeMongoOutput;
  const configInputsDisabled = !isEditing || hasActiveRun || deletePending || savePending;
  const sinkInputsDisabled = !isEditing || hasActiveRun || deletePending || savePending;

  const startEditing = () => {
    setEditSnapshot({
      draft: form.getValues(),
    });
    setErrorMessage(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    const snapshot = editSnapshot ?? createInitialDraft(pipeline);
    form.reset(snapshot.draft);
    setEditSnapshot(null);
    setErrorMessage(null);
    setIsEditing(false);
  };

  const onSubmit = async (values: PipelineUpdateFormData) => {
    if (!isEditing) {
      return;
    }

    setErrorMessage(null);
    const payload = buildUpdatePipelinePayload(values);
    setSavePending(true);
    const response = await fetch(`/api/pipelines/${pipeline.pipelineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSavePending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMessage(payload?.error?.message ?? 'Unable to update pipeline configuration.');
      return;
    }

    const updatedPipeline = (await response.json()) as ControlPlanePipeline;
    form.reset(createInitialDraft(updatedPipeline).draft);
    setEditSnapshot(null);
    setIsEditing(false);
    router.refresh();
  };

  const startRun = async () => {
    setStartPending(true);
    setErrorMessage(null);
    const response = await fetch(`/api/pipelines/${pipeline.pipelineId}/runs`, { method: 'POST' });
    setStartPending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMessage(payload?.error?.message ?? 'Unable to start run.');
      return;
    }

    const payload = (await response.json()) as { runId: string };
    router.push(`/runs/${payload.runId}`);
    router.refresh();
  };

  const pollDeleteStatus = async (): Promise<'deleted' | 'delete_failed'> => {
    for (let attempt = 0; attempt < DELETE_STATUS_POLL_MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(`/api/pipelines/${pipeline.pipelineId}/delete-status`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? 'Unable to fetch pipeline delete status.');
      }

      const payload = (await response.json()) as {
        status: 'deleting' | 'deleted' | 'delete_failed';
        lastError?: { message?: string };
      };

      if (payload.status === 'deleted') {
        return 'deleted';
      }
      if (payload.status === 'delete_failed') {
        throw new Error(payload.lastError?.message ?? 'Pipeline delete job failed.');
      }

      await new Promise((resolve) => {
        setTimeout(resolve, DELETE_STATUS_POLL_INTERVAL_MS);
      });
    }

    throw new Error('Pipeline delete status polling timed out.');
  };

  const deletePipeline = async () => {
    setDeletePending(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/pipelines/${pipeline.pipelineId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? 'Unable to delete pipeline.');
      }

      await pollDeleteStatus();
      router.push('/pipelines');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Pipeline delete failed.');
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline Detail
          </p>
          <h2 className="text-2xl font-semibold tracking-tightest">{watchedName}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {pipeline.pipelineId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isEditing ? null : (
            <>
              <Button
                variant="secondary"
                onClick={startEditing}
                disabled={deletePending || hasActiveRun || startPending || savePending}
              >
                Edit Pipeline
              </Button>
              <Button onClick={startRun} disabled={startPending || deletePending || hasActiveRun}>
                {startPending ? 'Starting' : 'Start Run'}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild aria-controls={deleteDialogContentId}>
                  <Button variant="danger" disabled={deletePending || hasActiveRun}>
                    {deletePending ? 'Deleting' : 'Delete Pipeline'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent id={deleteDialogContentId}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this pipeline?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This operation permanently deletes pipeline metadata, run history, sink data,
                      and artifacts. The action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Pipeline</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={deletePipeline}
                      disabled={deletePending || hasActiveRun}
                    >
                      {deletePending ? 'Deleting' : 'Delete Pipeline'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      {hasActiveRun ? (
        <p className="text-sm text-muted-foreground">
          Pipeline editing is disabled while a run is active. Cancel and drain the active run first.
        </p>
      ) : null}
      {deletePending ? (
        <p className="text-sm text-muted-foreground">
          Pipeline delete job is running. You will be redirected once deletion is complete.
        </p>
      ) : null}
      {errorMessage ? (
        <p className="text-xs font-medium text-red-500 leading-relaxed">{errorMessage}</p>
      ) : null}

      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                  <CardTitle>Pipeline</CardTitle>
                  <CardDescription>Editable pipeline identity and execution mode.</CardDescription>
                </div>
                <StatusBadge status={pipeline.status} />
              </CardHeader>
              <CardContent className="grid gap-6">
                <Field label="Display Name" error={form.formState.errors.name?.message}>
                  <Input {...form.register('name')} disabled={configInputsDisabled} />
                </Field>
                <Field label="Mode" error={form.formState.errors.mode?.message}>
                  <select
                    className="flex h-11 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    {...form.register('mode')}
                    disabled={configInputsDisabled}
                  >
                    <option value="crawl_and_ingest">Crawl And Ingest</option>
                    <option value="crawl_only">Crawl Only</option>
                  </select>
                </Field>
                <Field label="Source">
                  <Input value={pipeline.source} disabled />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Search Space</CardTitle>
                <CardDescription>Editable crawl scope and inactive marking policy.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                <Field label="Name" error={form.formState.errors.searchSpaceName?.message}>
                  <Input {...form.register('searchSpaceName')} disabled={configInputsDisabled} />
                </Field>
                <Field
                  label="Description"
                  error={form.formState.errors.searchSpaceDescription?.message}
                >
                  <Textarea
                    rows={3}
                    {...form.register('searchSpaceDescription')}
                    disabled={configInputsDisabled}
                  />
                </Field>
                <Field
                  label="Start URLs (one per line)"
                  error={form.formState.errors.startUrlsText?.message}
                >
                  <Textarea
                    rows={4}
                    {...form.register('startUrlsText')}
                    disabled={configInputsDisabled}
                  />
                </Field>
                <div className="grid grid-cols-1 gap-6 items-start md:grid-cols-2">
                  <Field label="Max Items" error={form.formState.errors.maxItems?.message}>
                    <Input
                      type="number"
                      {...form.register('maxItems', { valueAsNumber: true })}
                      disabled={configInputsDisabled}
                    />
                  </Field>
                  <div className="md:pt-[2.25rem]">
                    <CheckboxField
                      label="Allow inactive marking"
                      {...form.register('allowInactiveMarking')}
                      disabled={
                        !isEditing || !canEditInactiveMarking || hasActiveRun || deletePending
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Runtime Profile</CardTitle>
                <CardDescription>Editable concurrency and crawler pacing.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                <Field label="Name" error={form.formState.errors.runtimeProfileName?.message}>
                  <Input {...form.register('runtimeProfileName')} disabled={configInputsDisabled} />
                </Field>
                <div className="grid grid-cols-1 gap-6 items-start md:grid-cols-3">
                  <Field
                    label="Crawler Concurrency"
                    error={form.formState.errors.crawlerMaxConcurrency?.message}
                    labelClassName="overflow-hidden text-ellipsis whitespace-nowrap"
                  >
                    <Input
                      type="number"
                      {...form.register('crawlerMaxConcurrency', { valueAsNumber: true })}
                      disabled={configInputsDisabled}
                    />
                  </Field>
                  <Field
                    label="Crawler RPM"
                    error={form.formState.errors.crawlerMaxRequestsPerMinute?.message}
                    labelClassName="overflow-hidden text-ellipsis whitespace-nowrap"
                  >
                    <Input
                      type="number"
                      {...form.register('crawlerMaxRequestsPerMinute', { valueAsNumber: true })}
                      disabled={configInputsDisabled}
                    />
                  </Field>
                  <Field
                    label="Ingestion Concurrency"
                    error={form.formState.errors.ingestionConcurrency?.message}
                    labelClassName="overflow-hidden text-ellipsis whitespace-nowrap"
                  >
                    <Input
                      type="number"
                      {...form.register('ingestionConcurrency', { valueAsNumber: true })}
                      disabled={
                        !isEditing || watchedMode === 'crawl_only' || hasActiveRun || deletePending
                      }
                    />
                  </Field>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Structured Output</CardTitle>
                <CardDescription>
                  MongoDB and downloadable JSON destination toggles. Mongo sink options are
                  available only when MongoDB output is enabled.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                <CheckboxField
                  label="MongoDB"
                  {...form.register('includeMongoOutput')}
                  disabled={
                    !isEditing || watchedMode === 'crawl_only' || hasActiveRun || deletePending
                  }
                />
                {watchedIncludeMongoOutput ? (
                  <div className="ml-6 grid gap-4 rounded-sm border border-border/80 bg-card/40 p-4">
                    <Field
                      label="MongoDB URI"
                      error={form.formState.errors.operatorMongoUri?.message}
                    >
                      <Input
                        {...form.register('operatorMongoUri')}
                        autoComplete="off"
                        placeholder="********"
                        disabled={sinkInputsDisabled}
                      />
                    </Field>
                    <Field
                      label="Database Name"
                      error={form.formState.errors.operatorDbName?.message}
                    >
                      <Input {...form.register('operatorDbName')} disabled={sinkInputsDisabled} />
                    </Field>
                  </div>
                ) : null}
                <CheckboxField
                  label="Downloadable JSON"
                  {...form.register('includeDownloadableJson')}
                  disabled={
                    !isEditing || watchedMode === 'crawl_only' || hasActiveRun || deletePending
                  }
                />
              </CardContent>
            </Card>
        </div>

        {isEditing ? (
          <div className="mt-4 flex items-center justify-end gap-4 rounded-sm border border-border bg-card p-4">
            <Button type="button" variant="ghost" onClick={handleCancel} disabled={savePending}>
              Cancel
            </Button>
            <Button type="submit" disabled={savePending || hasActiveRun || deletePending}>
              {savePending ? 'Saving' : 'Save Pipeline Config'}
            </Button>
          </div>
        ) : null}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>
            Live updates are scoped to runs associated with this pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyLabTray
              title="Empty Lab Tray"
              description="This pipeline has not been executed yet. Start a run to populate runtime history."
            />
          ) : (
            <div className="grid gap-3">
              {runs.map((run) => (
                <div key={run.runId} className="rounded-sm border border-border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {run.runId}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusBadge status={run.status} />
                        <span className="text-sm text-muted-foreground">
                          Requested {formatDateTime(run.requestedAt)}
                        </span>
                      </div>
                    </div>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/runs/${run.runId}`}>Open Run</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  error,
  labelClassName,
  children,
}: {
  label: string;
  error?: string;
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col space-y-1 text-sm text-foreground">
      <span
        className={cn(
          'flex h-8 items-end font-mono text-[0.68rem] uppercase leading-tight tracking-[0.14em] text-muted-foreground',
          labelClassName,
        )}
      >
        {label}
      </span>
      {children}
      <span className="min-h-[1rem] whitespace-pre-wrap break-words text-xs font-medium leading-tight text-red-500">
        {error ?? '\u00a0'}
      </span>
    </label>
  );
}

function CheckboxField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex h-11 items-center gap-3 rounded-sm border border-border px-3 text-sm text-foreground">
      <input className="h-4 w-4 shrink-0 accent-primary" type="checkbox" {...props} />
      <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
    </label>
  );
}
