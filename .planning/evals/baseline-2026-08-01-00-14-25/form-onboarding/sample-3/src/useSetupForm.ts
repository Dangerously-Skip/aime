import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { submitSetup } from './api';
import { clearDraft, loadDraft, saveDraft } from './storage';
import {
  emptyData,
  newInvite,
  STEPS,
  type Billing,
  type CompanyDetails,
  type ErrorMap,
  type Invite,
  type SetupData,
  type StepId,
} from './types';
import { validateStep } from './validation';

type Status = 'editing' | 'submitting' | 'done';

/** Which step a given error path belongs to, so server errors can route the user back. */
function stepForPath(path: string): StepId {
  if (path.startsWith('company.')) return 'company';
  if (path.startsWith('invites')) return 'team';
  return 'billing';
}

export function useSetupForm() {
  const restored = useRef<ReturnType<typeof loadDraft>>(null);
  if (restored.current === null) restored.current = loadDraft();

  const [data, setData] = useState<SetupData>(() => restored.current?.data ?? emptyData());
  const [step, setStep] = useState<StepId>(() => restored.current?.step ?? 'company');
  const [restoredFromDraft] = useState(() => restored.current !== null);

  /** Field paths the user has interacted with — gates "on blur" error display. */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  /** Steps where Continue/Submit has been pressed — reveals every error on that step. */
  const [attempted, setAttempted] = useState<Set<StepId>>(new Set());

  const [serverErrors, setServerErrors] = useState<ErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('editing');
  const [accountId, setAccountId] = useState<string | null>(null);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    if (status === 'done') return;
    saveDraft({ step, data });
  }, [step, data, status]);

  // --- error surfaces -------------------------------------------------------

  const clientErrors = useMemo(() => validateStep(step, data), [step, data]);

  /** Every error for the current step, whether or not it should be shown yet. */
  const allErrors = useMemo<ErrorMap>(() => {
    const scoped: ErrorMap = {};
    for (const [path, message] of Object.entries(serverErrors)) {
      if (stepForPath(path) === step) scoped[path] = message;
    }
    return { ...clientErrors, ...scoped };
  }, [clientErrors, serverErrors, step]);

  /**
   * Server errors are always visible — the user has already submitted, so
   * there is nothing to be gained by hiding them.
   */
  const visibleErrors = useMemo<ErrorMap>(() => {
    if (attempted.has(step)) return allErrors;
    const out: ErrorMap = {};
    for (const [path, message] of Object.entries(allErrors)) {
      if (touched.has(path) || path in serverErrors) out[path] = message;
    }
    return out;
  }, [allErrors, attempted, step, touched, serverErrors]);

  const stepIsValid = Object.keys(clientErrors).length === 0;

  /** Steps reachable via the progress bar: everything up to the first invalid step. */
  const furthestReachable = useMemo(() => {
    let i = 0;
    while (i < STEPS.length - 1) {
      const errs = validateStep(STEPS[i].id, data);
      if (Object.keys(errs).length > 0) break;
      i += 1;
    }
    return Math.max(i, stepIndex);
  }, [data, stepIndex]);

  // --- mutation -------------------------------------------------------------

  const clearServerError = useCallback((path: string) => {
    setServerErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setFormError(null);
  }, []);

  const setCompanyField = useCallback(
    <K extends keyof CompanyDetails>(key: K, value: CompanyDetails[K]) => {
      setData((prev) => ({ ...prev, company: { ...prev.company, [key]: value } }));
      clearServerError(`company.${key}`);
    },
    [clearServerError],
  );

  const setBillingField = useCallback(
    <K extends keyof Billing>(key: K, value: Billing[K]) => {
      setData((prev) => ({ ...prev, billing: { ...prev.billing, [key]: value } }));
      clearServerError(`billing.${key}`);
    },
    [clearServerError],
  );

  const setInviteField = useCallback(
    <K extends keyof Omit<Invite, 'id'>>(id: string, key: K, value: Invite[K]) => {
      setData((prev) => ({
        ...prev,
        invites: prev.invites.map((i) => (i.id === id ? { ...i, [key]: value } : i)),
      }));
      clearServerError(`invites.${id}.${key}`);
    },
    [clearServerError],
  );

  const addInvite = useCallback(() => {
    const invite = newInvite();
    setData((prev) => ({ ...prev, invites: [...prev.invites, invite] }));
    return invite.id;
  }, []);

  const removeInvite = useCallback((id: string) => {
    setData((prev) => {
      const remaining = prev.invites.filter((i) => i.id !== id);
      // Always leave one row so the step never looks broken.
      return { ...prev, invites: remaining.length ? remaining : [newInvite()] };
    });
    setTouched((prev) => {
      const next = new Set(prev);
      for (const path of prev) if (path.startsWith(`invites.${id}.`)) next.delete(path);
      return next;
    });
  }, []);

  const markTouched = useCallback((path: string) => {
    setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
  }, []);

  // --- navigation -----------------------------------------------------------

  const goTo = useCallback((next: StepId) => {
    setStep(next);
    setFormError(null);
  }, []);

  const back = useCallback(() => {
    if (stepIndex > 0) goTo(STEPS[stepIndex - 1].id);
  }, [goTo, stepIndex]);

  /** Returns true if it advanced; false means validation blocked the move. */
  const next = useCallback((): boolean => {
    setAttempted((prev) => new Set(prev).add(step));
    if (!stepIsValid) return false;
    if (stepIndex < STEPS.length - 1) goTo(STEPS[stepIndex + 1].id);
    return true;
  }, [goTo, step, stepIndex, stepIsValid]);

  const submit = useCallback(async (): Promise<boolean> => {
    setAttempted(new Set(STEPS.map((s) => s.id)));

    // Re-check every step, not just the current one — a draft restored mid-flow
    // could have an invalid earlier step the user never visited.
    for (const s of STEPS) {
      const errs = validateStep(s.id, data);
      if (Object.keys(errs).length > 0) {
        setFormError('Some details need fixing before we can finish.');
        if (s.id !== step) goTo(s.id);
        return false;
      }
    }

    setStatus('submitting');
    setFormError(null);
    const result = await submitSetup(data);

    if (result.ok) {
      clearDraft();
      setAccountId(result.accountId);
      setStatus('done');
      return true;
    }

    setStatus('editing');
    setServerErrors(result.fieldErrors ?? {});
    setFormError(result.message);

    // Route the user to the step that actually holds the rejected field.
    const firstPath = Object.keys(result.fieldErrors ?? {})[0];
    if (firstPath) {
      const target = stepForPath(firstPath);
      if (target !== step) goTo(target);
    }
    return false;
  }, [data, goTo, step]);

  const reset = useCallback(() => {
    clearDraft();
    setData(emptyData());
    setStep('company');
    setTouched(new Set());
    setAttempted(new Set());
    setServerErrors({});
    setFormError(null);
    setAccountId(null);
    setStatus('editing');
  }, []);

  return {
    data,
    step,
    stepIndex,
    status,
    accountId,
    formError,
    visibleErrors,
    errorCount: Object.keys(allErrors).length,
    stepIsValid,
    furthestReachable,
    restoredFromDraft,
    setCompanyField,
    setBillingField,
    setInviteField,
    addInvite,
    removeInvite,
    markTouched,
    goTo,
    back,
    next,
    submit,
    reset,
  };
}
