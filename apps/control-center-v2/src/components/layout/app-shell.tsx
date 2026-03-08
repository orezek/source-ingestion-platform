'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { LiveIndicator } from '@/components/state/live-indicator';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import type { ControlServiceHeartbeat } from '@/lib/contracts';
import { cn, formatDateTime } from '@/lib/utils';

const navItems = [
  { href: '/pipelines', label: 'Pipelines', short: 'PI' },
  { href: '/runs', label: 'Runs', short: 'RU' },
];

const heartbeatToState = (
  heartbeat: ControlServiceHeartbeat | null,
): 'connecting' | 'live' | 'stale' => {
  if (!heartbeat) return 'stale';
  if (!heartbeat.mongoReady) return 'stale';
  if (heartbeat.subscriptionEnabled && !heartbeat.consumerReady) return 'connecting';
  return 'live';
};

function getPageHeader(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/pipelines') {
    return {
      title: 'Pipelines',
      subtitle: 'Manage crawler definitions and ingestion configurations.',
    };
  }

  if (pathname === '/runs') {
    return {
      title: 'Execution Runs',
      subtitle: 'Live cross-pipeline execution feed and history.',
    };
  }

  if (/^\/runs\/[^/]+/.test(pathname)) {
    return {
      title: 'Run Details',
      subtitle: 'Execution trace and telemetry for the selected run.',
    };
  }

  if (/^\/pipelines\/[^/]+/.test(pathname)) {
    return {
      title: 'Pipeline Details',
      subtitle: 'Configuration, embedded profiles, and execution history.',
    };
  }

  return {
    title: 'Operator Surface',
    subtitle: 'Pipeline-owned runs with live control-plane state.',
  };
}

function NavContent({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="border-b border-[var(--theme-structure)] p-4">
        <div className="text-base font-semibold text-foreground">Control Center v2</div>
      </div>
      <nav className="grid gap-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-sm border px-3 py-3 text-sm uppercase tracking-[0.14em] transition-colors',
                active
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground',
              )}
            >
              <span className="font-mono text-[0.68rem]">{item.short}</span>
              <span className={compact ? 'sr-only' : ''}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell({
  children,
  heartbeat,
}: {
  children: React.ReactNode;
  heartbeat: ControlServiceHeartbeat | null;
}) {
  const pathname = usePathname();
  const state = heartbeatToState(heartbeat);
  const pageHeader = getPageHeader(pathname);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-[1440px]">
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh flex-col border-r border-border bg-card transition-all duration-150 ease-in-out lg:flex',
            isSidebarOpen
              ? 'w-72 px-5 py-5 opacity-100'
              : 'w-0 overflow-hidden border-none px-0 py-5 opacity-0',
          )}
        >
          <div className="w-64">
            <NavContent pathname={pathname} />
          </div>
        </aside>
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <header className="border-b border-border bg-background/95 backdrop-blur">
            <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-start gap-3">
                <div className="lg:hidden">
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button variant="secondary" size="sm" aria-label="Open navigation">
                        <span className="font-mono text-xs">NAV</span>
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="left">
                      <NavContent pathname={pathname} compact />
                    </SheetContent>
                  </Sheet>
                </div>
                <div className="hidden lg:block pt-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 px-0 py-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    aria-label="Toggle navigation"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                      <line x1="9" x2="9" y1="3" y2="21" />
                    </svg>
                  </Button>
                </div>
                <div className="min-w-0 space-y-2">
                  <Breadcrumbs />
                  <div>
                    <h1 className="text-xl font-semibold tracking-tightest sm:text-2xl">
                      {pageHeader.title}
                    </h1>
                    <p className="text-sm text-muted-foreground">{pageHeader.subtitle}</p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <LiveIndicator state={state} />
                <div className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                  {heartbeat ? formatDateTime(heartbeat.now) : 'Heartbeat unavailable'}
                </div>
              </div>
            </div>
          </header>
          <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
