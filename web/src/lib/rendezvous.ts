/**
 * One cross-request rendezvous, used by every "pause the agent until something
 * outside this request answers" bridge in the app.
 *
 * The shape is always the same: `canUseTool` (or an in-process MCP tool handler)
 * runs inside the SDK loop on the STREAMING request and needs a value that will
 * only arrive on a DIFFERENT HTTP request — the user's answer, a browser tool
 * result, an OAuth outcome, a PDF print. So the waiter parks a promise in a
 * module-level map keyed by an id both sides know, and the later request settles
 * it.
 *
 * `pending-questions`, `pending-browser-tools`, `pending-connectors` and
 * `pending-documents` were four hand-copied versions of this, differing only in
 * the timeout and in whether a timeout resolves or rejects. The copy-paste was
 * visible: `pending-connectors` declared and stored a `reject` field that nothing
 * ever called, carried over from `pending-questions`.
 *
 * The one behaviour none of them had, and the reason this exists rather than a
 * shared type alias: ABORT CANCELLATION. Pressing Stop with a connector card open
 * left a live 5-minute timer and a captured `resolve` closure with nobody to call
 * it. A wait is now tied to the AbortSignal of the query that opened it, so a
 * cancelled turn takes its rendezvous entries with it.
 */

/**
 * Mint the id a resolution has to present — a label plus a nonce.
 *
 * WHY. Every one of these bridges is settled by an unauthenticated localhost
 * route (/api/chat/answer, /api/chat/connector-result, /api/chat/document-result,
 * /api/chat/browser-tool-result). Knowing the id IS the authorisation, so the id
 * has to be something only the client we sent the card to could know.
 *
 * Used by the question, connector and document bridges. NOT yet by the
 * browser-tool one, which is still keyed by the raw `toolUseID` — and should not be
 * read as safe for that reason. The obstacle is only incidental: the Code surface
 * uses that same id as the tool-call id in its transcript, so giving the relay a
 * different one risks the same call appearing twice. Worth doing separately, since a
 * forged browser-tool result puts attacker text in front of the model as fact.
 *
 * THE THREAT, honestly. The attacker this actually stops is a BLIND one. Any web
 * page the user has open can POST JSON at 127.0.0.1 — a cross-origin request is
 * sent, only the response is withheld — and so can any other program on the
 * machine. Such a caller could fabricate `connected: true` and make the model tell
 * the user a service is wired up when it is not, or answer a permission prompt
 * with "Allow". What it cannot do is READ the SSE stream, so it cannot learn a
 * value that only ever travelled on that stream.
 *
 * WHY NOT JUST THE `toolUseID`, which these waits used to be keyed by. It is
 * random too, so this is not a guessing argument — it is an exposure one. That id
 * is written to the server's stdout and carried on every `tool_use` chunk, and it
 * is an IDENTIFIER: its job is to be quotable, so the next thing to log or expose
 * it is a reasonable change that would silently be a security regression. The
 * handle exists only to be presented back, which is a property a reader can check.
 *
 * WHAT THIS DOES NOT DO. A local process that can read this machine's memory, the
 * persisted conversation store, or the renderer's devtools can recover a handle.
 * It can also read ~/.claude credentials outright, so it is already past anything
 * this file could do about it. This is not an auth scheme and is not pretending to
 * be one — it is proof that a resolution came from the card we sent.
 *
 * @param label anything that helps a human reading a log: a tool use id, "doc".
 */
export function issueHandle(label: string): string {
  return `${label}.${globalThis.crypto.randomUUID()}`;
}

/** How a wait ends when nobody answers: with a value, or with an error. */
export type Settlement<T> = { resolve: T } | { reject: string };

export interface WaitOptions {
  /**
   * The signal of the query that opened this wait. When it aborts, the wait
   * settles immediately with `onAbort` and the entry is freed — instead of
   * holding a timer and a dead closure until the timeout.
   */
  signal?: AbortSignal;
}

interface Entry<T> {
  settle: (settlement: Settlement<T>) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Removes the abort listener, so a long-lived signal doesn't accumulate them. */
  detach: () => void;
}

export interface Rendezvous<T> {
  /** The no-answer budget, exported so callers and tests can reason about it. */
  readonly timeoutMs: number;
  /**
   * Park a promise under `id`. Re-using a live id displaces the previous waiter
   * (settled as if aborted) rather than orphaning its timer.
   */
  wait(id: string, options?: WaitOptions): Promise<T>;
  /** Deliver the answer. False when nothing is waiting, so a route can 404. */
  settle(id: string, value: T): boolean;
  /** How many waits are outstanding — for tests and leak assertions. */
  size(): number;
}

export function createRendezvous<T>(config: {
  /** Used only in messages and logs. */
  label: string;
  timeoutMs: number;
  /** What the waiter gets when the answer never arrives. */
  onTimeout: Settlement<T>;
  /** What the waiter gets when the query is aborted mid-wait. */
  onAbort: Settlement<T>;
}): Rendezvous<T> {
  const pending = new Map<string, Entry<T>>();

  /** Free everything an entry holds. Always paired with settling it. */
  const close = (id: string, entry: Entry<T>): void => {
    clearTimeout(entry.timer);
    entry.detach();
    pending.delete(id);
  };

  return {
    timeoutMs: config.timeoutMs,

    wait(id: string, options?: WaitOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const finish = (settlement: Settlement<T>): void => {
          if ('reject' in settlement) reject(new Error(settlement.reject));
          else resolve(settlement.resolve);
        };

        // An already-aborted signal must not register a timer at all.
        const signal = options?.signal;
        if (signal?.aborted) {
          finish(config.onAbort);
          return;
        }

        const displaced = pending.get(id);
        if (displaced) {
          console.warn(`[${config.label}] Replacing a live wait for id ${id}`);
          close(id, displaced);
          displaced.settle(config.onAbort);
        }

        const entry: Entry<T> = {
          settle: finish,
          timer: setTimeout(() => {
            const live = pending.get(id);
            if (!live) return;
            close(id, live);
            finish(config.onTimeout);
          }, config.timeoutMs),
          detach: () => {},
        };

        if (signal) {
          const onAbort = () => {
            const live = pending.get(id);
            if (!live) return;
            close(id, live);
            finish(config.onAbort);
          };
          signal.addEventListener('abort', onAbort, { once: true });
          entry.detach = () => signal.removeEventListener('abort', onAbort);
        }

        pending.set(id, entry);
      });
    },

    settle(id: string, value: T): boolean {
      const entry = pending.get(id);
      if (!entry) return false;
      close(id, entry);
      entry.settle({ resolve: value });
      return true;
    },

    size: () => pending.size,
  };
}
