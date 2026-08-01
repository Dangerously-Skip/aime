import type { Billing, CompanyDetails, ErrorMap, Invite, StepId, SetupData } from './types';

/**
 * Deliberately permissive: one @, no whitespace, a dot in the domain.
 * Over-strict email regexes reject valid addresses, which is a worse
 * failure than letting a typo through to the confirmation email.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Luhn checksum — catches most mistyped card numbers before they hit the API. */
export function luhnValid(cardNumber: string): boolean {
  const digits = digitsOnly(cardNumber);
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Format as you type: groups of 4, capped at 19 digits. */
export function formatCardNumber(value: string): string {
  const digits = digitsOnly(value).slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

/** Format as you type: MM/YY, inserting the slash automatically. */
export function formatExpiry(value: string): string {
  const digits = digitsOnly(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/**
 * `now` is injectable so the "card has expired" rule is testable without
 * mocking the system clock.
 */
export function expiryError(value: string, now: Date = new Date()): string | null {
  if (!value.trim()) return 'Enter the expiry date.';
  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(value.trim());
  if (!match) return 'Use MM/YY format, for example 09/28.';
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return 'Month must be between 01 and 12.';
  // A card is valid through the last day of its expiry month.
  const expiresAfter = new Date(year, month, 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (expiresAfter <= startOfToday) return 'This card has expired.';
  if (year > now.getFullYear() + 20) return 'Check the expiry year.';
  return null;
}

export function validateCompany(company: CompanyDetails): ErrorMap {
  const errors: ErrorMap = {};
  const name = company.name.trim();
  if (!name) errors['company.name'] = 'Enter your company name.';
  else if (name.length < 2) errors['company.name'] = 'That looks too short to be a company name.';
  else if (name.length > 120) errors['company.name'] = 'Keep this under 120 characters.';

  const website = company.website.trim();
  if (website) {
    // Accept with or without a scheme; reject anything without a dotted host.
    const candidate = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    let ok = false;
    try {
      const url = new URL(candidate);
      ok = /^[^\s.]+(\.[^\s.]+)+$/.test(url.hostname);
    } catch {
      ok = false;
    }
    if (!ok) errors['company.website'] = 'Enter a valid web address, for example acme.com.';
  }

  if (!company.size) errors['company.size'] = 'Select your company size.';
  if (!company.country) errors['company.country'] = 'Select your country.';
  return errors;
}

/**
 * Invites are optional — an empty row is treated as "not filled in" rather
 * than an error, so the whole step can be skipped. A row with anything in it
 * must be a valid, non-duplicate email.
 */
export function validateInvites(invites: Invite[]): ErrorMap {
  const errors: ErrorMap = {};
  const seen = new Map<string, number>();

  invites.forEach((invite) => {
    const email = invite.email.trim();
    if (!email) return;
    if (!EMAIL.test(email)) {
      errors[`invites.${invite.id}.email`] = 'Enter a valid email address.';
      return;
    }
    const key = email.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      errors[`invites.${invite.id}.email`] = 'You have already invited this address.';
    }
  });

  if (invites.filter((i) => i.email.trim()).length > 50) {
    errors['invites'] = 'You can invite up to 50 people here. Bulk import is available later.';
  }
  return errors;
}

export function validateBilling(billing: Billing, now: Date = new Date()): ErrorMap {
  const errors: ErrorMap = {};
  if (!billing.plan) errors['billing.plan'] = 'Choose a plan.';

  if (!billing.cardName.trim()) errors['billing.cardName'] = 'Enter the name on the card.';

  const card = digitsOnly(billing.cardNumber);
  if (!card) errors['billing.cardNumber'] = 'Enter your card number.';
  else if (card.length < 13 || card.length > 19)
    errors['billing.cardNumber'] = 'Card numbers are between 13 and 19 digits.';
  else if (!luhnValid(card)) errors['billing.cardNumber'] = 'Check the card number — it looks incorrect.';

  const expiry = expiryError(billing.expiry, now);
  if (expiry) errors['billing.expiry'] = expiry;

  const cvc = digitsOnly(billing.cvc);
  if (!cvc) errors['billing.cvc'] = 'Enter the security code.';
  else if (cvc.length < 3 || cvc.length > 4) errors['billing.cvc'] = 'The code is 3 or 4 digits.';

  const email = billing.billingEmail.trim();
  if (!email) errors['billing.billingEmail'] = 'Enter an email for receipts.';
  else if (!EMAIL.test(email)) errors['billing.billingEmail'] = 'Enter a valid email address.';

  return errors;
}

export function validateStep(step: StepId, data: SetupData, now?: Date): ErrorMap {
  switch (step) {
    case 'company':
      return validateCompany(data.company);
    case 'team':
      return validateInvites(data.invites);
    case 'billing':
      return validateBilling(data.billing, now);
  }
}
