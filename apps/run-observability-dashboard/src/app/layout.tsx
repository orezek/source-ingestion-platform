import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import '@/app/globals.css';
import { DashboardShell } from '@/components/layout/dashboard-shell';

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Run Observability Dashboard',
  description: 'Operational dashboard for JobCompass crawler and ingestion run summaries.',
  icons: {
    icon: '/dashboard-mark.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plexMono.variable}>
      <body>
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
