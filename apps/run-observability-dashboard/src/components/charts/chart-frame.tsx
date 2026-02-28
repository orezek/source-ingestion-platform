'use client';

import type { ReactNode } from 'react';

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
      <div className="section-heading">
        <p className="eyebrow">Trend</p>
        <h2>{title}</h2>
        <p className="chart-copy">{description}</p>
      </div>
      <div className="chart-container">{children}</div>
    </section>
  );
}
