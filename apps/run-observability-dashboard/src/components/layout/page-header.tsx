import Image from 'next/image';
import Link from 'next/link';
import { formatDateTime } from '@/server/lib/formatting';
import type { RunStatus } from '@/server/types';
import { StatusBadge } from '@/components/state/status-badge';

export function PageHeader({
  eyebrow,
  title,
  description,
  environmentLabel,
  databaseName,
  generatedAt,
  latestCrawlerStatus,
  latestIngestionStatus,
}: {
  eyebrow: string;
  title: string;
  description: string;
  environmentLabel: string;
  databaseName: string;
  generatedAt: string;
  latestCrawlerStatus?: RunStatus | null;
  latestIngestionStatus?: RunStatus | null;
}) {
  return (
    <header className="page-header">
      <div className="page-header__brand">
        <Link href="/" className="brand-mark" aria-label="Run observability dashboard home">
          <Image
            src="/dashboard-mark.svg"
            alt="Run observability dashboard logo"
            width={68}
            height={68}
            priority
          />
        </Link>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="lede">{description}</p>
        </div>
      </div>
      <div className="page-header__meta">
        <div className="meta-chip">MODE: {environmentLabel}</div>
        <div className="meta-chip">DB: {databaseName}</div>
        <div className="meta-chip">REFRESHED: {formatDateTime(generatedAt)}</div>
        <Link href="/control-plane" className="meta-chip">
          CONTROL PLANE
        </Link>
        {latestCrawlerStatus ? <StatusBadge label="CRAWLER" status={latestCrawlerStatus} /> : null}
        {latestIngestionStatus ? (
          <StatusBadge label="INGESTION" status={latestIngestionStatus} />
        ) : null}
      </div>
    </header>
  );
}
