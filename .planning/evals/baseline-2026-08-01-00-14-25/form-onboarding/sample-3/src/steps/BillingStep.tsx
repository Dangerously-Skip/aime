import { Field } from '../components/Field';
import { PLANS, type Billing, type ErrorMap, type Plan } from '../types';
import { formatCardNumber, formatExpiry, digitsOnly } from '../validation';

interface Props {
  value: Billing;
  seats: number;
  errors: ErrorMap;
  onChange: <K extends keyof Billing>(key: K, value: Billing[K]) => void;
  onBlur: (path: string) => void;
}

export function BillingStep({ value, seats, errors, onChange, onBlur }: Props) {
  const plan = PLANS.find((p) => p.id === value.plan);

  return (
    <div className="grid">
      <fieldset className="plans">
        <legend className="field__label">Plan</legend>
        <div className="plans__options">
          {PLANS.map((p) => (
            <label key={p.id} className={`plan${value.plan === p.id ? ' plan--selected' : ''}`}>
              <input
                type="radio"
                name="plan"
                value={p.id}
                checked={value.plan === p.id}
                onChange={() => onChange('plan', p.id as Plan)}
                className="plan__radio"
              />
              <span className="plan__head">
                <span className="plan__name">{p.name}</span>
                <span className="plan__price">{p.price}</span>
              </span>
              <span className="plan__blurb">{p.blurb}</span>
            </label>
          ))}
        </div>
        {errors['billing.plan'] && (
          <p className="field__error" role="alert">
            {errors['billing.plan']}
          </p>
        )}
      </fieldset>

      {plan && plan.id !== 'starter' && (
        <p className="note note--muted">
          {seats} {seats === 1 ? 'seat' : 'seats'} on {plan.name} — billed monthly, cancel any time.
        </p>
      )}

      <Field path="billing.cardName" label="Name on card" error={errors['billing.cardName']}>
        {(p) => (
          <input
            {...p}
            className="input"
            type="text"
            autoComplete="cc-name"
            value={value.cardName}
            onChange={(e) => onChange('cardName', e.target.value)}
            onBlur={() => onBlur('billing.cardName')}
          />
        )}
      </Field>

      <Field
        path="billing.cardNumber"
        label="Card number"
        hint="Test card: 4242 4242 4242 4242"
        error={errors['billing.cardNumber']}
      >
        {(p) => (
          <input
            {...p}
            className="input input--mono"
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="1234 5678 9012 3456"
            value={value.cardNumber}
            onChange={(e) => onChange('cardNumber', formatCardNumber(e.target.value))}
            onBlur={() => onBlur('billing.cardNumber')}
          />
        )}
      </Field>

      <div className="grid grid--2">
        <Field path="billing.expiry" label="Expiry" error={errors['billing.expiry']}>
          {(p) => (
            <input
              {...p}
              className="input input--mono"
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM/YY"
              value={value.expiry}
              onChange={(e) => onChange('expiry', formatExpiry(e.target.value))}
              onBlur={() => onBlur('billing.expiry')}
            />
          )}
        </Field>

        <Field path="billing.cvc" label="Security code" error={errors['billing.cvc']}>
          {(p) => (
            <input
              {...p}
              className="input input--mono"
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              maxLength={4}
              value={value.cvc}
              onChange={(e) => onChange('cvc', digitsOnly(e.target.value).slice(0, 4))}
              onBlur={() => onBlur('billing.cvc')}
            />
          )}
        </Field>
      </div>

      <Field
        path="billing.billingEmail"
        label="Billing email"
        hint="Where we send receipts and invoices."
        error={errors['billing.billingEmail']}
      >
        {(p) => (
          <input
            {...p}
            className="input"
            type="email"
            autoComplete="email"
            value={value.billingEmail}
            onChange={(e) => onChange('billingEmail', e.target.value)}
            onBlur={() => onBlur('billing.billingEmail')}
          />
        )}
      </Field>
    </div>
  );
}
