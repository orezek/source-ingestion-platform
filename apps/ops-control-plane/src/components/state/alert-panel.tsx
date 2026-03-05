import Link from 'next/link';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { EmptyTray } from '@/components/state/empty-tray';
import type { AnomalyView } from '@/server/types';

export function AlertPanel({ anomalies }: { anomalies: AnomalyView[] }) {
  return (
    <section className="panel">
      <SectionHeading
        eyebrow="Observability"
        title="Alerts and anomalies"
        description="Only derived issues that need operator attention."
      />
      {anomalies.length === 0 ? (
        <EmptyTray
          label="Observability"
          title="No anomalies detected"
          message="No anomalies were detected in the selected time range."
        />
      ) : (
        <div className="alert-list">
          {anomalies.map((anomaly) => (
            <Link
              className={`alert-card alert-card--${anomaly.level}`}
              href={anomaly.href}
              key={`${anomaly.title}-${anomaly.href}`}
            >
              <span className="alert-card__level">{anomaly.level}</span>
              <div>
                <h3>{anomaly.title}</h3>
                <p>{anomaly.description}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
