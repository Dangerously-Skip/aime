'use client';

import { useEffect, useRef } from 'react';
import { useRehydrated } from '@/components/store-hydration';
import { pullPendingMemories } from '@/lib/memory/pending-pull';

/**
 * Collect memories extracted while the window was closed — or by a turn whose
 * post-`done` pull never completed because the app quit first.
 *
 * Once per launch, and only after the persisted stores have really loaded
 * (`useRehydrated`, not `useHydrated`): storing into a store still holding its
 * defaults would be overwritten by the rehydrate, after the server had already
 * been told to forget the items.
 */
export function usePendingMemoryPull(): void {
  const rehydrated = useRehydrated();
  const pulled = useRef(false);
  useEffect(() => {
    if (!rehydrated || pulled.current) return;
    pulled.current = true;
    void pullPendingMemories();
  }, [rehydrated]);
}
