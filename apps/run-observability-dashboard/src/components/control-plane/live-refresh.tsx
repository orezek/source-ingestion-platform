'use client';

import { useEffect, useEffectEvent, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type LiveRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
};

export function LiveRefresh({ enabled, intervalMs = 3_000 }: LiveRefreshProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const refresh = useEffectEvent(() => {
    if (!enabled || isPending || document.visibilityState !== 'visible') {
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  });

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refresh();
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, refresh]);

  return null;
}
