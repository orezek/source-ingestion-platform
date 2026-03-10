import { describe, expect, it } from 'vitest';
import { formatDateTime } from '@/lib/utils';

describe('formatDateTime', () => {
  it('returns a deterministic date time pattern', () => {
    const formatted = formatDateTime('2026-03-10T19:27:00.000Z');
    expect(formatted).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/u);
    expect(formatted).not.toContain(' at ');
  });

  it('returns em dash for null and invalid dates', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
