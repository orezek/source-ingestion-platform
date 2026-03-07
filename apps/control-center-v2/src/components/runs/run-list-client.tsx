'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EmptyLabTray } from '@/components/state/empty-lab-tray';
import { LiveIndicator } from '@/components/state/live-indicator';
import { StatusBadge } from '@/components/state/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  ControlPlanePipeline,
  ControlPlaneRun,
  ListControlPlaneRunsQuery,
} from '@/lib/contracts';
import { upsertRun, useControlStream } from '@/lib/live';
import { formatDateTime } from '@/lib/utils';

function runMatchesFilter(run: ControlPlaneRun, filters: Partial<ListControlPlaneRunsQuery>) {
  if (filters.pipelineId && run.pipelineId !== filters.pipelineId) return false;
  if (filters.status && run.status !== filters.status) return false;
  if (filters.source && run.source !== filters.source) return false;
  return true;
}

export function RunListClient({
  initialRuns,
  filters,
  nextCursor,
  pipelines,
}: {
  initialRuns: ControlPlaneRun[];
  filters: Partial<ListControlPlaneRunsQuery>;
  nextCursor: string | null;
  pipelines: ControlPlanePipeline[];
}) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [draftFilters, setDraftFilters] = useState({
    pipelineId: filters.pipelineId ?? '',
    status: filters.status ?? '',
    source: filters.source ?? '',
    limit: String(filters.limit ?? 20),
  });
  const connectionState = useControlStream({
    onRunUpserted: (run) => {
      setRuns((current) => {
        if (!runMatchesFilter(run, filters)) {
          return current.filter((item) => item.runId !== run.runId);
        }

        return upsertRun(current, run);
      });
    },
  });

  const pipelineOptions = useMemo(
    () => pipelines.map((pipeline) => ({ id: pipeline.pipelineId, name: pipeline.name })),
    [pipelines],
  );

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (draftFilters.pipelineId) params.set('pipelineId', draftFilters.pipelineId);
    if (draftFilters.status) params.set('status', draftFilters.status);
    if (draftFilters.source) params.set('source', draftFilters.source);
    if (draftFilters.limit) params.set('limit', draftFilters.limit);
    router.push(params.toString() ? `/runs?${params.toString()}` : '/runs');
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Run Observatory
          </p>
          <h2 className="text-2xl font-semibold tracking-tightest">
            Cross-pipeline execution feed
          </h2>
        </div>
        <LiveIndicator state={connectionState} />
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 md:flex md:flex-wrap md:items-end *:md:flex-1">
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
              Pipeline
            </span>
            <select
              className="flex h-11 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draftFilters.pipelineId}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, pipelineId: event.target.value }))
              }
            >
              <option value="">All pipelines</option>
              {pipelineOptions.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
              Status
            </span>
            <select
              className="flex h-11 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draftFilters.status}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="">All statuses</option>
              {['queued', 'running', 'succeeded', 'completed_with_errors', 'failed', 'stopped'].map(
                (status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
              Source
            </span>
            <Input
              value={draftFilters.source}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, source: event.target.value }))
              }
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,120px),1fr]">
            <label className="grid gap-2 text-sm">
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                Limit
              </span>
              <Input
                type="number"
                value={draftFilters.limit}
                onChange={(event) =>
                  setDraftFilters((current) => ({ ...current, limit: event.target.value }))
                }
              />
            </label>
            <Button onClick={applyFilters} className="sm:self-end">
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <EmptyLabTray title="Empty Lab Tray" description="No runs match the current filter set." />
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {runs.map((run) => (
              <Card key={run.runId}>
                <CardContent className="grid gap-3 p-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      {run.runId}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold tracking-tightest">
                      {run.pipelineName}
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={run.status} />
                    <span className="text-sm text-muted-foreground">{run.source}</span>
                  </div>
                  <dl className="grid gap-2 text-sm text-muted-foreground">
                    <div className="flex justify-between gap-3">
                      <dt>Requested</dt>
                      <dd>{formatDateTime(run.requestedAt)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Crawler</dt>
                      <dd>
                        <StatusBadge status={run.crawler.status} />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Ingestion</dt>
                      <dd>
                        <StatusBadge status={run.ingestion.status} />
                      </dd>
                    </div>
                  </dl>
                  <Button asChild variant="secondary">
                    <Link href={`/runs/${run.runId}`}>Open Run</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-sm border border-border md:block">
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Run</TableHead>
                    <TableHead className="whitespace-nowrap">Pipeline</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="whitespace-nowrap">Crawler</TableHead>
                    <TableHead className="whitespace-nowrap">Ingestion</TableHead>
                    <TableHead className="whitespace-nowrap">Requested</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.runId}>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {run.runId}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-semibold text-foreground">{run.pipelineName}</div>
                        <div className="text-xs text-muted-foreground">{run.source}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={run.crawler.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={run.ingestion.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(run.requestedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/runs/${run.runId}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {nextCursor ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              const params = new URLSearchParams();
              if (filters.pipelineId) params.set('pipelineId', filters.pipelineId);
              if (filters.status) params.set('status', filters.status);
              if (filters.source) params.set('source', filters.source);
              if (filters.limit) params.set('limit', String(filters.limit));
              params.set('cursor', nextCursor);
              router.push(`/runs?${params.toString()}`);
            }}
          >
            Next Page
          </Button>
        </div>
      ) : null}
    </div>
  );
}
