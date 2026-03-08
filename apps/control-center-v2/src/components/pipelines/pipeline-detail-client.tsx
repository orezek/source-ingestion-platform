'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyLabTray } from '@/components/state/empty-lab-tray';
import { LiveIndicator } from '@/components/state/live-indicator';
import { StatusBadge } from '@/components/state/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ControlPlanePipeline, ControlPlaneRun } from '@/lib/contracts';
import { PIPELINE_NAME_MAX_LENGTH, buildRenamePipelinePayload } from '@/lib/forms';
import { upsertRun, useControlStream } from '@/lib/live';
import { formatDateTime } from '@/lib/utils';

export function PipelineDetailClient({
  pipeline,
  initialRuns,
}: {
  pipeline: ControlPlanePipeline;
  initialRuns: ControlPlaneRun[];
}) {
  const router = useRouter();
  const [draftName, setDraftName] = useState(pipeline.name);
  const [runs, setRuns] = useState(initialRuns);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const connectionState = useControlStream({
    pipelineId: pipeline.pipelineId,
    onRunUpserted: (run) => {
      if (run.pipelineId === pipeline.pipelineId) {
        setRuns((current) => upsertRun(current, run));
      }
    },
  });

  const submitRename = async () => {
    setRenamePending(true);
    setErrorMessage(null);
    const response = await fetch(`/api/pipelines/${pipeline.pipelineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRenamePipelinePayload({ name: draftName })),
    });
    setRenamePending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMessage(payload?.error?.message ?? 'Unable to rename pipeline.');
      return;
    }

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

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline Detail
          </p>
          <h2 className="text-2xl font-semibold tracking-tightest">{pipeline.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{pipeline.pipelineId}</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator state={connectionState} />
          <Button onClick={startRun} disabled={startPending}>
            {startPending ? 'Starting' : 'Start Run'}
          </Button>
        </div>
      </div>

      {errorMessage ? <p className="text-sm text-destructive-foreground">{errorMessage}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Identity</CardTitle>
            <CardDescription>Name is the only mutable field in V2.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm">
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                Display Name
              </span>
              <Input
                maxLength={PIPELINE_NAME_MAX_LENGTH}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            <div className="mt-4 flex items-center gap-4">
              <Button onClick={submitRename} disabled={renamePending} variant="secondary">
                {renamePending ? 'Saving' : 'Rename Pipeline'}
              </Button>
              <StatusBadge status={pipeline.status} />
            </div>
            <dl className="grid gap-2 text-sm text-muted-foreground">
              <Row label="Source" value={pipeline.source} />
              <Row label="Mode" value={pipeline.mode} />
              <Row label="Version" value={String(pipeline.version)} />
              <Row label="Created" value={formatDateTime(pipeline.createdAt)} />
              <Row label="Updated" value={formatDateTime(pipeline.updatedAt)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution Snapshot</CardTitle>
            <CardDescription>
              Embedded pipeline-owned search space, runtime profile, and outputs.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm text-muted-foreground">
            <SnapshotBlock title="Search Space">
              <Row
                label="ID"
                value={
                  <span
                    className="block max-w-[200px] truncate text-right sm:max-w-xs md:max-w-md"
                    title={pipeline.searchSpace.id}
                  >
                    {pipeline.searchSpace.id}
                  </span>
                }
              />
              <Row
                label="Name"
                value={
                  <span
                    className="block max-w-[200px] truncate text-right sm:max-w-xs md:max-w-md"
                    title={pipeline.searchSpace.name}
                  >
                    {pipeline.searchSpace.name}
                  </span>
                }
              />
              <Row label="Max Items" value={String(pipeline.searchSpace.maxItems)} />
              <Row label="Start URLs" value={`${pipeline.searchSpace.startUrls.length} urls`} />
            </SnapshotBlock>
            <SnapshotBlock title="Runtime Profile">
              <Row label="ID" value={pipeline.runtimeProfile.id} />
              <Row
                label="Crawler Concurrency"
                value={String(pipeline.runtimeProfile.crawlerMaxConcurrency ?? '—')}
              />
              <Row
                label="Crawler RPM"
                value={String(pipeline.runtimeProfile.crawlerMaxRequestsPerMinute ?? '—')}
              />
              <Row
                label="Ingestion"
                value={pipeline.runtimeProfile.ingestionEnabled ? 'enabled' : 'disabled'}
              />
            </SnapshotBlock>
            <SnapshotBlock title="Structured Output">
              <Row
                label="Destinations"
                value={
                  pipeline.structuredOutput.destinations.length > 0
                    ? pipeline.structuredOutput.destinations
                        .map((destination) => destination.type)
                        .join(', ')
                    : 'none'
                }
              />
            </SnapshotBlock>
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

function SnapshotBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 rounded-sm border border-border/80 p-3">
      <div className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-foreground">
        {title}
      </div>
      {children}
    </div>
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
