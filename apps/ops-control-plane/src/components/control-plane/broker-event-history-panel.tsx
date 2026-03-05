import type { BrokerEvent } from '@repo/control-plane-contracts';
import { formatDateTime } from '@/server/lib/formatting';

function describeBrokerEvent(event: BrokerEvent): string {
  switch (event.eventType) {
    case 'crawler.run.requested':
      return `${event.payload.runManifest.searchSpaceSnapshot.startUrls.length} start URLs`;
    case 'crawler.detail.captured':
      return `${event.payload.sourceId} • ${event.payload.listingRecord.jobTitle}`;
    case 'crawler.run.finished':
      return `status=${event.payload.status} • new=${event.payload.newJobsCount} • failed=${event.payload.failedRequests}`;
    case 'ingestion.item.started':
    case 'ingestion.item.succeeded':
    case 'ingestion.item.failed':
    case 'ingestion.item.rejected':
      return `${event.payload.sourceId} • ${event.payload.reason ?? event.payload.documentId ?? 'no extra details'}`;
  }
}

function toTypeTag(eventType: BrokerEvent['eventType']): string {
  if (eventType.includes('failed')) {
    return 'error';
  }
  if (eventType.includes('rejected')) {
    return 'warn';
  }
  if (eventType.includes('succeeded') || eventType.includes('finished')) {
    return 'info';
  }
  if (
    eventType.includes('requested') ||
    eventType.includes('started') ||
    eventType.includes('captured')
  ) {
    return 'debug';
  }

  return 'plain';
}

export function BrokerEventHistoryPanel({ events }: { events: BrokerEvent[] }) {
  return (
    <div className="event-history-list" data-testid="control-plane-event-history">
      {events.map((event) => (
        <article className="event-history-item" key={event.eventId}>
          <div className="event-history-item__meta">
            <div className="event-history-item__field">
              <span className="event-history-item__label">When</span>
              <span className="event-history-item__value">{formatDateTime(event.occurredAt)}</span>
            </div>
            <div className="event-history-item__field">
              <span className="event-history-item__label">Type</span>
              <span className={`event-type-chip event-type-chip--${toTypeTag(event.eventType)}`}>
                {event.eventType}
              </span>
            </div>
            <div className="event-history-item__field">
              <span className="event-history-item__label">Producer</span>
              <span className="event-history-item__value">{event.producer}</span>
            </div>
            <div className="event-history-item__field">
              <span className="event-history-item__label">Correlation</span>
              <span className="event-history-item__value event-history-item__value--break">
                {event.correlationId}
              </span>
            </div>
          </div>
          <p className="event-history-item__detail">{describeBrokerEvent(event)}</p>
          <details className="event-history-item__payload">
            <summary>Payload JSON</summary>
            <pre className="code-panel event-history-item__payload-code">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </details>
        </article>
      ))}
    </div>
  );
}
