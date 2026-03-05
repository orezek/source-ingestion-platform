import type { TimeRange } from '@/server/types';

export function parseTimeRange(value: string | null | undefined): TimeRange {
  if (value === '24h' || value === '30d') {
    return value;
  }

  return '7d';
}

export function getRangeStart(range: TimeRange, now = new Date()): Date {
  const start = new Date(now);

  if (range === '24h') {
    start.setHours(start.getHours() - 24);
    return start;
  }

  if (range === '30d') {
    start.setDate(start.getDate() - 30);
    return start;
  }

  start.setDate(start.getDate() - 7);
  return start;
}
