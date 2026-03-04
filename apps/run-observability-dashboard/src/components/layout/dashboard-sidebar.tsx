'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type SidebarItem = {
  key: 'dashboard' | 'control-plane' | 'pipelines' | 'setup';
  label: string;
  href: string;
  shortLabel: string;
};

const SIDEBAR_ITEMS: SidebarItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: '/',
    shortLabel: 'DB',
  },
  {
    key: 'control-plane',
    label: 'Control Plane',
    href: '/control-plane',
    shortLabel: 'CP',
  },
  {
    key: 'pipelines',
    label: 'Pipelines',
    href: '/control-plane#pipelines',
    shortLabel: 'PL',
  },
  {
    key: 'setup',
    label: 'Setup',
    href: '/control-plane#setup',
    shortLabel: 'SU',
  },
];

function getActiveKey(pathname: string, hash: string): SidebarItem['key'] {
  if (pathname === '/control-plane' && hash === '#pipelines') {
    return 'pipelines';
  }

  if (pathname === '/control-plane' && hash === '#setup') {
    return 'setup';
  }

  if (pathname.startsWith('/control-plane')) {
    return 'control-plane';
  }

  return 'dashboard';
}

export function DashboardSidebar() {
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

  const activeKey = getActiveKey(pathname, hash);

  return (
    <div className="dashboard-sidebar">
      <p className="dashboard-sidebar__title">Run Observatory</p>
      <nav aria-label="Primary" className="dashboard-sidebar__nav">
        {SIDEBAR_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="dashboard-sidebar__link"
            data-active={activeKey === item.key ? 'true' : 'false'}
          >
            <span aria-hidden="true" className="dashboard-sidebar__icon">
              {item.shortLabel}
            </span>
            <span className="dashboard-sidebar__label">{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
