/** Small, dependency-free input helpers shared by the schemas and the inputs. */

export const onlyDigits = (value: string): string => value.replace(/\D/g, "");

/** Luhn checksum — catches most mistyped card numbers before we hit the network. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 4242424242424242 -> "4242 4242 4242 4242" (Amex is grouped 4-6-5). */
export function formatCardNumber(value: string): string {
  const digits = onlyDigits(value).slice(0, 19);
  if (/^3[47]/.test(digits)) {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      .filter(Boolean)
      .join(" ");
  }
  return (digits.match(/.{1,4}/g) ?? []).join(" ");
}

export function formatExpiry(value: string): string {
  const digits = onlyDigits(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** MM/YY, a real month, and not already in the past. */
export function expiryValid(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  // A card is valid through the last day of its expiry month.
  return new Date(year, month, 1).getTime() > Date.now();
}

export type CardBrand = "Visa" | "Mastercard" | "Amex" | "Discover" | null;

export function cardBrand(value: string): CardBrand {
  const d = onlyDigits(value);
  if (/^4/.test(d)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^6(011|5)/.test(d)) return "Discover";
  return null;
}

export const cvcLengthFor = (cardNumber: string): 3 | 4 =>
  cardBrand(cardNumber) === "Amex" ? 4 : 3;
