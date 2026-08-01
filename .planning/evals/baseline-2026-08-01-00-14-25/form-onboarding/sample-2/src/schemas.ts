import { z } from "zod";
import { cvcLengthFor, expiryValid, luhnValid, onlyDigits } from "./validators";

/* ------------------------------------------------------------------ options */

export const COMPANY_SIZES = [
  { value: "1-9", label: "1–9 people" },
  { value: "10-49", label: "10–49 people" },
  { value: "50-199", label: "50–199 people" },
  { value: "200-999", label: "200–999 people" },
  { value: "1000+", label: "1,000+ people" },
] as const;

export const INDUSTRIES = [
  "Software & IT",
  "Financial services",
  "Healthcare",
  "Education",
  "Retail & e-commerce",
  "Manufacturing",
  "Professional services",
  "Non-profit",
  "Other",
] as const;

export const COUNTRIES = [
  "United Kingdom",
  "United States",
  "Canada",
  "Ireland",
  "Germany",
  "France",
  "Netherlands",
  "Spain",
  "Australia",
  "New Zealand",
  "Singapore",
  "Japan",
] as const;

export const ROLES = [
  { value: "admin", label: "Admin", hint: "Full access, including billing" },
  { value: "member", label: "Member", hint: "Can create and edit" },
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
] as const;

export const ROLE_VALUES = ["admin", "member", "viewer"] as const;

export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    monthly: 12,
    annual: 10,
    blurb: "For small teams finding their feet.",
    features: ["Up to 5 seats", "10 GB storage", "Email support"],
  },
  {
    id: "growth",
    name: "Growth",
    monthly: 32,
    annual: 26,
    blurb: "For teams that need automation and controls.",
    features: ["Up to 50 seats", "250 GB storage", "SSO & audit log", "Priority support"],
    popular: true,
  },
  {
    id: "scale",
    name: "Scale",
    monthly: 79,
    annual: 65,
    blurb: "For organisations with compliance needs.",
    features: ["Unlimited seats", "1 TB storage", "SAML, SCIM, DPA", "Dedicated CSM"],
  },
] as const;

export const PLAN_IDS = ["starter", "growth", "scale"] as const;

/* --------------------------------------------------------- step 1: company */

export const companySchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters")
    .max(80, "Company name must be 80 characters or fewer"),
  website: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v), {
      message: "Enter a full URL, including https://",
    }),
  companySize: z.string().min(1, "Select your company size"),
  industry: z.string().min(1, "Select your industry"),
  country: z.string().min(1, "Select the country you're billed in"),
  taxId: z.string().trim().max(32, "Tax ID must be 32 characters or fewer"),
});

export type CompanyValues = z.infer<typeof companySchema>;

export const emptyCompany: CompanyValues = {
  companyName: "",
  website: "",
  companySize: "",
  industry: "",
  country: "",
  taxId: "",
};

/* ------------------------------------------------------------ step 2: team */

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required")
    .email("Enter a valid email address, like ana@example.com"),
  role: z.enum(ROLE_VALUES),
});

export type InviteValues = z.infer<typeof inviteSchema>;

export const teamSchema = z
  .object({ invites: z.array(inviteSchema).max(25, "You can invite up to 25 people here") })
  .superRefine(({ invites }, ctx) => {
    const seen = new Map<string, number>();
    invites.forEach((invite, index) => {
      const key = invite.email.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["invites", index, "email"],
          message: `Already invited on row ${(seen.get(key) ?? 0) + 1}`,
        });
        return;
      }
      seen.set(key, index);
    });
  });

export type TeamValues = z.infer<typeof teamSchema>;

export const emptyTeam: TeamValues = { invites: [{ email: "", role: "member" }] };

/* --------------------------------------------------------- step 3: billing */

export const billingSchema = z
  .object({
    plan: z.enum(PLAN_IDS),
    cycle: z.enum(["monthly", "annual"]),
    cardholderName: z.string().trim().min(2, "Enter the name printed on the card"),
    cardNumber: z
      .string()
      .min(1, "Card number is required")
      .refine((v) => luhnValid(onlyDigits(v)), "Check the card number — those digits don't look right"),
    expiry: z
      .string()
      .min(1, "Expiry date is required")
      .refine((v) => expiryValid(v), "Enter a valid future date as MM/YY"),
    cvc: z.string().min(1, "Security code is required"),
    billingEmail: z
      .string()
      .trim()
      .min(1, "Billing email is required")
      .email("Enter a valid email address"),
    acceptTerms: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const expected = cvcLengthFor(values.cardNumber);
    if (!new RegExp(`^\\d{${expected}}$`).test(values.cvc.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cvc"],
        message: `Security code must be ${expected} digits`,
      });
    }
    if (!values.acceptTerms) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptTerms"],
        message: "You need to accept the terms before we can create the account",
      });
    }
  });

export type BillingValues = z.infer<typeof billingSchema>;

export const emptyBilling: BillingValues = {
  plan: "growth",
  cycle: "monthly",
  cardholderName: "",
  cardNumber: "",
  expiry: "",
  cvc: "",
  billingEmail: "",
  acceptTerms: false,
};

/* ------------------------------------------------------------- whole thing */

export type SetupData = {
  company: CompanyValues;
  team: TeamValues;
  billing: BillingValues;
};

export const planById = (id: (typeof PLAN_IDS)[number]) =>
  PLANS.find((plan) => plan.id === id) ?? PLANS[1];

export const seatPrice = (id: (typeof PLAN_IDS)[number], cycle: "monthly" | "annual") =>
  cycle === "annual" ? planById(id).annual : planById(id).monthly;
