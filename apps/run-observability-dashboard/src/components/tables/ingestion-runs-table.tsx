import Link from 'next/link';
import type { IngestionRunSummaryView } from '@/server/types';
import {
  formatCurrency,
  formatDateTime,
  formatDurationSeconds,
  formatNumber,
  formatPercent,
} from '@/server/lib/formatting';
import { StatusBadge } from '@/components/state/status-badge';

export function IngestionRunsTable({ runs }: { runs: IngestionRunSummaryView[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Total</th>
            <th>Processed</th>
            <th>Skipped</th>
            <th>Failed</th>
            <th>Success rate</th>
            <th>Tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link href={`/ingestion/runs/${run.id}`}>{run.id.slice(0, 8)}</Link>
              </td>
              <td>
                <StatusBadge label="RUN" status={run.status} />
              </td>
              <td>{formatDateTime(run.startedAt)}</td>
              <td>{formatDurationSeconds(run.durationSeconds)}</td>
              <td>{formatNumber(run.jobsTotal)}</td>
              <td>{formatNumber(run.jobsProcessed)}</td>
              <td>{formatNumber(run.jobsSkippedIncomplete)}</td>
              <td>{formatNumber(run.jobsFailed)}</td>
              <td>{formatPercent(run.jobsSuccessRate, 1)}</td>
              <td>{formatNumber(run.totalTokens)}</td>
              <td>{formatCurrency(run.totalEstimatedCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
