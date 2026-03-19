'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Stethoscope } from 'lucide-react';

interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

interface DoctorResult {
  ok: boolean;
  summary: 'ok' | 'warn' | 'error';
  checks: HealthCheck[];
}

function StatusIcon({ status }: { status: HealthCheck['status'] }) {
  if (status === 'ok') return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === 'warn') return <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
}

function statusBg(status: HealthCheck['status']) {
  if (status === 'ok') return 'bg-green-500/5 border-green-500/20';
  if (status === 'warn') return 'bg-yellow-500/5 border-yellow-500/20';
  return 'bg-destructive/5 border-destructive/20';
}

export function DoctorPanel() {
  const [result, setResult] = useState<DoctorResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/doctor');
      const data = await res.json() as DoctorResult;
      setResult(data);
    } catch (err) {
      setResult({
        ok: false,
        summary: 'error',
        checks: [{
          id: 'network',
          label: 'Doctor fetch',
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to reach /api/doctor',
        }],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Stethoscope className="h-4 w-4" />
          System Health
        </h3>
        <Button size="sm" variant="outline" onClick={run} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking…' : result ? 'Re-run' : 'Run checks'}
        </Button>
      </div>

      {!result && !loading && (
        <p className="text-xs text-muted-foreground">
          Run health checks to verify your API keys, identity files, and connector configuration.
        </p>
      )}

      {result && (
        <div className="space-y-2">
          {result.checks.map((check) => (
            <div
              key={check.id}
              className={`flex items-start gap-3 p-3 rounded-lg border ${statusBg(check.status)}`}
            >
              <StatusIcon status={check.status} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{check.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{check.message}</p>
                {check.fix && (
                  <p className="text-[11px] text-blue-500 mt-1">Fix: {check.fix}</p>
                )}
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {result.summary === 'ok' && '✓ All checks passed'}
              {result.summary === 'warn' && `${result.checks.filter((c) => c.status === 'warn').length} warning(s) — not critical`}
              {result.summary === 'error' && `${result.checks.filter((c) => c.status === 'error').length} error(s) require attention`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
