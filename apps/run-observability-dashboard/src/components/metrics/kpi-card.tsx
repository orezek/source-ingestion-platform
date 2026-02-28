export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="kpi-card">
      <p className="kpi-card__label">{label}</p>
      <p className="kpi-card__value">{value}</p>
      {hint ? <p className="kpi-card__hint">{hint}</p> : null}
    </article>
  );
}
