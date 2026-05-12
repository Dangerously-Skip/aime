import { randomUUID } from "node:crypto";
import { withCorrelation, type CorrelationContext } from "../lib/logger";

/**
 * Wraps a Next.js App Router route handler so it runs inside a correlation
 * AsyncLocalStorage scope. Any `getLogger()` calls inside the handler (or
 * anything it awaits) will inherit the correlation/request IDs.
 *
 * This pattern is used here instead of a top-level `src/middleware.ts` because
 * Next.js middleware runs in the Edge runtime by default and does not
 * propagate Node's AsyncLocalStorage into the Node.js API route runtime.
 *
 * Usage in a route file:
 *
 * ```ts
 * import { withRequestContext } from "@/middleware/correlation";
 *
 * export const GET = withRequestContext(async (req) => {
 *   getLogger().info({ url: req.url }, "handling request");
 *   return Response.json({ ok: true });
 * });
 * ```
 */
type RouteHandler<T extends Request = Request> = (
  req: T,
  ctx?: unknown,
) => Promise<Response> | Response;

export function withRequestContext<T extends Request = Request>(
  handler: RouteHandler<T>,
): RouteHandler<T> {
  return async (req, ctx) => {
    const headerValue = req.headers.get("x-correlation-id");
    const correlationContext: CorrelationContext = {
      correlationId: headerValue || randomUUID(),
      requestId: randomUUID(),
    };
    const response = await withCorrelation(correlationContext, () => handler(req, ctx));
    // Echo the correlation ID back so callers can stitch logs across services.
    if (response && typeof response === "object" && "headers" in response) {
      try {
        response.headers.set("x-correlation-id", correlationContext.correlationId);
      } catch {
        // Some Response implementations have immutable headers; ignore.
      }
    }
    return response;
  };
}
