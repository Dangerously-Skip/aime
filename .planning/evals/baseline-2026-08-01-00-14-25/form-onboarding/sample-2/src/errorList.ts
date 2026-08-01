import type { FieldErrors } from "react-hook-form";

export type ErrorItem = { id: string; message: string };

const SKIP = new Set(["ref", "type", "types"]);

/**
 * Turns react-hook-form's nested error object into a flat, ordered list.
 * The id doubles as the DOM id of the input, so the summary can link to it —
 * every field in this form is registered under the same name as its element id.
 */
export function flattenErrors(errors: FieldErrors | undefined, prefix = ""): ErrorItem[] {
  const items: ErrorItem[] = [];
  if (!errors) return items;

  for (const [key, value] of Object.entries(errors)) {
    if (!value || SKIP.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const message = (value as { message?: unknown }).message;

    if (typeof message === "string" && message.length > 0) {
      items.push({ id: path, message });
      continue;
    }
    if (typeof value === "object") {
      items.push(...flattenErrors(value as FieldErrors, path));
    }
  }
  return items;
}
