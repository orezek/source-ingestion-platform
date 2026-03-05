'use client';

import type { ReactNode } from 'react';
import { SectionHeading } from '@/components/control-plane/section-heading';

export function ChartFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="panel chart-panel">
      <SectionHeading eyebrow="Trend" title={title} description={description} />
      <div className="chart-container">{children}</div>
    </section>
  );
}
