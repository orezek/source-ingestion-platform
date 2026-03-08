'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyLabTray } from '@/components/state/empty-lab-tray';
import { LiveIndicator } from '@/components/state/live-indicator';
import type { ControlPlaneRun, ControlPlaneRunEventIndex } from '@/lib/contracts';
import { appendRunEvent, useControlStream } from '@/lib/live';
import { formatDateTime, formatNullableCount } from '@/lib/utils';

const terminalStates = new Set<ControlPlaneRun['status']>([
  'succeeded',
  'failed',
  'completed_with_errors',
  'stopped',
]);

function resolveBadgeVariant(
  status: string | null,
): 'neutral' | 'running' | 'success' | 'warning' | 'danger' {
  if (!status) {
    return 'neutral';
  }

  if (status === 'running' || status === 'queued') {
    return 'running';
  }

  if (status === 'succeeded') {
    return 'success';
  }

  if (status === 'completed_with_errors') {
    return 'warning';
  }

  if (status === 'failed' || status === 'stopped') {
    return 'danger';
  }

  return 'neutral';
}

function StatusLabeledBadge({ label, status }: { label: string; status: string | null }) {
  return (
    <Badge variant={resolveBadgeVariant(status)}>
      <span className="font-mono text-[0.62rem] tracking-[0.18em]">{label}:</span>
      <span className="ml-1">{status ?? 'disabled'}</span>
    </Badge>
  );
}

export function RunDetailClient({
  initialRun,
  initialEvents,
  nextCursor,
}: {
  initialRun: ControlPlaneRun;
  initialEvents: ControlPlaneRunEventIndex[];
  nextCursor: string | null;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState(initialEvents);
  const [cancelPending, setCancelPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isTerminal = terminalStates.has(run.status);
  const connectionState = useControlStream({
    runId: initialRun.runId,
    onRunUpserted: (nextRun) => {
      if (nextRun.runId === initialRun.runId) {
        setRun(nextRun);
      }
    },
    onRunEventAppended: (event) => {
      if (event.runId === initialRun.runId) {
        setEvents((current) => appendRunEvent(current, event));
      }
    },
  });

  const cancel = async () => {
    setCancelPending(true);
    setErrorMessage(null);
    const response = await fetch(`/api/runs/${run.runId}/cancel`, { method: 'POST' });
    setCancelPending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMessage(payload?.error?.message ?? 'Unable to cancel run.');
      return;
    }

    router.refresh();
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Run Detail
          </p>
          <h2 className="text-2xl font-semibold tracking-tightest">{run.pipelineName}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {run.runId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator state={connectionState} />
          {!isTerminal ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="danger">Cancel Run</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The request will be sent to the control-service and propagated to the active
                    workers.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Running</AlertDialogCancel>
                  <AlertDialogAction onClick={cancel} disabled={cancelPending}>
                    {cancelPending ? 'Cancelling' : 'Cancel Run'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>

      {errorMessage ? <p className="text-sm text-destructive-foreground">{errorMessage}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr),minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Execution Telemetry</CardTitle>
            <CardDescription>Live execution metrics and termination status.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
              <StatusLabeledBadge label="RUN" status={run.status} />
              <StatusLabeledBadge label="CRAWLER" status={run.crawler.status} />
              <StatusLabeledBadge label="INGESTION" status={run.ingestion.status} />
            </div>
            <dl className="grid gap-2">
              <Row label="Requested" value={formatDateTime(run.requestedAt)} />
              <Row label="Started" value={formatDateTime(run.startedAt)} />
              <Row label="Finished" value={formatDateTime(run.finishedAt)} />
              <Row label="Last Event" value={formatDateTime(run.lastEventAt)} />
              <Row label="Stop Reason" value={run.stopReason ?? '—'} />
              <Row label="New Jobs" value={formatNullableCount(run.summary.newJobsCount)} />
              <Row
                label="Failed Requests"
                value={formatNullableCount(run.summary.failedRequests)}
              />
              <Row label="Crawler Detail Pages" value={String(run.crawler.detailPagesCaptured)} />
              <Row label="Jobs Processed" value={String(run.ingestion.jobsProcessed)} />
              <Row label="Jobs Failed" value={String(run.ingestion.jobsFailed)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Event Timeline</CardTitle>
            <CardDescription>
              Newest events first. Expand an event to inspect its full payload.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <EmptyLabTray
                title="Empty Lab Tray"
                description="No indexed events are available for this run yet."
              />
            ) : (
              <Accordion type="multiple" className="w-full">
                {events.map((event) => (
                  <AccordionItem key={event.eventId} value={event.eventId}>
                    <AccordionTrigger>
                      <div className="grid gap-1 text-left">
                        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">
                          {event.eventType}
                        </span>
                        <span className="text-sm text-foreground">
                          {formatDateTime(event.occurredAt)}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-3">
                        <dl className="grid gap-2 text-sm text-muted-foreground">
                          <Row label="Producer" value={event.producer} />
                          <Row label="Projection" value={event.projectionStatus} />
                          <Row label="Source ID" value={event.sourceId ?? '—'} />
                        </dl>
                        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="secondary">
          <Link href="/runs">Back To Runs</Link>
        </Button>
        {nextCursor ? (
          <Button asChild variant="secondary">
            <Link href={`/runs/${run.runId}?cursor=${encodeURIComponent(nextCursor)}`}>
              Load Older Events
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
