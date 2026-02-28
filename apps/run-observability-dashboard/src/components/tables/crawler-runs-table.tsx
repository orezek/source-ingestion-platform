import Link from 'next/link';
import type { CrawlerRunSummaryView } from '@/server/types';
import {
  formatCompactBytes,
  formatDateTime,
  formatDurationSeconds,
  formatNumber,
} from '@/server/lib/formatting';
import { StatusBadge } from '@/components/state/status-badge';

export function CrawlerRunsTable({ runs }: { runs: CrawlerRunSummaryView[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Started</th>
            <th>Duration</th>
            <th>New</th>
            <th>Existing</th>
            <th>Inactive</th>
            <th>Failed requests</th>
            <th>HTML bytes</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link href={`/crawler/runs/${run.id}`}>{run.id.slice(0, 8)}</Link>
              </td>
              <td>
                <StatusBadge label="RUN" status={run.status} />
              </td>
              <td>{formatDateTime(run.startedAt)}</td>
              <td>{formatDurationSeconds(run.durationSeconds)}</td>
              <td>{formatNumber(run.newJobsCount)}</td>
              <td>{formatNumber(run.existingJobsCount)}</td>
              <td>{formatNumber(run.inactiveMarkedCount)}</td>
              <td>{formatNumber(run.failedRequests)}</td>
              <td>{formatCompactBytes(run.totalDetailHtmlBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
