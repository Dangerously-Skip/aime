/**
 * The Code surface's permission modes — the values the composer's menu offers,
 * the store persists, the request carries and the server accepts.
 *
 * One list, imported by all four, so the allowlist the route validates against
 * cannot drift from what the menu can produce. Client-safe on purpose: no `fs`,
 * nothing server-only, because the store and the menu import it.
 *
 * Each value is a CLAIM made to the user, enforced by `lib/security/permission-mode`
 * inside the provider's `canUseTool`. The SDK's own permission mode is set to
 * match (see `SDK_PERMISSION_MODE`), but it is not what makes any of these true:
 * measured against the real CLI, `bypassPermissions` and `acceptEdits` never
 * consult `canUseTool` at all, and `plan` happily runs a Write that `canUseTool`
 * allows. The SDK mode is advice to the model; the gate is the enforcement.
 */
export const CODE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypass'] as const;

export type CodePermissionMode = (typeof CODE_PERMISSION_MODES)[number];

/**
 * What a new Code conversation starts in: asking. It was the default before any
 * of this was enforced, so it is also what almost every existing user has
 * persisted — and the label they have been shown all along. It is now true.
 */
export const DEFAULT_CODE_PERMISSION_MODE: CodePermissionMode = 'default';

export function isCodePermissionMode(value: unknown): value is CodePermissionMode {
  return typeof value === 'string' && (CODE_PERMISSION_MODES as readonly string[]).includes(value);
}

/** The Agent SDK's name for each mode. `bypass` is the only one that differs. */
export const SDK_PERMISSION_MODE: Record<CodePermissionMode, 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'> = {
  default: 'default',
  acceptEdits: 'acceptEdits',
  plan: 'plan',
  bypass: 'bypassPermissions',
};
