import { describe, expect, it } from 'vitest';
import { getRangeStart, parseTimeRange } from '@/server/lib/time-range';

describe('time-range utilities', () => {
  it('defaults invalid values to 7d', () => {
    expect(parseTimeRange('invalid')).toBe('7d');
    expect(parseTimeRange(undefined)).toBe('7d');
  });

  it('computes 24h start correctly', () => {
    const now = new Date('2026-02-27T12:00:00.000Z');
    expect(getRangeStart('24h', now).toISOString()).toBe('2026-02-26T12:00:00.000Z');
  });
});
