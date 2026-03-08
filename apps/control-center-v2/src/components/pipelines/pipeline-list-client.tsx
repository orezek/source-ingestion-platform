'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { EmptyLabTray } from '@/components/state/empty-lab-tray';
import { LiveIndicator } from '@/components/state/live-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ControlPlanePipeline } from '@/lib/contracts';
import { useControlStream } from '@/lib/live';
import { formatDateTime, titleCaseFromToken } from '@/lib/utils';

export function PipelineListClient({ pipelines }: { pipelines: ControlPlanePipeline[] }) {
  const router = useRouter();
  const [pendingPipelineId, setPendingPipelineId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const connectionState = useControlStream({
    onRunUpserted: () => {
      if (refreshTimer.current != null) {
        return;
      }

      refreshTimer.current = window.setTimeout(() => {
        router.refresh();
        refreshTimer.current = null;
      }, 600);
    },
  });

  useEffect(
    () => () => {
      if (refreshTimer.current != null) {
        window.clearTimeout(refreshTimer.current);
      }
    },
    [],
  );

  const startRun = async (pipelineId: string) => {
    setPendingPipelineId(pipelineId);
    setErrorMessage(null);
    const response = await fetch(`/api/pipelines/${pipelineId}/runs`, { method: 'POST' });
    setPendingPipelineId(null);

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
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Pipeline Registry
          </p>
          <h2 className="text-xl font-semibold tracking-tightest">Frozen execution definitions</h2>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator state={connectionState} />
          <Button asChild>
            <Link href="/pipelines/new">Create Pipeline</Link>
          </Button>
        </div>
      </div>

      {errorMessage ? <p className="text-sm text-destructive-foreground">{errorMessage}</p> : null}

      {pipelines.length === 0 ? (
        <EmptyLabTray
          title="Empty Lab Tray"
          description="No pipelines are defined yet. Create the first pipeline to start the V2 operator surface."
        />
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {pipelines.map((pipeline) => (
              <Card key={pipeline.pipelineId}>
                <CardContent className="grid gap-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {pipeline.pipelineId}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold tracking-tightest">
                        {pipeline.name}
                      </h3>
                    </div>
                    <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      {titleCaseFromToken(pipeline.mode)}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm text-muted-foreground">
                    <div className="flex justify-between gap-4">
                      <dt>Source</dt>
                      <dd>{pipeline.source}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Updated</dt>
                      <dd>{formatDateTime(pipeline.updatedAt)}</dd>
                    </div>
                  </dl>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button asChild variant="secondary">
                      <Link href={`/pipelines/${pipeline.pipelineId}`}>View Detail</Link>
                    </Button>
                    <Button
                      onClick={() => startRun(pipeline.pipelineId)}
                      disabled={pendingPipelineId === pipeline.pipelineId}
                    >
                      {pendingPipelineId === pipeline.pipelineId ? 'Starting' : 'Start Run'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden min-w-0 rounded-sm border border-border md:block">
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="whitespace-nowrap">Source</TableHead>
                    <TableHead className="whitespace-nowrap">Mode</TableHead>
                    <TableHead className="whitespace-nowrap">Updated</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipelines.map((pipeline) => (
                    <TableRow key={pipeline.pipelineId}>
                      <TableCell>
                        <div className="min-w-[240px]">
                          <div
                            className="max-w-[300px] truncate font-semibold text-foreground sm:max-w-md"
                            title={pipeline.name}
                          >
                            {pipeline.name}
                          </div>
                          <div
                            className="max-w-[300px] truncate font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground sm:max-w-md"
                            title={pipeline.pipelineId}
                          >
                            {pipeline.pipelineId}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{pipeline.source}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {titleCaseFromToken(pipeline.mode)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(pipeline.updatedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/pipelines/${pipeline.pipelineId}`}>View</Link>
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => startRun(pipeline.pipelineId)}
                            disabled={pendingPipelineId === pipeline.pipelineId}
                          >
                            {pendingPipelineId === pipeline.pipelineId ? 'Starting' : 'Start'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
