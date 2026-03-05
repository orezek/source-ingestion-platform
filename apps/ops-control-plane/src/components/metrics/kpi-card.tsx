import type { ReactNode } from 'react';

export function KpiCard({
  label,
  value,
  hint,
  emphasis = 'normal',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  emphasis?: 'strong' | 'normal' | 'quiet';
}) {
  return (
    <article className={`kpi-card kpi-card--${emphasis}`}>
      <p className="kpi-card__label">{label}</p>
      <p className="kpi-card__value">{value}</p>
      {hint ? <p className="kpi-card__hint">{hint}</p> : null}
    </article>
  );
}
