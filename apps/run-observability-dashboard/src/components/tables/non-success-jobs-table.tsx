import type { FailedJobView, NonSuccessJobView } from '@/server/types';

export function NonSuccessJobsTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<NonSuccessJobView | FailedJobView>;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <p className="eyebrow">Audit</p>
        <h2>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="empty-copy">No rows in this category.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table data-table--stacked">
            <thead>
              <tr>
                <th>Source ID</th>
                <th>Title</th>
                <th>Company</th>
                <th>Location</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sourceId + ('reason' in row ? row.reason : row.errorMessage)}>
                  <td>{row.sourceId}</td>
                  <td>{row.title ?? 'N/A'}</td>
                  <td>{row.company ?? 'N/A'}</td>
                  <td>{'location' in row ? (row.location ?? 'N/A') : 'N/A'}</td>
                  <td>
                    {'reason' in row
                      ? row.reason
                      : `${row.errorName ?? 'Error'}: ${row.errorMessage}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
