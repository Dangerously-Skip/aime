import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { flattenErrors } from "../../errorList";
import {
  PLANS,
  billingSchema,
  emptyBilling,
  seatPrice,
  type BillingValues,
} from "../../schemas";
import { cardBrand, cvcLengthFor, formatCardNumber, formatExpiry, onlyDigits } from "../../validators";
import ErrorSummary from "../ErrorSummary";
import Field from "../Field";

type Props = {
  values: Partial<BillingValues>;
  /** Seats being paid for: the invited team plus the account owner. */
  seats: number;
  submitting: boolean;
  serverError: { message: string; field?: string } | null;
  onSubmit: (values: BillingValues) => void;
  onBack: (values: Partial<BillingValues>) => void;
};

export default function BillingStep({
  values,
  seats,
  submitting,
  serverError,
  onSubmit,
  onBack,
}: Props) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    getValues,
    formState: { errors, submitCount },
  } = useForm<BillingValues>({
    resolver: zodResolver(billingSchema),
    defaultValues: { ...emptyBilling, ...values },
    mode: "onTouched",
  });

  const plan = watch("plan");
  const cycle = watch("cycle");
  const cardNumber = watch("cardNumber");
  const brand = cardBrand(cardNumber);

  const unitPrice = seatPrice(plan, cycle);
  const monthlyTotal = unitPrice * seats;
  const chargedNow = cycle === "annual" ? monthlyTotal * 12 : monthlyTotal;
  const annualSaving = (seatPrice(plan, "monthly") - seatPrice(plan, "annual")) * seats * 12;

  /** Server-side rejections land on the field the API blamed. */
  useEffect(() => {
    if (!serverError?.field) return;
    const field = serverError.field as keyof BillingValues;
    setError(field, { type: "server", message: serverError.message });
    document.getElementById(field)?.focus();
  }, [serverError, setError]);

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary items={flattenErrors(errors)} attempt={submitCount} />

      {serverError && !serverError.field && (
        <div className="alert alert--error" role="alert">
          <p className="alert__title">We couldn't create the account</p>
          <p>{serverError.message}</p>
        </div>
      )}

      <fieldset className="fieldset">
        <legend className="fieldset__legend">Choose a plan</legend>

        <div className="cycle" role="group" aria-label="Billing cycle">
          <label className={`cycle__option${cycle === "monthly" ? " cycle__option--on" : ""}`}>
            <input type="radio" value="monthly" {...register("cycle")} />
            <span>Monthly</span>
          </label>
          <label className={`cycle__option${cycle === "annual" ? " cycle__option--on" : ""}`}>
            <input type="radio" value="annual" {...register("cycle")} />
            <span>
              Annual <em>save ~20%</em>
            </span>
          </label>
        </div>

        <div className="plans">
          {PLANS.map((option) => (
            <label
              key={option.id}
              className={`plan${plan === option.id ? " plan--on" : ""}`}
              htmlFor={`plan-${option.id}`}
            >
              <input
                id={`plan-${option.id}`}
                type="radio"
                value={option.id}
                {...register("plan")}
                className="plan__radio"
              />
              <span className="plan__head">
                <span className="plan__name">{option.name}</span>
                {"popular" in option && option.popular && (
                  <span className="plan__badge">Most popular</span>
                )}
              </span>
              <span className="plan__price">
                <strong>£{seatPrice(option.id, cycle)}</strong>
                <span>/seat/month</span>
              </span>
              <span className="plan__blurb">{option.blurb}</span>
              <ul className="plan__features">
                {option.features.map((feature) => (
                  <li key={feature}>
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path
                        d="M3.5 8.5l3 3 6-6.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="summary" aria-live="polite">
        <div className="summary__row">
          <span>
            {seats} {seats === 1 ? "seat" : "seats"} × £{unitPrice}/month
          </span>
          <span>£{monthlyTotal}/month</span>
        </div>
        <div className="summary__row summary__row--total">
          <span>{cycle === "annual" ? "Billed annually today" : "Billed monthly today"}</span>
          <strong>£{chargedNow}</strong>
        </div>
        {cycle === "annual" && annualSaving > 0 && (
          <p className="summary__note">You save £{annualSaving} a year on this cycle.</p>
        )}
      </div>

      <fieldset className="fieldset">
        <legend className="fieldset__legend">Payment details</legend>

        <div className="grid">
          <Field id="cardholderName" label="Name on card" error={errors.cardholderName?.message}>
            {(aria) => (
              <input
                {...aria}
                {...register("cardholderName")}
                className="input"
                type="text"
                autoComplete="cc-name"
                placeholder="A. Okonkwo"
              />
            )}
          </Field>

          <Field
            id="cardNumber"
            label="Card number"
            error={errors.cardNumber?.message}
            adornment={brand ? <span className="badge">{brand}</span> : undefined}
          >
            {(aria) => (
              <Controller
                control={control}
                name="cardNumber"
                render={({ field }) => (
                  <input
                    {...aria}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={(event) => field.onChange(formatCardNumber(event.target.value))}
                    className="input input--mono"
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    placeholder="4242 4242 4242 4242"
                  />
                )}
              />
            )}
          </Field>

          <div className="grid grid--two">
            <Field id="expiry" label="Expiry date" hint="MM/YY" error={errors.expiry?.message}>
              {(aria) => (
                <Controller
                  control={control}
                  name="expiry"
                  render={({ field }) => (
                    <input
                      {...aria}
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(formatExpiry(event.target.value))}
                      className="input input--mono"
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      placeholder="09/29"
                    />
                  )}
                />
              )}
            </Field>

            <Field
              id="cvc"
              label="Security code"
              hint={`${cvcLengthFor(cardNumber)} digits on the ${
                brand === "Amex" ? "front" : "back"
              } of the card`}
              error={errors.cvc?.message}
            >
              {(aria) => (
                <Controller
                  control={control}
                  name="cvc"
                  render={({ field }) => (
                    <input
                      {...aria}
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      onBlur={field.onBlur}
                      onChange={(event) =>
                        field.onChange(onlyDigits(event.target.value).slice(0, 4))
                      }
                      className="input input--mono"
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      placeholder="123"
                    />
                  )}
                />
              )}
            </Field>
          </div>

          <Field
            id="billingEmail"
            label="Billing email"
            hint="Invoices and receipts go here."
            error={errors.billingEmail?.message}
          >
            {(aria) => (
              <input
                {...aria}
                {...register("billingEmail")}
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="accounts@northwind.example.com"
              />
            )}
          </Field>

          <div className={`check${errors.acceptTerms ? " check--invalid" : ""}`}>
            <input
              id="acceptTerms"
              type="checkbox"
              {...register("acceptTerms")}
              aria-invalid={errors.acceptTerms ? true : undefined}
              aria-describedby={errors.acceptTerms ? "acceptTerms-error" : undefined}
            />
            <label htmlFor="acceptTerms">
              I accept the <a href="#terms">terms of service</a> and confirm I'm authorised to
              purchase on behalf of this company.
            </label>
            {errors.acceptTerms && (
              <p className="field__error" id="acceptTerms-error">
                <span>{errors.acceptTerms.message}</span>
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <div className="actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => onBack(getValues())}
          disabled={submitting}
        >
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
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Creating your account…
            </>
          ) : (
            <>Pay £{chargedNow} and finish setup</>
          )}
        </button>
      </div>

      <p className="fineprint">
        Test cards: <code>4242 4242 4242 4242</code> succeeds, <code>4000 0000 0000 0002</code> is
        declined, <code>4000 0000 0000 0127</code> fails the security code.
      </p>
    </form>
  );
}
