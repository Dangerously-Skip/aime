/**
 * Publishing a deck: who can open it, and where it lives.
 *
 * ## Why the audience type is shaped like this
 *
 * "Restrict to a limited subset of people" cannot be done with static object
 * storage. A bucket serves bytes to whoever asks; enforcing "only Sarah" needs
 * something that checks WHO is asking, which means an identity provider. So the
 * two audiences below are not two settings on one mechanism — they are two
 * different guarantees, and only one of them is enforceable everywhere:
 *
 *   - `link`   — anyone holding the URL. Every target can do this.
 *   - `people` — named accounts, enforced by the host at request time. Only a
 *                target with an identity model can honour it.
 *
 * A target that cannot enforce `people` must REFUSE it rather than quietly
 * downgrade to an unguessable link. That is the whole reason `capabilities`
 * exists: this codebase has spent a long week finding controls that read as
 * enforced and were not, and "shared with 3 people" silently meaning "anyone
 * with the link" is that bug with someone's private data attached.
 */

export type Audience =
  | { kind: 'link' }
  | { kind: 'people'; emails: string[] };

export interface PublishInput {
  /** File name as the recipient will see it. */
  fileName: string;
  /** The self-contained HTML from `bundleDeck`. */
  html: string;
  audience: Audience;
}

export interface PublishResult {
  url: string;
  /** Stable handle for later revocation. */
  id: string;
  /**
   * What the URL actually grants, which is not always what was asked for —
   * a target may only be able to offer a weaker guarantee, and the user has to
   * be told in those words rather than shown a success tick.
   */
  effective: Audience;
  /** Human sentence for the UI: what this link does and who can open it. */
  summary: string;
}

export interface TargetCapabilities {
  /** Can it enforce access for NAMED people, not just an unguessable URL? */
  people: boolean;
  /** Can a published deck be withdrawn? */
  revoke: boolean;
}

export interface PublishTarget {
  id: string;
  label: string;
  capabilities: TargetCapabilities;
  publish(input: PublishInput): Promise<PublishResult>;
  revoke?(id: string): Promise<void>;
}

/** Thrown for a failure the user can act on; the message is shown verbatim. */
export class PublishError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-connected'
      | 'unsupported-audience'
      | 'auth'
      | 'network'
      | 'invalid-recipient'
      | 'upstream',
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

/**
 * An address list, or null if any entry is not one.
 *
 * Refused rather than filtered: dropping a malformed address from a share would
 * mean the user believes a colleague has access who does not, and finds out
 * when the deck is needed.
 */
const ADDRESS = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;
export function normaliseRecipients(raw: readonly string[]): string[] | null {
  const parts = raw.flatMap((r) => String(r).split(',')).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.every((p) => ADDRESS.test(p)) ? [...new Set(parts.map((p) => p.toLowerCase()))] : null;
}

/**
 * Check the audience against what the target can actually enforce.
 *
 * Called before any upload, so a share that cannot be honoured fails before the
 * file exists rather than after it is already sitting on someone's Drive.
 */
export function checkAudience(target: PublishTarget, audience: Audience): void {
  if (audience.kind === 'people' && !target.capabilities.people) {
    throw new PublishError(
      `${target.label} can only produce a link that anyone can open — it cannot restrict a deck to named people. ` +
        `Publish to Google Drive or OneDrive for that, or share the link knowing anyone with it can view.`,
      'unsupported-audience',
    );
  }
  if (audience.kind === 'people' && normaliseRecipients(audience.emails) === null) {
    throw new PublishError('Enter one or more valid email addresses.', 'invalid-recipient');
  }
}
