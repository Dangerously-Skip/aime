import pino from "pino";
import { AsyncLocalStorage } from "node:async_hooks";

const ENV = process.env.NODE_ENV || process.env.ENVIRONMENT || "development";

export interface CorrelationContext {
  correlationId: string;
  requestId: string;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    application: process.env.APPLICATION_NAME || "quarry",
    environment: ENV === "production" ? "prod" : "kaos",
  },
  ...(ENV === "production"
    ? {} // raw JSON output for log shipping
    : { transport: { target: "pino-pretty" } }),
  timestamp: pino.stdTimeFunctions.isoTime,
});

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

export function withCorrelation<T>(ctx: CorrelationContext, fn: () => T): T {
  return correlationStorage.run(ctx, fn);
}

/**
 * Returns a child logger bound to the current correlation context (if any).
 * Use this inside API route handlers so log lines automatically carry the
 * correlation/request IDs without callers having to thread them manually.
 */
export function getLogger(): pino.Logger {
  const ctx = getCorrelationContext();
  if (!ctx) return logger;
  return logger.child({ correlationId: ctx.correlationId, requestId: ctx.requestId });
}
