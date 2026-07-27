"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConnectionHealth, ConnectorHealthReport, DriftReport } from "@/lib/connectors/health";

/**
 * Connection health for the Connectors UI (P3.4).
 *
 * The client store and the provisioned MCP config are two copies of the same
 * fact, and the config is the one the agent actually uses. This hook asks the
 * server which connections are really usable, so the UI can show "Reconnect"
 * on a dead one instead of a green "Connected" that lies.
 *
 * Health is derived from stored metadata server-side with no network calls, so
 * refreshing is cheap.
 */

interface HealthResponse {
  connectors?: ConnectorHealthReport[];
  needsReconnect?: string[];
  drift?: DriftReport;
}

export interface UseConnectorHealth {
  reports: ConnectorHealthReport[];
  /** Ids whose connection is provisioned but unusable without reconnecting. */
  needsReconnect: Set<string>;
  /** Disagreement between the UI's view and what is provisioned. */
  drift: DriftReport | null;
  loading: boolean;
  healthOf: (id: string) => ConnectionHealth | undefined;
  refresh: () => Promise<void>;
}

export function useConnectorHealth(clientConnectedIds: string[] = []): UseConnectorHealth {
  const [reports, setReports] = useState<ConnectorHealthReport[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState<Set<string>>(new Set());
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(false);

  // Join into a stable string so the identity of the caller's array doesn't
  // retrigger the fetch on every render.
  const claimed = useMemo(() => [...clientConnectedIds].sort().join(","), [clientConnectedIds]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = claimed ? `?clientConnected=${encodeURIComponent(claimed)}` : "";
      const res = await fetch(`/api/connectors/health${query}`);
      if (!res.ok) return;
      const data = (await res.json()) as HealthResponse;
      setReports(data.connectors ?? []);
      setNeedsReconnect(new Set(data.needsReconnect ?? []));
      setDrift(data.drift ?? null);
    } catch {
      // Health is advisory — a failed probe must not break the connectors screen.
    } finally {
      setLoading(false);
    }
  }, [claimed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const healthOf = useCallback(
    (id: string) => reports.find((r) => r.id === id)?.health,
    [reports],
  );

  return { reports, needsReconnect, drift, loading, healthOf, refresh };
}
