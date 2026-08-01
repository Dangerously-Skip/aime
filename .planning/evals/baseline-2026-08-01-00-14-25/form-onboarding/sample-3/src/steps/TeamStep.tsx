import { useEffect, useRef } from 'react';
import { Field } from '../components/Field';
import { ROLES, type ErrorMap, type Invite, type Role } from '../types';

interface Props {
  invites: Invite[];
  errors: ErrorMap;
  onChange: <K extends keyof Omit<Invite, 'id'>>(id: string, key: K, value: Invite[K]) => void;
  onBlur: (path: string) => void;
  onAdd: () => string;
  onRemove: (id: string) => void;
}

export function TeamStep({ invites, errors, onChange, onBlur, onAdd, onRemove }: Props) {
  /** Focus the email input of a row added by the user, but not on first render. */
  const focusId = useRef<string | null>(null);

  useEffect(() => {
    if (!focusId.current) return;
    const el = document.getElementById(`f-invites-${focusId.current}-email`);
    if (el instanceof HTMLInputElement) el.focus();
    focusId.current = null;
  }, [invites.length]);

  const filled = invites.filter((i) => i.email.trim()).length;

  return (
    <div className="grid">
      <p className="note">
        Invites are sent once setup is finished. You can always add more people later, so feel free
        to skip this step.
      </p>

      {errors['invites'] && (
        <p className="banner banner--error" role="alert">
          {errors['invites']}
        </p>
      )}

      <ul className="invites">
        {invites.map((invite, index) => {
          const emailPath = `invites.${invite.id}.email`;
          return (
            <li key={invite.id} className="invites__row">
              <Field
                path={emailPath}
                label={`Email address ${index + 1}`}
                error={errors[emailPath]}
              >
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    type="email"
                    autoComplete="off"
                    placeholder="colleague@company.com"
                    value={invite.email}
                    onChange={(e) => onChange(invite.id, 'email', e.target.value)}
                    onBlur={() => onBlur(emailPath)}
                  />
                )}
              </Field>

              <Field path={`invites.${invite.id}.role`} label="Role">
                {(p) => (
                  <select
                    {...p}
                    className="input"
                    value={invite.role}
                    onChange={(e) => onChange(invite.id, 'role', e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <button
                type="button"
                className="btn btn--icon"
                onClick={() => onRemove(invite.id)}
                disabled={invites.length === 1 && !invite.email.trim()}
                aria-label={`Remove invite ${index + 1}${invite.email.trim() ? ` for ${invite.email.trim()}` : ''}`}
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="invites__footer">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            focusId.current = onAdd();
          }}
        >
          + Add another person
        </button>
        <p className="invites__count" aria-live="polite">
          {filled === 0 ? 'No invites yet' : `${filled} ${filled === 1 ? 'person' : 'people'} to invite`}
        </p>
      </div>

      <p className="note note--muted">
        {ROLES.map((r) => `${r.label}: ${r.hint}`).join(' · ')}
      </p>
    </div>
  );
}
