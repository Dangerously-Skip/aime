export type StepId = 'company' | 'team' | 'billing';

export const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: 'company', title: 'Company details', blurb: 'Tell us about your organisation.' },
  { id: 'team', title: 'Team invites', blurb: 'Invite colleagues now, or skip and do it later.' },
  { id: 'billing', title: 'Billing', blurb: 'Choose a plan and add a payment method.' },
];

export type Role = 'admin' | 'member' | 'viewer';
export type Plan = 'starter' | 'growth' | 'scale';

export interface Invite {
  /** Stable client-side id, used for React keys and error paths. */
  id: string;
  email: string;
  role: Role;
}

export interface CompanyDetails {
  name: string;
  website: string;
  size: string;
  country: string;
}

export interface Billing {
  plan: Plan;
  cardName: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
  billingEmail: string;
}

export interface SetupData {
  company: CompanyDetails;
  invites: Invite[];
  billing: Billing;
}

/**
 * Errors are a flat map keyed by field path — `company.name`,
 * `invites.<id>.email`, `billing.cvc`. A flat map keeps the generic <Field>
 * component simple and lets a server response drop straight into the same
 * shape as client-side validation.
 */
export type ErrorMap = Record<string, string>;

export const PLANS: { id: Plan; name: string; price: string; blurb: string }[] = [
  { id: 'starter', name: 'Starter', price: '$0', blurb: 'Up to 3 seats. Core features.' },
  { id: 'growth', name: 'Growth', price: '$29', blurb: 'Per seat / month. Adds SSO and audit logs.' },
  { id: 'scale', name: 'Scale', price: '$79', blurb: 'Per seat / month. Adds SLA and support.' },
];

export const COMPANY_SIZES = ['1-9', '10-49', '50-249', '250-999', '1000+'];

export const COUNTRIES = [
  'United Kingdom',
  'United States',
  'Germany',
  'France',
  'Netherlands',
  'Ireland',
  'Australia',
  'Canada',
];

export const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: 'admin', label: 'Admin', hint: 'Full access, including billing' },
  { id: 'member', label: 'Member', hint: 'Can create and edit' },
  { id: 'viewer', label: 'Viewer', hint: 'Read-only access' },
];

let seq = 0;
export function newInvite(): Invite {
  seq += 1;
  return { id: `invite-${Date.now()}-${seq}`, email: '', role: 'member' };
}

export function emptyData(): SetupData {
  return {
    company: { name: '', website: '', size: '', country: '' },
    invites: [newInvite()],
    billing: {
      plan: 'growth',
      cardName: '',
      cardNumber: '',
      expiry: '',
      cvc: '',
      billingEmail: '',
    },
  };
}
