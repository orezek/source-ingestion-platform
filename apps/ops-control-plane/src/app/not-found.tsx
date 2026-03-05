import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';

export default function NotFound() {
  return (
    <AppShell>
      <section className="panel empty-state">
        <p className="eyebrow">Not found</p>
        <h1>Requested run was not found</h1>
        <p>The requested crawler, ingestion, or pipeline run could not be located.</p>
        <Link className="primary-link" href="/">
          Back to overview
        </Link>
      </section>
    </AppShell>
  );
}
