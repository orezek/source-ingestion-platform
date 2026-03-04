import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { formatDateTime } from '@/server/lib/formatting';
import type { RunStatus } from '@/server/types';
import { StatusBadge } from '@/components/state/status-badge';

type PageHeaderAction = {
  href: string;
  label: string;
  variant?: 'ghost' | 'default';
};

type PageHeaderSummaryItem = {
  label: string;
  value: ReactNode;
  detail?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  environmentLabel,
  databaseName,
  generatedAt,
  latestCrawlerStatus,
  latestIngestionStatus,
  backHref,
  backLabel = 'Back',
  showMeta = true,
  showControlPlaneLink = true,
  showOverviewAction = true,
  actions,
  summaryItems,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  environmentLabel?: string;
  databaseName?: string | null;
  generatedAt?: string;
  latestCrawlerStatus?: RunStatus | null;
  latestIngestionStatus?: RunStatus | null;
  backHref?: string;
  backLabel?: string;
  showMeta?: boolean;
  showControlPlaneLink?: boolean;
  showOverviewAction?: boolean;
  actions?: PageHeaderAction[];
  summaryItems?: PageHeaderSummaryItem[];
}) {
  const hasMeta =
    showMeta &&
    Boolean(
      environmentLabel ||
      databaseName ||
      generatedAt ||
      latestCrawlerStatus ||
      latestIngestionStatus ||
      showControlPlaneLink,
    );
  const resolvedActions = actions ?? [
    ...(showOverviewAction
      ? [
          {
            href: '/',
            label: 'Operational dashboard',
            variant: 'ghost' as const,
          },
        ]
      : []),
    ...(backHref
      ? [
          {
            href: backHref,
            label: backLabel,
            variant: 'ghost' as const,
          },
        ]
      : []),
  ];
  const hasSummary = Boolean(summaryItems && summaryItems.length > 0);

  return (
    <header className="page-header">
      <div className="page-header__brand">
        <Link href="/" className="brand-mark" aria-label="Run observability dashboard home">
          <Image
            src="/dashboard-mark.svg"
            alt="Run observability dashboard logo"
            width={52}
            height={52}
            priority
          />
        </Link>
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {description ? <p className="lede">{description}</p> : null}
          {resolvedActions.length > 0 ? (
            <div className="page-header__actions">
              {resolvedActions.map((action) => (
                <Link
                  key={`${action.href}-${action.label}`}
                  href={action.href}
                  className={`action-button ${
                    action.variant === 'ghost' ? 'action-button--ghost' : ''
                  }`}
                >
                  {action.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {hasMeta ? (
        <div className="page-header__meta">
          {environmentLabel ? <div className="meta-chip">MODE: {environmentLabel}</div> : null}
          {databaseName ? <div className="meta-chip">DB: {databaseName}</div> : null}
          {generatedAt ? (
            <div className="meta-chip">REFRESHED: {formatDateTime(generatedAt)}</div>
          ) : null}
          {showControlPlaneLink ? (
            <Link href="/control-plane" className="meta-chip">
              CONTROL PLANE
            </Link>
          ) : null}
          {latestCrawlerStatus ? (
            <StatusBadge label="CRAWLER" status={latestCrawlerStatus} />
          ) : null}
          {latestIngestionStatus ? (
            <StatusBadge label="INGESTION" status={latestIngestionStatus} />
          ) : null}
        </div>
      ) : null}
      {hasSummary ? (
        <div className="page-header__summary">
          {summaryItems?.map((item, index) => (
            <article key={`${item.label}-${index}`} className="page-header__summary-item">
              <p className="page-header__summary-label">{item.label}</p>
              <div className="page-header__summary-value">{item.value}</div>
              {item.detail ? <p className="page-header__summary-detail">{item.detail}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
    </header>
  );
}
