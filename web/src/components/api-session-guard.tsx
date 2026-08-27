"use client";

import { useEffect } from "react";

/**
 * Self-heal a dead API session — once PER TOKEN.
 *
 * The local API is cookie-authenticated, and the cookie is minted at launch
 * from a token shared by the server and the window (`?t=` exchange in the
 * proxy). When the two halves of the app restart apart — a dev-server respawn
 * minted a fresh `AIME_API_TOKEN` while the window kept its old cookie — every
 * `/api` call 401s forever. The polling hooks (goal transcript, auto-open,
 * cron…) don't stop: the console fills with tens of thousands of 401s and the
 * app is silently dead.
 *
 * On a same-origin `/api` 401, ask the main process for the CURRENT token and
 * reload with `?t=` — the exact exchange the launch path performs, which mints
 * a fresh cookie and strips the param.
 *
 * WHAT THE GUARD REMEMBERS, AND WHY IT CHANGED. This stored a boolean: one
 * attempt per tab session, for ever. That is loop-safe and too strict. A window
 * open across TWO dev-server restarts heals the first and is permanently dead
 * to the second — the flag is already set, so nothing retries and the app is
 * silently unauthorised until someone thinks to quit it.
 *
 * That is not hypothetical: a window left open overnight met a respawn, and the
 * visible symptom was the Design gallery rendering as unstyled HTML, because a
 * 401 on a `<link rel=stylesheet>` is dropped by the browser without an error
 * anyone can see.
 *
 * Storing the TOKEN THAT WAS TRIED keeps the loop guard and drops the ceiling:
 * a reload with a token that is still wrong will not retry (same value), while
 * a genuinely new token always gets its attempt. The loop the boolean was
 * protecting against needs the SAME token to repeat, and that is exactly what
 * this still refuses.
 *
 * Patching `window.fetch` once here — rather than at each of ~95 call sites —
 * is the same trade the cookie itself makes: one place, every call covered,
 * new call sites included without knowing this exists.
 */

/** The token last exchanged, so a retry needs a token we have not tried. */
const TRIED_TOKEN = "aime:api-session-tried-token";

export function ApiSessionGuard() {
  useEffect(() => {
    const electronAPI = (
      window as unknown as {
        electronAPI?: { getApiToken?: () => Promise<string> };
      }
    ).electronAPI;
    // No bridge (plain browser dev, e2e) — nothing to exchange.
    if (!electronAPI?.getApiToken) return;

    const original = window.fetch.bind(window);
    let reported = false;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      if (res.status !== 401) return res;

      // Only OUR API: an external service returning 401 (OAuth connectors,
      // search proxies) is not a session problem and must not reload the app.
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url ?? "";
      const isLocalApi =
        url.startsWith("/api/") ||
        url.startsWith(`${window.location.origin}/api/`);
      if (!isLocalApi) return res;

      void electronAPI
        .getApiToken!()
        .then((token) => {
          // Nothing to exchange, or we already tried exactly this one — the
          // second is the loop guard, and it is why this compares values
          // rather than counting attempts.
          if (!token || sessionStorage.getItem(TRIED_TOKEN) === token) {
            if (!reported) {
              reported = true;
              console.error(
                "[AIME] API session is unauthorized and re-exchanging the token did not help. " +
                  "Restart the app (quit and run `npm run electron:dev`) so the server and window mint a token together.",
              );
            }
            return;
          }
          sessionStorage.setItem(TRIED_TOKEN, token);
          const u = new URL(window.location.href);
          u.searchParams.set("t", token);
          window.location.href = u.toString();
        })
        .catch(() => {
          /* stay put; the report above names the fix */
        });
      return res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
