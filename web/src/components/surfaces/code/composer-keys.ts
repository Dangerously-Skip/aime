/**
 * What a keystroke in Code's composer means. Pure, so the rules are testable
 * without mounting the composer.
 *
 * - Enter while a turn is streaming does NOTHING. It used to abort the turn:
 *   finishing a sentence for the next message killed the one running.
 *   Stopping is Esc (or the stop button) — a deliberate key, not the most
 *   common one.
 * - Enter during IME composition (Japanese, Chinese, Korean input) confirms
 *   the candidate; it must never send. `isComposing` covers modern engines and
 *   keyCode 229 covers the ones that report composition only that way.
 */
export type ComposerKeyAction = 'submit' | 'abort' | 'none' | 'default';

export interface ComposerKey {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function composerKeyAction(
  e: ComposerKey,
  state: { isStreaming: boolean; hasText: boolean },
): ComposerKeyAction {
  if (e.isComposing || e.keyCode === 229) return 'default';
  if (e.key === 'Escape') return state.isStreaming ? 'abort' : 'default';
  if (e.key !== 'Enter' || e.shiftKey) return 'default';
  if (state.isStreaming) return 'none';
  return state.hasText ? 'submit' : 'none';
}

/**
 * A conversation title that is still a placeholder and may be replaced by the
 * first real message. Anything else was set on purpose (by the first message,
 * or by the user renaming it) and a later send must not overwrite it.
 */
export function isUntitledConversation(title: string | undefined | null): boolean {
  return !title || !title.trim() || /^new chat$/i.test(title.trim());
}
