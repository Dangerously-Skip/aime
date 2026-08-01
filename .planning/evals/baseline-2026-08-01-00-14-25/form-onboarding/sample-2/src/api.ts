import type { SetupData } from "./schemas";
import { onlyDigits } from "./validators";

/**
 * Stand-in for the real endpoint. Swap the body of `submitSetup` for a fetch
 * call and everything upstream keeps working — including field-level errors,
 * which arrive as an ApiError carrying the name of the offending field.
 */

export class ApiError extends Error {
  /** Dotted path of the field the server blames, if any. */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.field = field;
  }
}

export type SubmitResult = { accountId: string };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Test cards that force each server-side failure path. */
const DECLINED = "4000000000000002";
const BAD_CVC = "4000000000000127";
const TAKEN_DOMAIN = "example.taken";

export async function submitSetup(data: SetupData): Promise<SubmitResult> {
  await delay(1300);

  const card = onlyDigits(data.billing.cardNumber);

  if (card === DECLINED) {
    throw new ApiError("Your bank declined this card. Try another payment method.", "cardNumber");
  }
  if (card === BAD_CVC) {
    throw new ApiError("That security code doesn't match the card.", "cvc");
  }
  if (data.billing.billingEmail.toLowerCase().endsWith(`@${TAKEN_DOMAIN}`)) {
    throw new ApiError("An account already exists for this email address.", "billingEmail");
  }
  if (card.startsWith("9")) {
    // Unattributable failure — surfaced as a banner rather than on a field.
    throw new ApiError("We couldn't reach the payment provider. Please try again.");
  }

  return { accountId: `acct_${Math.random().toString(36).slice(2, 10)}` };
}
