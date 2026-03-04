type SkeletonTableProps = {
  columns: string[];
  rows?: number;
  bounded?: boolean;
};

const DEFAULT_ROW_IDS = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6'];

export function SkeletonKpiCard() {
  return (
    <article className="kpi-card" aria-hidden="true">
      <div className="skeleton skeleton--label" />
      <div className="skeleton skeleton--metric" />
      <div className="skeleton skeleton--line skeleton--line-short" />
    </article>
  );
}

export function SkeletonSectionHeading() {
  return (
    <div className="section-heading" aria-hidden="true">
      <div className="section-heading__row">
        <div className="skeleton skeleton--label" />
        <div className="skeleton skeleton--label skeleton--label-short" />
      </div>
      <div className="skeleton skeleton--line skeleton--line-short" />
    </div>
  );
}

export function SkeletonChartPanel() {
  return (
    <section className="panel chart-panel" aria-hidden="true">
      <SkeletonSectionHeading />
      <div className="skeleton skeleton--chart" />
    </section>
  );
}

export function SkeletonTable({ columns, rows = 6, bounded = false }: SkeletonTableProps) {
  const rowIds = DEFAULT_ROW_IDS.slice(0, Math.max(1, rows));
  const tableWrapClassName = bounded ? 'table-wrap table-wrap--bounded' : 'table-wrap';

  return (
    <div className={tableWrapClassName} aria-hidden="true">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>
                <div className="skeleton skeleton--line skeleton--line-short" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIds.map((rowId) => (
            <tr key={rowId}>
              {columns.map((column) => (
                <td key={`${rowId}-${column}`}>
                  <div className="skeleton skeleton--table-cell" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
