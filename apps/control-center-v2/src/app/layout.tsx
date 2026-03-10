import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import '@/app/globals.css';
import { AppShell } from '@/components/layout/app-shell';
import { getHeartbeat } from '@/lib/control-service-client';

const sidebarOpenCookieKey = 'control-center-v2-sidebar-open';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Control Center v2',
  description: 'Mobile-first operator UI for OmniCrawl control-service v2.',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const initialSidebarOpen = cookieStore.get(sidebarOpenCookieKey)?.value !== 'false';
  const heartbeat = await getHeartbeat().catch(() => null);

  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>
        <AppShell heartbeat={heartbeat} initialSidebarOpen={initialSidebarOpen}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
