'use client';

import { useState, useEffect, useMemo } from 'react';
import type { MarketplacePlugin } from '@/lib/marketplace';

interface UseMarketplaceResult {
  plugins: MarketplacePlugin[];
  categories: string[];
  loading: boolean;
  error: string | null;
}

export function useMarketplace(): UseMarketplaceResult {
  const [allPlugins, setAllPlugins] = useState<MarketplacePlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/marketplace')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch marketplace');
        return r.json();
      })
      .then((data) => {
        setAllPlugins(data.plugins || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(allPlugins.map((p) => p.category).filter(Boolean))
      ) as string[],
    [allPlugins]
  );

  return { plugins: allPlugins, categories, loading, error };
}
