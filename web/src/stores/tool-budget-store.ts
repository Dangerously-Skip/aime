import { create } from 'zustand';
import type { ToolBudgetReport } from '@/lib/mcp/filter';

/**
 * The last observed tool budget (P3.5).
 *
 * Tool counts are only knowable from a live session — the SDK reports them at
 * system init, after connecting to every MCP server — but the place a user can
 * act on the number is the Connectors screen, which has no session. So the
 * newest report is recorded here when a chat starts and read there.
 *
 * Deliberately NOT persisted: a stale count from a previous configuration would
 * be worse than none, since the whole point is telling the user what is mounted
 * right now.
 */
interface ToolBudgetState {
  report: ToolBudgetReport | null;
  /** When the report was captured, so the UI can say how fresh it is. */
  observedAt: number | null;
  setReport: (report: ToolBudgetReport) => void;
  clear: () => void;
}

export const useToolBudgetStore = create<ToolBudgetState>((set) => ({
  report: null,
  observedAt: null,
  setReport: (report) => set({ report, observedAt: Date.now() }),
  clear: () => set({ report: null, observedAt: null }),
}));
