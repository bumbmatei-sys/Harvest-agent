/**
 * THE-277 — the Signups page's data shapes and its two CSV exports.
 *
 * ─── Why this is a module and not part of the screen ─────────────────────────
 *
 * 🔴 THE COLUMN LIST IS A PUBLISHED INTERFACE. Churches download these files on
 * a schedule and open them in spreadsheets that have columns mapped by
 * position. A header renamed, reordered or inserted is a silent break in
 * somebody's Monday morning — there is no version negotiation and no error, the
 * numbers just land in the wrong column.
 *
 * Living in `src/components/AnalyticsAndRoles.tsx` (this ticket's source file),
 * the headers could only be asserted by rendering a React tree, mocking a
 * Blob and reading back what got handed to an anchor's `download`. That is a
 * test nobody writes, and so nothing pinned them. Here `CONTACT_CSV_HEADERS` is
 * a value a test can simply compare, which is what `THE-277.signups-split`
 * does — see 'both CSV exports produce the same columns as before'.
 *
 * ⚠️ Everything below moved out of that file UNCHANGED. Same headers, same
 * order, same "Unknown" fallbacks, same `toLocaleDateString("en-US")`, same
 * formula-injection guard. THE-277 is a move, not a redesign: if you are here
 * to change a column, that is a different ticket and it needs the churches
 * warned first.
 */

/** One row of the users collection, as the Signups screen reads it. */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  city: string;
  country: string;
  phone: string;
  acceptedJesus?: boolean;
  registeredAt: string;
  onboardingAnswers?: Record<string, string>;
}

/** The four windows the founder asked for: "1 3 7 30 days". */
export type TimePeriod = 1 | 3 | 7 | 30;

/**
 * 🔴 THE PERIODS, NAMED ONCE.
 *
 * The screen maps this array to its buttons rather than writing `[1, 3, 7, 30]`
 * inline, so the test that pins the four windows and the buttons that render
 * them cannot drift apart.
 */
export const TIME_PERIODS: readonly TimePeriod[] = Object.freeze([1, 3, 7, 30]);

/** "Today" for the 1-day window, "3d"/"7d"/"30d" for the rest. */
export const periodLabel = (d: TimePeriod): string => (d === 1 ? "Today" : `${d}d`);

/** Signups inside the last `days` days. */
export const filterByPeriod = (users: UserRecord[], days: TimePeriod): UserRecord[] => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return users.filter((u) => new Date(u.registeredAt) >= cutoff);
};

/**
 * The founder's "search by city". Matches city OR country, case-insensitively,
 * on a substring — a blank query matches everything rather than nothing.
 */
export const filterByLocation = (users: UserRecord[], q: string): UserRecord[] => {
  if (!q.trim()) return users;
  const lower = q.toLowerCase();
  return users.filter((u) =>
    (u.city && u.city.toLowerCase().includes(lower)) || (u.country && u.country.toLowerCase().includes(lower))
  );
};

export const escapeCsvValue = (val: string): string => {
  // Prefix formula chars to prevent CSV injection in spreadsheet apps
  const str = String(val);
  const safe = /^[=+@\-]/.test(str) ? "'" + str : str;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * 🔴 THE CONTACT EXPORT'S COLUMNS. Pinned by test 3. Do not reorder.
 */
export const CONTACT_CSV_HEADERS: readonly string[] = Object.freeze([
  "Name", "Phone Number", "Email", "Registration Date", "Country", "City", "Accepted Jesus",
]);

/**
 * The onboarding export is these same seven columns plus one per tenant-defined
 * onboarding question, in the tenant's own `order`. The fixed prefix is what a
 * test can pin; the tail is tenant data by definition.
 */
export const ONBOARDING_CSV_FIXED_HEADERS: readonly string[] = CONTACT_CSV_HEADERS;

/** The seven fixed cells of a row, in `CONTACT_CSV_HEADERS` order. */
export const contactCsvRow = (u: UserRecord): string[] => [
  u.name, u.phone || "Unknown", u.email,
  new Date(u.registeredAt).toLocaleDateString("en-US"),
  u.country || "Unknown", u.city || "Unknown",
  u.acceptedJesus !== undefined ? (u.acceptedJesus ? "Yes" : "No") : "Unknown",
];

/** Rows → RFC-4180-ish text. Header row first, `\n` separated. */
export const toCsv = (rows: string[][]): string =>
  rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n");

/** Hand a built CSV to the browser as a download. */
const saveCsv = (csv: string, filename: string): void => {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const downloadUsersCSV = (users: UserRecord[], filename: string): void => {
  saveCsv(toCsv([[...CONTACT_CSV_HEADERS], ...users.map(contactCsvRow)]), filename);
};

export const downloadCSV = (users: UserRecord[], period: TimePeriod, location: string): void => {
  downloadUsersCSV(users, `harvest-users-${location || "all"}-${period}days.csv`);
};

export const downloadOnboardingCSV = async (users: UserRecord[], filename: string): Promise<void> => {
  try {
    const { db } = await import('../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const { getTenantScope } = await import('../utils/tenant-scope');

    // Fetch tenant onboarding questions config for column headers
    let questionLabels: { id: string; label: string }[] = [];
    const tenantId = await getTenantScope();
    if (tenantId) {
      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
      if (tenantDoc.exists()) {
        const config = tenantDoc.data().config || {};
        if (config.onboardingQuestions && Array.isArray(config.onboardingQuestions)) {
          questionLabels = config.onboardingQuestions
            .filter((q: any) => q.id && !q.id.startsWith('default_'))
            .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
            .map((q: any) => ({ id: q.id, label: q.label }));
        }
      }
    }

    const headers = [
      ...ONBOARDING_CSV_FIXED_HEADERS,
      ...questionLabels.map(q => q.label),
    ];

    const rows = users.map((u) => [
      ...contactCsvRow(u),
      ...questionLabels.map(q => (u.onboardingAnswers && u.onboardingAnswers[q.id]) || ""),
    ]);

    saveCsv(toCsv([headers, ...rows]), filename);
  } catch (e) {
    console.error("Failed to download onboarding CSV:", e);
  }
};
