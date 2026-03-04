import type { RunStatus } from '@/server/types';

export function StatusBadge({ label, status }: { label?: string; status: RunStatus }) {
  const hasLabel = Boolean(label);

  return (
    <span
      className={`status-badge status-badge--${status} ${
        hasLabel ? 'status-badge--labeled' : 'status-badge--unlabeled'
      }`}
    >
      {label ? <span className="status-badge__label">{label}</span> : null}
      <span className="status-badge__value">{status.replaceAll('_', ' ')}</span>
    </span>
  );
}
