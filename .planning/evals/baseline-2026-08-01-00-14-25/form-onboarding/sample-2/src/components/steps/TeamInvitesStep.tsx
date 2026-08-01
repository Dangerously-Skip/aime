import { zodResolver } from "@hookform/resolvers/zod";
import type { FormEvent } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { flattenErrors } from "../../errorList";
import { ROLES, emptyTeam, teamSchema, type TeamValues } from "../../schemas";
import ErrorSummary from "../ErrorSummary";
import Field from "../Field";

type Props = {
  values: Partial<TeamValues>;
  onNext: (values: TeamValues) => void;
  onBack: (values: Partial<TeamValues>) => void;
};

const MAX_INVITES = 25;

export default function TeamInvitesStep({ values, onNext, onBack }: Props) {
  const {
    register,
    control,
    handleSubmit,
    getValues,
    formState: { errors, submitCount },
  } = useForm<TeamValues>({
    resolver: zodResolver(teamSchema),
    defaultValues: { invites: values.invites?.length ? values.invites : emptyTeam.invites },
    mode: "onTouched",
  });

  const { fields, append, remove } = useFieldArray({ control, name: "invites" });

  const addRow = () => {
    append({ email: "", role: "member" });
    // Let the row mount before moving focus into it.
    requestAnimationFrame(() => {
      document.getElementById(`invites.${fields.length}.email`)?.focus();
    });
  };

  /** A single untouched row means "I'll do this later", not "you forgot something". */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const invites = getValues("invites");
    if (invites.length === 0 || (invites.length === 1 && invites[0].email.trim() === "")) {
      event.preventDefault();
      onNext({ invites: [] });
      return;
    }
    void handleSubmit(onNext)(event);
  };

  const rootError = errors.invites?.root?.message ?? errors.invites?.message;

  return (
    <form noValidate onSubmit={submit}>
      <ErrorSummary items={flattenErrors(errors)} attempt={submitCount} />

      <p className="lede">
        Invite the people who'll work in this account. They'll get an email once setup is done —
        nothing is sent before that. You can always add more people later.
      </p>

      {fields.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No invites yet</p>
          <p className="empty__body">You can continue and invite your team whenever you're ready.</p>
        </div>
      ) : (
        <ul className="invites">
          {fields.map((field, index) => {
            const emailError = errors.invites?.[index]?.email?.message;
            return (
              <li key={field.id} className="invites__row">
                <Field
                  id={`invites.${index}.email`}
                  label={`Email address ${index + 1}`}
                  error={emailError}
                >
                  {(aria) => (
                    <input
                      {...aria}
                      {...register(`invites.${index}.email` as const)}
                      className="input"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      placeholder="ana@northwind.example.com"
                    />
                  )}
                </Field>

                <Field id={`invites.${index}.role`} label="Role">
                  {(aria) => (
                    <select
                      {...aria}
                      {...register(`invites.${index}.role` as const)}
                      className="input select"
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => remove(index)}
                  aria-label={`Remove invite ${index + 1}`}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {rootError && (
        <p className="field__error" role="alert">
          <span>{rootError}</span>
        </p>
      )}

      <div className="invites__footer">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={addRow}
          disabled={fields.length >= MAX_INVITES}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M8 3.5v9M3.5 8h9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          Add another person
        </button>
        <p className="invites__hint">
          {fields.length} of {MAX_INVITES} rows used. Roles can be changed at any time.
        </p>
      </div>

      <details className="roles">
        <summary>What can each role do?</summary>
        <dl>
          {ROLES.map((role) => (
            <div key={role.value}>
              <dt>{role.label}</dt>
              <dd>{role.hint}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="actions">
        <button type="button" className="btn btn--ghost" onClick={() => onBack(getValues())}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M13 8H4M7.5 4.5L4 8l3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>
        <div className="actions__group">
          <button type="button" className="btn btn--quiet" onClick={() => onNext({ invites: [] })}>
            Skip for now
          </button>
          <button type="submit" className="btn btn--primary">
            Continue to billing
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M3 8h9M8.5 4.5L12 8l-3.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
