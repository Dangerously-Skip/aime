'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface NangoConfig {
  publicKey: string;
  serverUrl: string;
  configured: boolean;
}

interface NangoAuthResult {
  providerConfigKey: string;
  connectionId: string;
}

export function useNango() {
  const [config, setConfig] = useState<NangoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const nangoRef = useRef<{ auth: (integrationId: string, connectionId: string) => Promise<NangoAuthResult> } | null>(null);

  useEffect(() => {
    fetch('/api/nango/config')
      .then((r) => r.json())
      .then((data: NangoConfig) => {
        setConfig(data);
        if (data.configured) {
          import('@nangohq/frontend').then(({ default: Nango }) => {
            nangoRef.current = new Nango({
              publicKey: data.publicKey,
              host: data.serverUrl,
            });
          });
        }
      })
      .catch(() => setConfig({ publicKey: '', serverUrl: '', configured: false }))
      .finally(() => setLoading(false));
  }, []);

  const connect = useCallback(
    async (integrationId: string): Promise<{ success: boolean; connectionId?: string }> => {
      const res = await fetch('/api/nango/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId }),
      });

      if (!res.ok) return { success: false };

      const { connectionId } = await res.json();

      if (!nangoRef.current) return { success: false };

      try {
        await nangoRef.current.auth(integrationId, connectionId);
        return { success: true, connectionId };
      } catch {
        return { success: false };
      }
    },
    []
  );

  const disconnect = useCallback(
    async (integrationId: string, connectionId: string): Promise<boolean> => {
      const res = await fetch('/api/nango/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId, connectionId }),
      });
      return res.ok;
    },
    []
  );

  return {
    isConfigured: config?.configured ?? false,
    loading,
    connect,
    disconnect,
  };
}
