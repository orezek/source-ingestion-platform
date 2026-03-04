import { describe, expect, it } from 'vitest';
import { formatDateTime } from '@/server/lib/formatting';

describe('formatting', () => {
  it('formats datetimes in a deterministic UTC representation', () => {
    expect(formatDateTime('2026-03-04T12:34:56.000Z')).toBe('04 Mar 2026, 12:34 UTC');
  });

  it('returns N/A for null or invalid datetimes', () => {
    expect(formatDateTime(null)).toBe('N/A');
    expect(formatDateTime('not-a-date')).toBe('N/A');
  });
});
