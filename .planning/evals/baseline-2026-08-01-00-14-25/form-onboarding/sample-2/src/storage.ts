import type { BillingValues, CompanyValues, TeamValues } from "./schemas";

/**
 * Draft persistence so a refresh mid-setup doesn't cost the user their typing.
 * Card details are deliberately stripped before anything is written.
 */

const KEY = "account-setup:draft:v1";

export type Draft = {
  company?: Partial<CompanyValues>;
  team?: Partial<TeamValues>;
  billing?: Partial<BillingValues>;
};

export type StoredDraft = { stepIndex: number; draft: Draft };

const SENSITIVE = ["cardNumber", "cvc", "expiry", "cardholderName"] as const;

function scrub(draft: Draft): Draft {
  if (!draft.billing) return draft;
  const billing: Partial<BillingValues> = { ...draft.billing };
  for (const key of SENSITIVE) delete billing[key];
  return { ...draft, billing };
}

export function loadDraft(): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (typeof parsed?.stepIndex !== "number" || typeof parsed?.draft !== "object") return null;
    return { stepIndex: Math.min(Math.max(parsed.stepIndex, 0), 2), draft: parsed.draft ?? {} };
  } catch {
    return null;
  }
}

export function saveDraft(value: StoredDraft): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ stepIndex: value.stepIndex, draft: scrub(value.draft) }),
    );
  } catch {
    // Private browsing or a full quota — persistence is a nicety, not a requirement.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}

export const hasContent = (draft: Draft): boolean =>
  Object.values(draft).some((section) =>
    Object.values(section ?? {}).some((v) =>
      Array.isArray(v)
        ? v.some((row) => Object.values(row ?? {}).some((cell) => cell !== "" && cell !== "member"))
        : v !== "" && v !== false,
    ),
  );
