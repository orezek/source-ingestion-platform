import type { ReactNode } from 'react';
import { SectionHeading } from '@/components/control-plane/section-heading';

type JsonViewerPanelProps = {
  eyebrow: string;
  title: string;
  value: unknown;
  emptyCopy: string;
  description?: string;
  rootLabel?: string;
  defaultOpenDepth?: number;
};

function formatPrimitive(value: null | boolean | number | string): ReactNode {
  if (value === null) {
    return <span className="json-viewer__value json-viewer__value--null">null</span>;
  }

  switch (typeof value) {
    case 'boolean':
      return (
        <span className="json-viewer__value json-viewer__value--boolean">{String(value)}</span>
      );
    case 'number':
      return <span className="json-viewer__value json-viewer__value--number">{value}</span>;
    default:
      return (
        <span className="json-viewer__value json-viewer__value--string">
          &quot;
          {value}
          &quot;
        </span>
      );
  }
}

function renderJsonNode(input: {
  label: string;
  value: unknown;
  depth: number;
  defaultOpenDepth: number;
}): ReactNode {
  const { label, value, depth, defaultOpenDepth } = input;

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return (
      <div className="json-viewer__row">
        <span className="json-viewer__label">{label}</span>
        <span className="json-viewer__separator">:</span>
        {formatPrimitive(value)}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <details className="json-viewer__branch" open={depth < defaultOpenDepth}>
        <summary className="json-viewer__summary">
          <span className="json-viewer__label">{label}</span>
          <span className="json-viewer__meta">[{value.length}]</span>
        </summary>
        <div className="json-viewer__children">
          {value.length === 0 ? (
            <div className="json-viewer__row">
              <span className="json-viewer__value json-viewer__value--null">empty array</span>
            </div>
          ) : (
            value.map((item, index) => (
              <div key={`${label}-${index}`} className="json-viewer__node">
                {renderJsonNode({
                  label: `[${index}]`,
                  value: item,
                  depth: depth + 1,
                  defaultOpenDepth,
                })}
              </div>
            ))
          )}
        </div>
      </details>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return (
      <details className="json-viewer__branch" open={depth < defaultOpenDepth}>
        <summary className="json-viewer__summary">
          <span className="json-viewer__label">{label}</span>
          <span className="json-viewer__meta">{`{${entries.length}}`}</span>
        </summary>
        <div className="json-viewer__children">
          {entries.length === 0 ? (
            <div className="json-viewer__row">
              <span className="json-viewer__value json-viewer__value--null">empty object</span>
            </div>
          ) : (
            entries.map(([entryLabel, entryValue]) => (
              <div key={`${label}-${entryLabel}`} className="json-viewer__node">
                {renderJsonNode({
                  label: entryLabel,
                  value: entryValue,
                  depth: depth + 1,
                  defaultOpenDepth,
                })}
              </div>
            ))
          )}
        </div>
      </details>
    );
  }

  return (
    <div className="json-viewer__row">
      <span className="json-viewer__label">{label}</span>
      <span className="json-viewer__separator">:</span>
      <span className="json-viewer__value">{String(value)}</span>
    </div>
  );
}

export function JsonViewerPanel({
  eyebrow,
  title,
  value,
  emptyCopy,
  description,
  rootLabel = 'root',
  defaultOpenDepth = 2,
}: JsonViewerPanelProps) {
  return (
    <section className="panel">
      <SectionHeading eyebrow={eyebrow} title={title} description={description} />
      {value === null || value === undefined ? (
        <p className="empty-copy">{emptyCopy}</p>
      ) : (
        <div className="json-viewer">
          {renderJsonNode({ label: rootLabel, value, depth: 0, defaultOpenDepth })}
        </div>
      )}
    </section>
  );
}
