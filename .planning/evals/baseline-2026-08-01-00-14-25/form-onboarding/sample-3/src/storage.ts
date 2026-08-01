import { emptyData, type SetupData, type StepId } from './types';

const KEY = 'account-setup:draft:v1';

export interface Draft {
  step: StepId;
  data: SetupData;
}

/**
 * Card number, expiry and CVC are never written to localStorage — a draft that
 * outlives the session should not carry a payment instrument with it. The user
 * re-enters those three fields after a refresh; everything else is restored.
 */
function scrub(data: SetupData): SetupData {
  return {
    ...data,
    billing: { ...data.billing, cardNumber: '', expiry: '', cvc: '' },
  };
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ step: draft.step, data: scrub(draft.data) }));
  } catch {
    // Private browsing or a full quota. A lost draft is not worth breaking the form over.
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null;

    // Merge over a fresh object so a draft written by an older version of the
    // form cannot leave required keys undefined.
    const base = emptyData();
    const data: SetupData = {
      company: { ...base.company, ...parsed.data.company },
      invites:
        Array.isArray(parsed.data.invites) && parsed.data.invites.length
          ? parsed.data.invites
          : base.invites,
      billing: { ...base.billing, ...parsed.data.billing, cardNumber: '', expiry: '', cvc: '' },
    };
    const step: StepId =
      parsed.step === 'company' || parsed.step === 'team' || parsed.step === 'billing'
        ? parsed.step
        : 'company';
    return { step, data };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
