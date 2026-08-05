/**
 * "Zustand is applying persisted state right now."
 *
 * Exists to tell two indistinguishable things apart. When a store's state
 * changes, a `subscribe` listener sees only that it changed — not whether the
 * user did it or whether rehydration just wrote the saved payload in. Those need
 * opposite handling during a slow start:
 *
 *   - a USER edit made before the read lands must survive it,
 *   - the READ's own application must not be mistaken for one.
 *
 * Getting that backwards is not theoretical: the first attempt at the fix
 * recorded the rehydrate's write as a user edit and then faithfully "restored"
 * the stale value over the fresh one, which is the bug it was written to fix,
 * inverted.
 *
 * A flag rather than a timestamp comparison because `onRehydrateStorage` brackets
 * the application exactly — its outer call fires before the merge, the returned
 * callback after — so there is no window to guess at.
 */

let applying = false;

/** Called by a store's `onRehydrateStorage`, before the persisted merge. */
export function beginHydrationApply(): void {
  applying = true;
}

/** Called by the callback `onRehydrateStorage` returns, after the merge. */
export function endHydrationApply(): void {
  applying = false;
}

/** True only inside the merge. Listeners use it to ignore that one write. */
export function isHydrationApplying(): boolean {
  return applying;
}
