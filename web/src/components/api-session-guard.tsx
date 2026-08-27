"use client";

import { useEffect } from "react";

/**
 * Self-heal a dead API session — once.
 *
 * The local API is cookie-authenticated, and the cookie is minted at launch
 * from a token shared by the server and the window (`?t=` exchange in the
 * proxy). When the two halves of the app restart apart — a dev-server respawn
 * minted a fresh `AIME_API_TOKEN` while the window kept its old cookie — every
 * `/api` call 401s forever. The polling hooks (goal transcript, auto-open,
 * cron…) don't stop: the console fills with tens of thousands of 401s and the
 * app is silently dead.
 *
 * On the FIRST same-origin `/api` 401, ask the main process for the CURRENT
 * token and reload with `?t=` — the exact exchange the launch path performs,
 * which mints a fresh cookie and strips the param. Exactly ONE attempt per tab
 * session (`sessionStorage` survives the reload, so a token that still doesn't
 * match cannot produce a reload loop); after that, one clear console error
 * naming the actual fix instead of an endless 401 stream.
 *
 * Patching `window.fetch` once here — rather than at each of ~95 call sites —
 * is the same trade the cookie itself makes: one place, every call covered,
 * new call sites included without knowing this exists.
 */

const RETRY_FLAG = "aime:api-session-retried";

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

      if (sessionStorage.getItem(RETRY_FLAG) !== "1") {
        sessionStorage.setItem(RETRY_FLAG, "1");
        void electronAPI
          .getApiToken!()
          .then((token) => {
            if (!token) return;
            const u = new URL(window.location.href);
            u.searchParams.set("t", token);
            window.location.href = u.toString();
          })
          .catch(() => {
            /* stay put; the report below names the fix */
          });
        return res;
      }

      if (!reported) {
        reported = true;
        console.error(
          "[AIME] API session is unauthorized and re-exchanging the token did not help. " +
            "Restart the app (quit and run `npm run electron:dev`) so the server and window mint a token together.",
        );
      }
      return res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
