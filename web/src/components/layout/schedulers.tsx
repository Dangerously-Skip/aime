"use client";

import { useCallback } from "react";
import { useCron, type FiredJob } from "@/hooks/use-cron";
import { useExecutionManifest } from "@/hooks/use-execution-manifest";
import { usePendingMemoryPull } from "@/hooks/use-pending-memory-pull";
import { useContextBusStore } from "@/stores/context-bus-store";
import { useAssistantStore } from "@/stores/assistant-store";
import { notifyDesktop } from "@/lib/schedule/notify";

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
 * at. A hook scoped to one conversation belongs to the surface that owns that
 * conversation, not here.
 *
 * WHY NOT IN A SURFACE. `useStandingOrders` lives in the Assistant surface and
 * works, because every surface is mounted the whole time. But that is a property
 * of the router, not of the hook, and a scheduler that stops firing when someone
 * reorganises the routing is a scheduler that will stop firing. This mounts in
 * the shell, where "always" is the point rather than a side effect.
 */
const SURFACE_NAMES: Record<string, string> = {
  chat: "Chat",
  cowork: "Cowork",
  code: "Code",
  browser: "Browser",
  assistant: "Assistant",
};

/**
 * A due attended job, handed to its surface — WITHOUT taking over the screen.
 *
 * PUBLISHED, not executed here. This component has no composer, no
 * conversation and no send path, and giving it one would be a fourth place that
 * starts a turn. The context bus is how the surfaces already hear about work
 * that originates outside them; the surface named by the job runs it, in a
 * conversation of its own filed under the job's project (use-scheduled-prompt →
 * job-conversation).
 *
 * IT USED TO SWITCH THE ACTIVE SURFACE, on the theory that a run nobody sees is
 * indistinguishable from one that did not happen. True — but yanking the user
 * out of whatever they were typing, at 9:00 sharp, is the wrong answer to it.
 * Every surface is mounted all the time, so the job runs in the background, and
 * visibility comes from a notification (quiet hours respected) plus a line in
 * the Assistant's activity log, which its health panel reads.
 *
 * The same holds for the CONVERSATION, not just the surface: the job gets its
 * own, and the one you had open is handed back as soon as the job's turn is in
 * flight (job-conversation → handBackView). So the notification is sent even
 * when the job's surface is the one on screen — you are not watching it start.
 */
export function fireAttendedJob(job: FiredJob): void {
  useContextBusStore.getState().publish({
    summary: job.prompt,
    source: `cron:${job.id}`,
    // p0: the user asked for this at a specific time.
    priority: "p0",
    targetSurface: job.surfaceId || undefined,
    payload: { prompt: job.prompt, cronJobId: job.id, ...(job.projectId ? { projectId: job.projectId } : {}) },
  });

  const surface = SURFACE_NAMES[job.surfaceId] ?? job.surfaceId;
  const short = job.prompt.length > 80 ? `${job.prompt.slice(0, 80)}…` : job.prompt;
  useAssistantStore.getState().addActivity({
    type: "order-fired",
    label: `Ran in ${surface}: ${short}`.slice(0, 120),
    orderId: job.id,
  });
  notifyDesktop(`Scheduled job started in ${surface}`, short);
}

export function Schedulers() {
  const onFire = useCallback((job: FiredJob) => fireAttendedJob(job), []);

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

  // Memories extracted after a turn the app quit before collecting. Global for
  // the same reason: they belong to no surface.
  usePendingMemoryPull();

  return null;
}
