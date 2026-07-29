'use client';

import { Fragment } from 'react';
import { Input } from '@/components/ui/input';
import {
  CREDENTIAL_FIELD_SPECS,
  type CredentialField,
  type ProviderPreset,
} from '@/lib/models/providers';

/**
 * The inputs for whatever fields a preset declares.
 *
 * Shared by Settings → API Access and onboarding, because they had separate
 * implementations and only one of them was ever taught about Bedrock, Vertex
 * and Azure. A preset added later gets its inputs in both places for free.
 */
export function ProviderFields({
  preset,
  values,
  onChange,
  disabled,
}: {
  preset: ProviderPreset;
  values: Partial<Record<CredentialField, string>>;
  onChange: (field: CredentialField, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {preset.credentialFields.map((f) => {
        const spec = CREDENTIAL_FIELD_SPECS[f];
        return (
          <Fragment key={f}>
            <label className="text-xs text-muted-foreground" htmlFor={`provider-field-${f}`}>
              {spec.label}
            </label>
            <div className="space-y-1">
              <Input
                id={`provider-field-${f}`}
                type={spec.secret ? 'password' : 'text'}
                value={values[f] ?? ''}
                onChange={(e) => onChange(f, e.target.value)}
                disabled={disabled}
                className="h-8 text-xs font-mono"
                placeholder={spec.placeholder}
              />
              {spec.help && <p className="text-[11px] text-muted-foreground/80">{spec.help}</p>}
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * The one-line caveat for a preset, or null.
 *
 * Both of these were previously invisible: a user who picked Bedrock saw a form
 * full of blanks with no hint that leaving them empty is the normal case, and a
 * user who picked one of the four presets that cannot enumerate models watched
 * "scan" find nothing and reasonably concluded it was broken.
 */
export function providerHint(preset: ProviderPreset): string | null {
  const parts: string[] = [];
  if (preset.agentMode === 'bedrock' || preset.agentMode === 'vertex') {
    parts.push(
      `Leave these blank to use this machine's ambient ${
        preset.agentMode === 'bedrock' ? 'AWS' : 'gcloud'
      } credentials.`,
    );
  }
  if (!preset.scan) {
    parts.push('This provider cannot list its models — add them by name after saving.');
  }
  return parts.length ? parts.join(' ') : null;
}
