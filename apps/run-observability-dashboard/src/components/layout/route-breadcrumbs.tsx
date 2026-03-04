'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BreadcrumbNav } from '@/components/layout/breadcrumb-nav';

type Crumb = {
  label: string;
  href?: string;
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function humanizeSegment(segment: string): string {
  return decodeSegment(segment)
    .replace(/[-_]/gu, ' ')
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

function buildControlPlaneCrumbs(segments: string[], hash: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/' }, { label: 'Control Plane' }];

  if (segments[1] === 'runs' && segments[2]) {
    const runId = decodeSegment(segments[2]);
    crumbs[1] = { label: 'Control Plane', href: '/control-plane' };
    crumbs.push({
      label: `Run: ${runId}`,
      href: segments.length > 3 ? `/control-plane/runs/${segments[2]}` : undefined,
    });

    if (segments[3] === 'artifacts' && segments[4]) {
      crumbs.push({ label: `Artifact: ${decodeSegment(segments[4])}` });
    } else if (segments[3] === 'outputs' && segments[5]) {
      crumbs.push({ label: `Output: ${decodeSegment(segments[5])}` });
    }

    return crumbs;
  }

  if (hash === '#pipelines') {
    crumbs[1] = { label: 'Control Plane', href: '/control-plane' };
    crumbs.push({ label: 'Pipelines' });
  } else if (hash === '#setup') {
    crumbs[1] = { label: 'Control Plane', href: '/control-plane' };
    crumbs.push({ label: 'Setup' });
  }

  return crumbs;
}

function buildCrumbs(pathname: string, hash: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return [{ label: 'Dashboard' }];
  }

  if (segments[0] === 'control-plane') {
    return buildControlPlaneCrumbs(segments, hash);
  }

  if (segments[0] === 'crawler' && segments[1] === 'runs' && segments[2]) {
    return [
      { label: 'Dashboard', href: '/' },
      { label: 'Crawler', href: '/' },
      { label: `Run: ${decodeSegment(segments[2])}` },
    ];
  }

  if (segments[0] === 'ingestion' && segments[1] === 'runs' && segments[2]) {
    return [
      { label: 'Dashboard', href: '/' },
      { label: 'Ingestion', href: '/' },
      { label: `Run: ${decodeSegment(segments[2])}` },
    ];
  }

  if (segments[0] === 'pipeline' && segments[1]) {
    return [
      { label: 'Dashboard', href: '/' },
      { label: 'Pipeline', href: '/' },
      { label: `Run: ${decodeSegment(segments[1])}` },
    ];
  }

  return [
    { label: 'Dashboard', href: '/' },
    ...segments.map((segment) => ({ label: humanizeSegment(segment) })),
  ];
}

export function RouteBreadcrumbs() {
  const pathname = usePathname();
  const [hash, setHash] = useState('');

  useEffect(() => {
    const syncHash = () => {
      setHash(window.location.hash);
    };

    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
    };
  }, [pathname]);

  return <BreadcrumbNav items={buildCrumbs(pathname, hash)} />;
}
