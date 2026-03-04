'use client';

import type { ReactNode } from 'react';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { RouteBreadcrumbs } from '@/components/layout/route-breadcrumbs';

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-shell__sidebar">
        <DashboardSidebar />
      </aside>
      <div className="dashboard-shell__content">
        <header className="dashboard-shell__header">
          <div className="dashboard-shell__header-inner">
            <RouteBreadcrumbs />
          </div>
        </header>
        <main className="dashboard-shell__main">{children}</main>
      </div>
    </div>
  );
}
