import { Field } from '../components/Field';
import { COMPANY_SIZES, COUNTRIES, type CompanyDetails, type ErrorMap } from '../types';

interface Props {
  value: CompanyDetails;
  errors: ErrorMap;
  onChange: <K extends keyof CompanyDetails>(key: K, value: CompanyDetails[K]) => void;
  onBlur: (path: string) => void;
}

export function CompanyStep({ value, errors, onChange, onBlur }: Props) {
  return (
    <div className="grid">
      <Field path="company.name" label="Company name" error={errors['company.name']}>
        {(p) => (
          <input
            {...p}
            className="input"
            type="text"
            autoComplete="organization"
            value={value.name}
            onChange={(e) => onChange('name', e.target.value)}
            onBlur={() => onBlur('company.name')}
          />
        )}
      </Field>

      <Field
        path="company.website"
        label="Website"
        optional
        hint="With or without https://"
        error={errors['company.website']}
      >
        {(p) => (
          <input
            {...p}
            className="input"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="acme.com"
            value={value.website}
            onChange={(e) => onChange('website', e.target.value)}
            onBlur={() => onBlur('company.website')}
          />
        )}
      </Field>

      <div className="grid grid--2">
        <Field path="company.size" label="Company size" error={errors['company.size']}>
          {(p) => (
            <select
              {...p}
              className="input"
              value={value.size}
              onChange={(e) => onChange('size', e.target.value)}
              onBlur={() => onBlur('company.size')}
            >
              <option value="">Select…</option>
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} people
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field path="company.country" label="Country" error={errors['company.country']}>
          {(p) => (
            <select
              {...p}
              className="input"
              autoComplete="country-name"
              value={value.country}
              onChange={(e) => onChange('country', e.target.value)}
              onBlur={() => onBlur('company.country')}
            >
              <option value="">Select…</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </div>
  );
}
