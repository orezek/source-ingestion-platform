import Link from 'next/link';
import type { AnomalyView } from '@/server/types';

export function AlertPanel({ anomalies }: { anomalies: AnomalyView[] }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <p className="eyebrow">Observability</p>
        <h2>Alerts and anomalies</h2>
      </div>
      {anomalies.length === 0 ? (
        <p className="empty-copy">No anomalies detected in the selected time range.</p>
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
