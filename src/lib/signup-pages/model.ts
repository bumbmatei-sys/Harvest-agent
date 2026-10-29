import { parseFollowUp, type FollowUp } from '@/lib/form-follow-up/model';
/** Shared constraints for public sign-up pages. Handles are canonical lowercase. */
export const SIGNUP_FIELDS = ['name', 'email', 'phone', 'prayerRequest'] as const;
export type SignupField = (typeof SIGNUP_FIELDS)[number];
export type SignupFieldSettings = Record<SignupField, { enabled: boolean; required: boolean }>;

export interface SignupPageInput {
  handle: string;
  title: string;
  message: string;
  fields: SignupFieldSettings;
  followUp?: FollowUp | null;
}

/** Accept only the public page properties that the server is prepared to store. */
export function parseSignupPageInput(value: unknown): SignupPageInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).filter(key => key !== 'followUp').sort().join(',') !== 'fields,handle,message,title') return null;
  if (!isValidSignupHandle(input.handle) || typeof input.title !== 'string' ||
      typeof input.message !== 'string' || !isValidSignupFieldSettings(input.fields)) return null;
  const title = input.title.trim();
  const message = input.message.trim();
  if (!title || title.length > 120 || message.length > 1000) return null;
  let followUp;
  try { followUp = parseFollowUp(input.followUp); } catch { return null; }
  return { handle: input.handle, title, message, fields: input.fields, ...(input.followUp !== undefined ? { followUp } : {}) };
}

/** Validate against the stored configuration; never accept unconfigured fields. */
export function parseSignupAnswers(value: unknown, fields: SignupFieldSettings): Partial<Record<SignupField, string>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !SIGNUP_FIELDS.includes(key as SignupField))) return null;
  const answers: Partial<Record<SignupField, string>> = {};
  for (const field of SIGNUP_FIELDS) {
    const raw = input[field];
    if (!fields[field].enabled) {
      if (raw !== undefined) return null;
      continue;
    }
    if (raw !== undefined && typeof raw !== 'string') return null;
    const answer = (raw ?? '').trim();
    if ((fields[field].required && !answer) || answer.length > (field === 'prayerRequest' ? 2000 : 320)) return null;
    if (field === 'email' && answer && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) return null;
    if (answer) answers[field] = answer;
  }
  return answers;
}

export function isValidSignupHandle(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 3 && value.length <= 50 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function isValidSignupFieldSettings(value: unknown): value is SignupFieldSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== SIGNUP_FIELDS.length) return false;
  return SIGNUP_FIELDS.every((field) => {
    const settings = fields[field];
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
    const entry = settings as Record<string, unknown>;
    return Object.keys(entry).length === 2 && typeof entry.enabled === 'boolean' &&
      typeof entry.required === 'boolean' && (!entry.required || entry.enabled);
  }) && SIGNUP_FIELDS.some((field) => (fields[field] as { enabled: boolean }).enabled);
}

/** Spreadsheet programs may interpret a cell as a formula after leading whitespace. */
export function escapeSignupCsvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function signupRowsToCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeSignupCsvCell).join(',')).join('\r\n');
}
