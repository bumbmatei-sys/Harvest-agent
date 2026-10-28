/** Shared constraints for public sign-up pages. Handles are canonical lowercase. */
export const SIGNUP_FIELDS = ['name', 'email', 'phone', 'prayerRequest'] as const;
export type SignupField = (typeof SIGNUP_FIELDS)[number];
export type SignupFieldSettings = Record<SignupField, { enabled: boolean; required: boolean }>;

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
