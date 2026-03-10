'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EmptyLabTray } from '@/components/state/empty-lab-tray';
import { LiveIndicator } from '@/components/state/live-indicator';
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
  PIPELINE_NAME_MAX_LENGTH,
  buildUpdatePipelinePayload,
  pipelineUpdateFormSchema,
} from '@/lib/forms';
import { upsertRun, useControlStream } from '@/lib/live';
import { formatDateTime } from '@/lib/utils';

type EditablePipelineDraft = {
  name: string;
  mode: 'crawl_only' | 'crawl_and_ingest';
  searchSpaceName: string;
  searchSpaceDescription: string;
  startUrlsText: string;
  maxItems: number;
  allowInactiveMarking: boolean;
  runtimeProfileName: string;
  crawlerMaxConcurrency?: number;
  crawlerMaxRequestsPerMinute?: number;
  ingestionConcurrency?: number;
  includeMongoOutput: boolean;
  includeDownloadableJson: boolean;
};

const activeRunStatuses = new Set(['queued', 'running']);
const DELETE_STATUS_POLL_INTERVAL_MS = 1_000;
const DELETE_STATUS_POLL_MAX_ATTEMPTS = 90;

function createInitialDraft(pipeline: ControlPlanePipeline): EditablePipelineDraft {
  return {
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
  const [draft, setDraft] = useState<EditablePipelineDraft>(() => createInitialDraft(pipeline));
  const [sinkMongoUri, setSinkMongoUri] = useState('');
  const [sinkDbName, setSinkDbName] = useState(pipeline.operatorSink.dbName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveConfigPending, setSaveConfigPending] = useState(false);
  const [saveSinkPending, setSaveSinkPending] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const connectionState = useControlStream({
    pipelineId: pipeline.pipelineId,
    onRunUpserted: (run) => {
      if (run.pipelineId === pipeline.pipelineId) {
        setRuns((current) => upsertRun(current, run));
      }
    },
  });

  const hasActiveRun = useMemo(() => runs.some((run) => activeRunStatuses.has(run.status)), [runs]);
  const canEditInactiveMarking = draft.mode === 'crawl_and_ingest' && draft.includeMongoOutput;

  const submitConfig = async () => {
    setSaveConfigPending(true);
    setErrorMessage(null);

    let payload: ReturnType<typeof buildUpdatePipelinePayload>;
    try {
      payload = buildUpdatePipelinePayload(
        pipelineUpdateFormSchema.parse({
          ...draft,
          operatorMongoUri: undefined,
          operatorDbName: undefined,
        }),
      );
    } catch (error) {
      setSaveConfigPending(false);
      setErrorMessage(error instanceof Error ? error.message : 'Invalid pipeline configuration.');
      return;
    }

    const response = await fetch(`/api/pipelines/${pipeline.pipelineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaveConfigPending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMessage(payload?.error?.message ?? 'Unable to save pipeline configuration.');
      return;
    }

    const updatedPipeline = (await response.json()) as ControlPlanePipeline;
    setDraft(createInitialDraft(updatedPipeline));
    setSinkDbName(updatedPipeline.operatorSink.dbName);
    router.refresh();
  };

  const submitSink = async () => {
    setSaveSinkPending(true);
    setErrorMessage(null);

    let payload: ReturnType<typeof buildUpdatePipelinePayload>;
    try {
      payload = buildUpdatePipelinePayload(
        pipelineUpdateFormSchema.parse({
          ...draft,
          operatorMongoUri: sinkMongoUri,
          operatorDbName: sinkDbName,
        }),
      );
    } catch (error) {
      setSaveSinkPending(false);
      setErrorMessage(error instanceof Error ? error.message : 'Invalid sink configuration.');
      return;
    }

    const response = await fetch(`/api/pipelines/${pipeline.pipelineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaveSinkPending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMessage(payload?.error?.message ?? 'Unable to update sink configuration.');
      return;
    }

    setSinkMongoUri('');
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
          <h2 className="text-2xl font-semibold tracking-tightest">{draft.name}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {pipeline.pipelineId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator state={connectionState} />
          <Button onClick={startRun} disabled={startPending || deletePending || hasActiveRun}>
            {startPending ? 'Starting' : 'Start Run'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="danger" disabled={deletePending || hasActiveRun}>
                {deletePending ? 'Deleting' : 'Delete Pipeline'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this pipeline?</AlertDialogTitle>
                <AlertDialogDescription>
                  This operation permanently deletes pipeline metadata, run history, sink data, and
                  artifacts. The action cannot be undone.
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
      {errorMessage ? <p className="text-sm text-destructive-foreground">{errorMessage}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <CardDescription>Editable pipeline identity and execution mode.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Display Name">
              <Input
                maxLength={PIPELINE_NAME_MAX_LENGTH}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                disabled={hasActiveRun || deletePending || saveConfigPending}
              />
            </Field>
            <Field label="Mode">
              <select
                className="flex h-11 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                value={draft.mode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    mode: event.target.value as 'crawl_only' | 'crawl_and_ingest',
                  }))
                }
                disabled={hasActiveRun || deletePending || saveConfigPending}
              >
                <option value="crawl_and_ingest">Crawl And Ingest</option>
                <option value="crawl_only">Crawl Only</option>
              </select>
            </Field>
            <Field label="Source (read-only)">
              <Input value={pipeline.source} disabled />
            </Field>
            <div className="mt-4 flex items-center gap-4">
              <Button
                onClick={submitConfig}
                disabled={hasActiveRun || deletePending || saveConfigPending}
              >
                {saveConfigPending ? 'Saving' : 'Save Pipeline Config'}
              </Button>
              <StatusBadge status={pipeline.status} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Search Space</CardTitle>
            <CardDescription>Editable crawl scope and inactive marking policy.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Name">
              <Input
                value={draft.searchSpaceName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, searchSpaceName: event.target.value }))
                }
                disabled={hasActiveRun || deletePending || saveConfigPending}
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={3}
                value={draft.searchSpaceDescription}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    searchSpaceDescription: event.target.value,
                  }))
                }
                disabled={hasActiveRun || deletePending || saveConfigPending}
              />
            </Field>
            <Field label="Start URLs (one per line)">
              <Textarea
                rows={4}
                value={draft.startUrlsText}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, startUrlsText: event.target.value }))
                }
                disabled={hasActiveRun || deletePending || saveConfigPending}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-[minmax(0,220px),1fr]">
              <Field label="Max Items">
                <Input
                  type="number"
                  value={draft.maxItems}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      maxItems: Number(event.target.value || 0),
                    }))
                  }
                  disabled={hasActiveRun || deletePending || saveConfigPending}
                />
              </Field>
              <CheckboxField
                label="Allow inactive marking"
                checked={draft.allowInactiveMarking}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    allowInactiveMarking: event.target.checked,
                  }))
                }
                disabled={
                  !canEditInactiveMarking || hasActiveRun || deletePending || saveConfigPending
                }
              />
            </div>
            <dl className="grid gap-2 text-sm text-muted-foreground">
              <Row label="Search Space ID" value={pipeline.searchSpace.id} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runtime Profile</CardTitle>
            <CardDescription>Editable concurrency and crawler pacing.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Name">
              <Input
                value={draft.runtimeProfileName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, runtimeProfileName: event.target.value }))
                }
                disabled={hasActiveRun || deletePending || saveConfigPending}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Crawler Concurrency">
                <Input
                  type="number"
                  value={draft.crawlerMaxConcurrency ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      crawlerMaxConcurrency: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    }))
                  }
                  disabled={hasActiveRun || deletePending || saveConfigPending}
                />
              </Field>
              <Field label="Crawler RPM">
                <Input
                  type="number"
                  value={draft.crawlerMaxRequestsPerMinute ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      crawlerMaxRequestsPerMinute: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    }))
                  }
                  disabled={hasActiveRun || deletePending || saveConfigPending}
                />
              </Field>
              <Field label="Ingestion Concurrency">
                <Input
                  type="number"
                  value={draft.ingestionConcurrency ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      ingestionConcurrency: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    }))
                  }
                  disabled={
                    draft.mode === 'crawl_only' ||
                    hasActiveRun ||
                    deletePending ||
                    saveConfigPending
                  }
                />
              </Field>
            </div>
            <dl className="grid gap-2 text-sm text-muted-foreground">
              <Row label="Runtime Profile ID" value={pipeline.runtimeProfile.id} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Structured Output</CardTitle>
            <CardDescription>MongoDB and downloadable JSON destination toggles.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <CheckboxField
              label="MongoDB"
              checked={draft.includeMongoOutput}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  includeMongoOutput: event.target.checked,
                }))
              }
              disabled={
                draft.mode === 'crawl_only' || hasActiveRun || deletePending || saveConfigPending
              }
            />
            <CheckboxField
              label="Downloadable JSON"
              checked={draft.includeDownloadableJson}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  includeDownloadableJson: event.target.checked,
                }))
              }
              disabled={
                draft.mode === 'crawl_only' || hasActiveRun || deletePending || saveConfigPending
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operator Sink</CardTitle>
            <CardDescription>
              MongoDB URI is write-only. Enter URI only when rotating or changing sink target.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="MongoDB URI (write-only)">
              <Input
                value={sinkMongoUri}
                onChange={(event) => setSinkMongoUri(event.target.value)}
                autoComplete="off"
                placeholder={
                  pipeline.operatorSink.hasMongoUri
                    ? 'Configured. Enter new URI to rotate.'
                    : 'mongodb+srv://cluster.example.net'
                }
                disabled={hasActiveRun || deletePending || saveSinkPending}
              />
            </Field>
            <Field label="Database Name">
              <Input
                value={sinkDbName}
                onChange={(event) => setSinkDbName(event.target.value)}
                disabled={hasActiveRun || deletePending || saveSinkPending}
              />
            </Field>
            <Button
              onClick={submitSink}
              disabled={hasActiveRun || deletePending || saveSinkPending}
            >
              {saveSinkPending ? 'Saving' : 'Save Sink'}
            </Button>
          </CardContent>
        </Card>
      </div>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm text-foreground">
      <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 rounded-sm border border-border px-3 py-3 text-sm text-foreground">
      <input
        className="h-4 w-4 accent-primary"
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 text-right text-foreground">{value}</dd>
    </div>
  );
}
