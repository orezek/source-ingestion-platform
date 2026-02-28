import type { RunStatus } from '@/server/types';

export function StatusBadge({ label, status }: { label: string; status: RunStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__label">{label}</span>
      <span className="status-badge__value">{status.replaceAll('_', ' ')}</span>
    </span>
  );
}
