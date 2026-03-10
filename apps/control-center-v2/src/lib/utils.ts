import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export const formatDateTime = (value: string | null): string => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const parts = dateTimeFormatter.formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const year = parts.find((part) => part.type === 'year')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value;

  if (!month || !day || !year || !hour || !minute || !dayPeriod) {
    return dateTimeFormatter.format(date);
  }

  return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod}`;
};

export const formatNullableCount = (value: number | null | undefined): string => {
  if (value == null) {
    return '—';
  }

  return new Intl.NumberFormat('en').format(value);
};

export const titleCaseFromToken = (value: string): string =>
  value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

export const splitTextareaLines = (value: string): string[] =>
  value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
