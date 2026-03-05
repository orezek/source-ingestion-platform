export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <section className="panel error-state">
      <p className="eyebrow">Error</p>
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}
