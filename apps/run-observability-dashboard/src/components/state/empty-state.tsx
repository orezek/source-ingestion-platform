import { EmptyTray } from '@/components/state/empty-tray';

export function EmptyState({ title, message }: { title: string; message: string }) {
  return <EmptyTray label="No data" title={title} message={message} />;
}
