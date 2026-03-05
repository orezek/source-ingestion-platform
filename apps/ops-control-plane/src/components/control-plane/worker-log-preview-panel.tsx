'use client';

import { useMemo, useState } from 'react';
import { formatCompactBytes } from '@/server/lib/formatting';
import type { ControlPlaneFilePreview } from '@/server/control-plane/file-previews';
import { SectionHeading } from '@/components/control-plane/section-heading';
import { EmptyTray } from '@/components/state/empty-tray';

type WorkerLogPreviewPanelProps = {
  eyebrow: string;
  title: string;
  preview: ControlPlaneFilePreview | null;
  emptyCopy: string;
};

type PrettyLogTone = 'plain' | 'debug' | 'info' | 'warn' | 'error';

type PrettyLogLine = {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  details: string;
  tone: PrettyLogTone;
};

const logMetadataKeys = new Set([
  'level',
  'time',
  'timestamp',
  'ts',
  'pid',
  'hostname',
  'msg',
  'message',
  'name',
  'v',
]);

function truncate(value: string, max = 240): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}…`;
}

function toUtcStamp(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return formatUtcDate(new Date(raw));
  }

  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.valueOf())) {
      return formatUtcDate(parsed);
    }
  }

  return '-';
}

function formatUtcDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  const seconds = String(value.getUTCSeconds()).padStart(2, '0');
  const millis = String(value.getUTCMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}Z`;
}

function stringifyValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function normalizeLevel(value: unknown): { label: string; tone: PrettyLogTone } {
  if (typeof value === 'number') {
    if (value >= 60) {
      return { label: 'FATAL', tone: 'error' };
    }
    if (value >= 50) {
      return { label: 'ERROR', tone: 'error' };
    }
    if (value >= 40) {
      return { label: 'WARN', tone: 'warn' };
    }
    if (value >= 30) {
      return { label: 'INFO', tone: 'info' };
    }
    if (value >= 20) {
      return { label: 'DEBUG', tone: 'debug' };
    }
    if (value >= 10) {
      return { label: 'TRACE', tone: 'debug' };
    }
  }

  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    if (upper.includes('ERROR') || upper.includes('FATAL')) {
      return { label: upper, tone: 'error' };
    }
    if (upper.includes('WARN')) {
      return { label: upper, tone: 'warn' };
    }
    if (upper.includes('DEBUG') || upper.includes('TRACE')) {
      return { label: upper, tone: 'debug' };
    }
    if (upper.includes('INFO')) {
      return { label: upper, tone: 'info' };
    }

    return { label: upper, tone: 'plain' };
  }

  return { label: 'LINE', tone: 'plain' };
}

function parsePrettyLogLines(contents: string): PrettyLogLine[] {
  return contents.split('\n').map((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return {
        id: `line-${index}`,
        timestamp: '-',
        level: 'LINE',
        message: '',
        details: '',
        tone: 'plain',
      };
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const payload = parsed as Record<string, unknown>;
        const level = normalizeLevel(payload.level);
        const timestamp = toUtcStamp(payload.time ?? payload.timestamp ?? payload.ts);
        const messageRaw =
          payload.msg ??
          payload.message ??
          (typeof payload.err === 'object' && payload.err !== null
            ? (payload.err as { message?: unknown }).message
            : undefined) ??
          '';
        const details = Object.entries(payload)
          .filter(([key]) => !logMetadataKeys.has(key))
          .map(([key, value]) => `${key}=${truncate(stringifyValue(value), 200)}`)
          .join(' • ');

        return {
          id: `line-${index}`,
          timestamp,
          level: level.label,
          message: truncate(stringifyValue(messageRaw), 260),
          details,
          tone: level.tone,
        };
      }
    } catch {
      // Keep non-JSON log lines readable in pretty mode.
    }

    return {
      id: `line-${index}`,
      timestamp: '-',
      level: 'LINE',
      message: truncate(trimmed, 320),
      details: '',
      tone: 'plain',
    };
  });
}

export function WorkerLogPreviewPanel({
  eyebrow,
  title,
  preview,
  emptyCopy,
}: WorkerLogPreviewPanelProps) {
  const [mode, setMode] = useState<'pretty' | 'raw'>('pretty');
  const lines = useMemo(() => {
    if (!preview?.exists || !preview.contents) {
      return [];
    }

    return parsePrettyLogLines(preview.contents);
  }, [preview?.contents, preview?.exists]);

  return (
    <section className="panel">
      <SectionHeading eyebrow={eyebrow} title={title} description="" />
      {preview?.exists && preview.contents ? (
        <>
          <div className="log-preview-controls">
            <p className="empty-copy">
              {preview.path}
              {preview.sizeBytes ? ` • ${formatCompactBytes(preview.sizeBytes)} bytes` : ''}
              {preview.truncated ? ' • preview truncated' : ''}
            </p>
            <div className="log-preview-toggle" role="tablist" aria-label={`${title} view mode`}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'pretty'}
                data-active={mode === 'pretty' ? 'true' : 'false'}
                onClick={() => setMode('pretty')}
              >
                Pretty
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'raw'}
                data-active={mode === 'raw' ? 'true' : 'false'}
                onClick={() => setMode('raw')}
              >
                Raw
              </button>
            </div>
          </div>
          {mode === 'pretty' ? (
            <div className="log-preview-table-wrap">
              <table className="data-table log-preview-table">
                <thead>
                  <tr>
                    <th>TIME</th>
                    <th>LEVEL</th>
                    <th>MESSAGE</th>
                    <th>DETAILS</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.timestamp}</td>
                      <td>
                        <span className={`log-level-chip log-level-chip--${line.tone}`}>
                          {line.level}
                        </span>
                      </td>
                      <td className="log-preview-cell--message">{line.message || ' '}</td>
                      <td className="log-preview-cell--details">{line.details || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="code-panel log-preview-raw">{preview.contents}</pre>
          )}
        </>
      ) : (
        <EmptyTray
          className="empty-tray--compact"
          label={eyebrow}
          title="No log output"
          message={emptyCopy}
        />
      )}
    </section>
  );
}
