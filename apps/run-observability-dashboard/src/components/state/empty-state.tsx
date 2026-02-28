export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <section className="panel empty-state">
      <p className="eyebrow">No data</p>
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}
