import type { ErrorMap, SetupData } from './types';
import { digitsOnly } from './validation';

export type SubmitResult =
  | { ok: true; accountId: string }
  | { ok: false; message: string; fieldErrors?: ErrorMap };

/**
 * Stand-in for the real endpoint. Swap the body of this function for a fetch;
 * the contract (a message plus an optional map of field-path -> message) is
 * what the form is built against, so nothing upstream needs to change.
 *
 * Test triggers, so the error paths are demonstrable:
 *  - a card number ending 0002 is declined by the "bank"
 *  - a company name containing "acme" is already taken, which is an error on
 *    step 1 raised while the user is on step 3
 */
export async function submitSetup(data: SetupData): Promise<SubmitResult> {
  await new Promise((resolve) => setTimeout(resolve, 1100));

  if (/acme/i.test(data.company.name)) {
    return {
      ok: false,
      message: 'We could not create the account. Check the highlighted fields.',
      fieldErrors: { 'company.name': 'An account already exists for this company name.' },
    };
  }

  if (digitsOnly(data.billing.cardNumber).endsWith('0002')) {
    return {
      ok: false,
      message: 'Your bank declined the card.',
      fieldErrors: { 'billing.cardNumber': 'This card was declined. Try a different payment method.' },
    };
  }

  return { ok: true, accountId: `acct_${Math.random().toString(36).slice(2, 10)}` };
}
