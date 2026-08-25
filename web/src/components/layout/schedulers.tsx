"use client";

import { useCallback } from "react";
import { useCron } from "@/hooks/use-cron";
import { useExecutionManifest } from "@/hooks/use-execution-manifest";
import { useAppStore } from "@/stores/app-store";
import { useContextBusStore } from "@/stores/context-bus-store";

/**
 * The renderer-side schedulers, mounted once.
 *
 * WHY THIS FILE EXISTS. `useCron` was written, tested, and **never called from
 * anywhere**. Cron jobs could be created, listed and toggled in Customize and in
 * a project's settings, and they never fired — not once, for any user. The hook
 * that subscribes to the minute tick was dead code with a passing test suite.
 *
 * That is this codebase's signature failure at feature scale: wired, correct,
 * and unreachable. `schedulers-mounted.test.ts` derives the list of minute-tick
 * subscribers from the hooks directory and fails if one of them has no mount
 * site, so the next one cannot be quietly born dead.
 *
 * WHAT BELONGS HERE. Only schedulers that must run whatever the user is looking
 * at. A hook scoped to one conversation — `useSessionReset` takes a `chatId` —
 * belongs to the surface that owns that conversation, not here.
 *
 * WHY NOT IN A SURFACE. `useStandingOrders` lives in the Assistant surface and
 * works, because every surface is mounted the whole time. But that is a property
 * of the router, not of the hook, and a scheduler that stops firing when someone
 * reorganises the routing is a scheduler that will stop firing. This mounts in
 * the shell, where "always" is the point rather than a side effect.
 */
export function Schedulers() {
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);

  /**
   * A due cron job.
   *
   * PUBLISHED, not executed here. This component has no composer, no
   * conversation and no send path, and giving it one would be a fourth place
   * that starts a turn. The context bus is how the surfaces already hear about
   * work that originates outside them; the surface named by the job owns
   * actually running it.
   *
   * Switching to that surface is deliberate: a scheduled run that happens
   * invisibly is indistinguishable from one that did not happen, which is the
   * complaint the goal pulse was added to answer.
   */
  const onFire = useCallback(
    (job: { id: string; prompt: string; surfaceId: string }) => {
      useContextBusStore.getState().publish({
        summary: job.prompt,
        source: `cron:${job.id}`,
        // p0: the user asked for this at a specific time, and a scheduled run
        // that arrives quietly is one they will not know ran.
        priority: "p0",
        targetSurface: job.surfaceId || undefined,
        payload: { prompt: job.prompt, cronJobId: job.id },
      });
      if (job.surfaceId) setActiveSurface(job.surfaceId as never);
    },
    [setActiveSurface],
  );

  useCron(onFire);

  /*
   * Publish the tier grid's decision so SERVER-SIDE work can obey it.
   *
   * The widget scheduler ticks inside the Next server so a refresh works "with
   * no window at all", and therefore cannot see the provider store. Without this
   * it fell back to a hardcoded model id and an Anthropic-only key — no refresh
   * at all on any other account, once per tick, silently.
   *
   * Here for the same reason the schedulers are: it has to run whatever the user
   * is looking at, and a surface is the wrong owner for something global.
   */
  useExecutionManifest();

  return null;
}
