import { useEffect, useRef, useState } from "react";
import { ApiError, submitSetup } from "../api";
import {
  emptyCompany,
  type BillingValues,
  type CompanyValues,
  type SetupData,
  type TeamValues,
} from "../schemas";
import { clearDraft, hasContent, loadDraft, saveDraft, type Draft } from "../storage";
import ProgressStepper, { type StepMeta } from "./ProgressStepper";
import SetupComplete from "./SetupComplete";
import BillingStep from "./steps/BillingStep";
import CompanyDetailsStep from "./steps/CompanyDetailsStep";
import TeamInvitesStep from "./steps/TeamInvitesStep";

const STEPS: readonly StepMeta[] = [
  {
    id: "company",
    title: "Company details",
    summary: "Who you are",
    blurb: "This is the legal entity we'll put on your invoices.",
  },
  {
    id: "team",
    title: "Team invites",
    summary: "Who's joining",
    blurb: "Add colleagues now or skip and do it later — nothing is emailed until setup finishes.",
  },
  {
    id: "billing",
    title: "Billing",
    summary: "How you'll pay",
    blurb: "Pick a plan and add a payment method. You can change plans at any time.",
  },
];

type Status = "editing" | "submitting" | "done";
type ServerError = { message: string; field?: string };

export default function SetupWizard() {
  const [boot] = useState(loadDraft);

  const [stepIndex, setStepIndex] = useState(boot?.stepIndex ?? 0);
  const [furthest, setFurthest] = useState(boot?.stepIndex ?? 0);
  const [draft, setDraft] = useState<Draft>(boot?.draft ?? {});
  const [status, setStatus] = useState<Status>("editing");
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [result, setResult] = useState<{ accountId: string; data: SetupData } | null>(null);
  const [showRestored, setShowRestored] = useState(() => Boolean(boot && hasContent(boot.draft)));

  const headRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  /* Keep the draft warm so a refresh doesn't cost the user their typing. */
  useEffect(() => {
    if (status === "done") return;
    saveDraft({ stepIndex, draft });
  }, [stepIndex, draft, status]);

  /* Move focus to the new step heading, but not on first paint. */
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headRef.current?.focus();
  }, [stepIndex]);

  const goTo = (index: number) => {
    setStepIndex(index);
    setFurthest((prev) => Math.max(prev, index));
    setServerError(null);
  };

  const advance = (patch: Draft) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    goTo(Math.min(stepIndex + 1, STEPS.length - 1));
  };

  /* Going back keeps whatever was typed, even though it hasn't passed validation. */
  const retreat = (patch: Draft) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    goTo(Math.max(stepIndex - 1, 0));
  };

  const startFresh = () => {
    clearDraft();
    setDraft({});
    setStepIndex(0);
    setFurthest(0);
    setShowRestored(false);
    setServerError(null);
  };

  const invites = draft.team?.invites ?? [];
  const seats = invites.length + 1;

  const finish = async (billing: BillingValues) => {
    const payload: SetupData = {
      company: { ...emptyCompany, ...draft.company } as CompanyValues,
      team: { invites },
      billing,
    };

    setDraft((prev) => ({ ...prev, billing }));
    setServerError(null);
    setStatus("submitting");

    try {
      const { accountId } = await submitSetup(payload);
      setResult({ accountId, data: payload });
      clearDraft();
      setStatus("done");
    } catch (error) {
      setStatus("editing");
      setServerError(
        error instanceof ApiError
          ? { message: error.message, field: error.field }
          : { message: "Something went wrong on our end. Please try again." },
      );
    }
  };

  if (status === "done" && result) {
    return (
      <SetupComplete
        accountId={result.accountId}
        data={result.data}
        onRestart={() => {
          setResult(null);
          setStatus("editing");
          startFresh();
        }}
      />
    );
  }

  const step = STEPS[stepIndex];

  return (
    <div className="wizard">
      <div className="wizard__intro">
        <h1>Set up your account</h1>
        <p>Three short steps. Nothing is charged until you finish the last one.</p>
      </div>

      {showRestored && (
        <div className="alert alert--info">
          <p className="alert__title">We picked up where you left off</p>
          <p>
            Your earlier answers were restored — card details are never saved.{" "}
            <button type="button" className="linkButton" onClick={startFresh}>
              Start fresh instead
            </button>
          </p>
          <button
            type="button"
            className="alert__dismiss"
            onClick={() => setShowRestored(false)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <ProgressStepper
        steps={STEPS}
        current={stepIndex}
        furthest={furthest}
        onNavigate={goTo}
      />

      <section className="card" aria-labelledby="step-title">
        <div className="card__head" tabIndex={-1} ref={headRef}>
          <h2 id="step-title">{step.title}</h2>
          <p>{step.blurb}</p>
        </div>

        <div className="card__body" key={step.id}>
          {stepIndex === 0 && (
            <CompanyDetailsStep
              values={draft.company ?? {}}
              onNext={(values: CompanyValues) => advance({ company: values })}
            />
          )}

          {stepIndex === 1 && (
            <TeamInvitesStep
              values={draft.team ?? {}}
              onNext={(values: TeamValues) => advance({ team: values })}
              onBack={(values) => retreat({ team: values })}
            />
          )}

          {stepIndex === 2 && (
            <BillingStep
              values={draft.billing ?? {}}
              seats={seats}
              submitting={status === "submitting"}
              serverError={serverError}
              onSubmit={finish}
              onBack={(values) => retreat({ billing: values })}
            />
          )}
        </div>
      </section>
    </div>
  );
}
