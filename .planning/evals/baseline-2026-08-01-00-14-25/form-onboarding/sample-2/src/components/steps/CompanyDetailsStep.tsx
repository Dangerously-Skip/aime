import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { flattenErrors } from "../../errorList";
import {
  COMPANY_SIZES,
  COUNTRIES,
  INDUSTRIES,
  companySchema,
  emptyCompany,
  type CompanyValues,
} from "../../schemas";
import ErrorSummary from "../ErrorSummary";
import Field from "../Field";

type Props = {
  values: Partial<CompanyValues>;
  onNext: (values: CompanyValues) => void;
};

export default function CompanyDetailsStep({ values, onNext }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, submitCount },
  } = useForm<CompanyValues>({
    resolver: zodResolver(companySchema),
    defaultValues: { ...emptyCompany, ...values },
    mode: "onTouched",
  });

  return (
    <form noValidate onSubmit={handleSubmit(onNext)}>
      <ErrorSummary items={flattenErrors(errors)} attempt={submitCount} />

      <div className="grid">
        <Field id="companyName" label="Company name" error={errors.companyName?.message}>
          {(aria) => (
            <input
              {...aria}
              {...register("companyName")}
              className="input"
              type="text"
              autoComplete="organization"
              placeholder="Northwind Trading Ltd"
              autoFocus
            />
          )}
        </Field>

        <Field
          id="website"
          label="Website"
          optional
          hint="We use this to pre-fill your workspace branding."
          error={errors.website?.message}
        >
          {(aria) => (
            <input
              {...aria}
              {...register("website")}
              className="input"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://northwind.example.com"
            />
          )}
        </Field>

        <div className="grid grid--two">
          <Field id="companySize" label="Company size" error={errors.companySize?.message}>
            {(aria) => (
              <select {...aria} {...register("companySize")} className="input select">
                <option value="">Choose an option…</option>
                {COMPANY_SIZES.map((size) => (
                  <option key={size.value} value={size.value}>
                    {size.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="industry" label="Industry" error={errors.industry?.message}>
            {(aria) => (
              <select {...aria} {...register("industry")} className="input select">
                <option value="">Choose an option…</option>
                {INDUSTRIES.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="grid grid--two">
          <Field id="country" label="Billing country" error={errors.country?.message}>
            {(aria) => (
              <select {...aria} {...register("country")} className="input select">
                <option value="">Choose an option…</option>
                {COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            id="taxId"
            label="VAT / Tax ID"
            optional
            hint="Added to every invoice."
            error={errors.taxId?.message}
          >
            {(aria) => (
              <input
                {...aria}
                {...register("taxId")}
                className="input"
                type="text"
                placeholder="GB123456789"
              />
            )}
          </Field>
        </div>
      </div>

      <div className="actions">
        <span />
        <button type="submit" className="btn btn--primary">
          Continue to team invites
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
    </form>
  );
}
