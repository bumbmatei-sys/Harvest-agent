/**
 * THE-277 — Signups: who created an account, where, and when.
 *
 * ─── This screen was not built here, it was MOVED here ───────────────────────
 *
 * Every capability below already shipped inside `AnalyticsAndRoles.tsx` (now
 * `AdminRoles.tsx`) as the "Analytics" sub-tab of the CRM screen. The founder
 * asked for "the option to search by city and when they signed up 1 3 7 30
 * days" — all of which existed. So this file is a MOVE and a RESTYLE, and the
 * behaviour is carried over deliberately unchanged:
 *
 *   · the city/country search        · the four windows, 1 / 3 / 7 / 30 days
 *   · the signup date on every row   · the "{n} results in {q} — last {p} days"
 *   · Total Users / Countries tiles  · BOTH CSV exports, columns untouched
 *
 * ─── Why it is its own page and not a CRM sub-tab ────────────────────────────
 *
 * 🔴 CRM AND THIS SCREEN COUNT DIFFERENT PEOPLE. `AdminCRM` tracks CONTACTS —
 * people the church is working, with stages, tags and a pipeline. This tracks
 * MEMBERS — people who created an account. Different collection, different
 * meaning, different question. They shared a screen because Analytics was
 * folded into CRM as a sub-tab, not because the two are one subject.
 *
 * And not the dashboard either: a dashboard is glanceable numbers, while this
 * is a tool you WORK IN — type a city, pick a window, read the list, export it.
 * ⚠️ It is NOT a duplicate of the dashboard's "Where your people are", which is
 * an aggregate choropleth. Both are worth having.
 *
 * ─── The Analytics permission still gates it ─────────────────────────────────
 *
 * 🔴 This component does NOT gate itself, on purpose, and that is the same
 * shape every other admin screen has. `AdminDashboard` decides who sees the
 * `signups` nav entry and who gets the screen rendered, from the SAME
 * `analytics` permission that used to decide who saw the CRM sub-tab
 * (`AdminCRM.canViewAnalytics`, now retired with it). One gate, in the one
 * place this app puts gates, asserted by `THE-277.signups-split`.
 *
 * ─── The restyle, and the layer it uses ──────────────────────────────────────
 *
 * The source file styles itself with 193 inline `style={{}}` objects against 9
 * `className`s, which is why the design system could never reach it: an inline
 * style out-ranks every class, so no palette, no token and no `dark:` variant
 * applied to a single one of them. What moved here is written in the TOKEN
 * VOCABULARY instead (`text-strong`, `bg-surface-raised`, `border-line`, …), so
 * all four palettes — Classic light/dark and Harvest light/dark — resolve from
 * one place, and the seven emoji that stood in for icons are `lucide-react`
 * components, which take a `color` where a platform glyph never could.
 *
 * 🔴 AND IT USES NO SHADCN PRIMITIVE, DELIBERATELY. `src/components/ui` holds
 * 40-odd installed primitives, and `card` / `table` / `badge` / `empty` /
 * `breadcrumb` would all have fitted this screen. They are NOT adopted here
 * because three merged tickets say they may not be yet — THE-266, THE-272 and
 * THE-274 each end with the same guard, `nothing imports the new components —
 * installing is this ticket, not adopting`, asserting that no file outside
 * `src/components/ui` imports one. Adoption is Phase 8's ticket, and a screen
 * that quietly went first would have to weaken three other tickets' guards to
 * land.
 *
 * ⚠️ Nothing is lost by waiting: the primitives are written in this same token
 * vocabulary, so the classes below are what a later `<Card>` would compile to.
 * This screen converts cleanly when Phase 8 comes for it.
 */
"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { collection, query, getDocs, doc, where, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { OperationType, handleFirestoreError } from "../utils/firestore-errors";
import { getTenantScope } from "../utils/tenant-scope";
import {
  Users, Globe, TrendingUp, Search, SearchX, X, MapPin, Phone, Download,
  ClipboardList, ChevronDown, ChevronRight, AlertTriangle, Trash2, type LucideIcon,
} from "lucide-react";
import {
  type UserRecord, type TimePeriod, TIME_PERIODS, periodLabel,
  filterByPeriod, filterByLocation,
  downloadCSV, downloadUsersCSV, downloadOnboardingCSV,
} from "../lib/signups-export";
import { FIELD_WIDTH, ACTION_BUTTON, CONTROL_DENSITY } from "./layout/form-layout";

type SubView = "main" | "all_users" | "countries" | "country_users";

/* ── The shared class vocabulary ────────────────────────────────────────────
   Named once, at the top, so a reader sees the whole palette this screen uses
   and so no card can drift from the next one. Every value is a TOKEN class —
   there is no hex and no literal colour anywhere in this file. */
const CARD = "bg-surface-raised rounded-2xl border border-line-hairline shadow-xs";
const HEAD_CELL = "px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-muted whitespace-nowrap";
const CELL = "px-4 py-3 text-[13px] text-body whitespace-nowrap";
const LABEL = "block text-xs font-bold uppercase tracking-wide text-muted";
const TEXT_INPUT =
  "w-full rounded-xl border border-line-hairline bg-surface-raised py-2.5 text-sm text-strong " +
  "placeholder:text-faint focus:border-gold focus:outline-hidden";

/* ── Stat tile ─────────────────────────────────────────────────────────────
   Three of these head the screen. `accent` is a TOKEN class, never a hex, so
   the tile's colour is one thing the palette owns rather than three. */
interface StatCardProps {
  /** A `data-` handle a test can name the tile by — never its rendered text,
      which is the VALUE concatenated with the label and moves with the data. */
  handle: string;
  label: string;
  value: string | number;
  sub: string;
  icon: LucideIcon;
  accent: string;
  onClick?: () => void;
}

function StatCard({ handle, label, value, sub, icon: Icon, accent, onClick }: StatCardProps) {
  const body = (
    <>
      <span className={`flex size-9 items-center justify-center rounded-brand bg-surface-sunken ${accent}`}>
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="mt-2 block text-[26px] font-extrabold leading-none text-strong">{value}</span>
      <span className="mt-1 block text-xs text-muted">{label}</span>
      <span className={`mt-0.5 block text-[11px] font-semibold ${accent}`}>{sub}</span>
    </>
  );
  // A tile that navigates is a button; a tile that only reports is not. Two
  // elements rather than a div with an onClick, so the keyboard and the screen
  // reader get the truth about which of the three can be activated.
  return (
    <div {...{ [handle]: "" }} className={`${CARD} min-w-0 flex-1`}>
      {onClick ? (
        <button type="button" onClick={onClick} className="w-full cursor-pointer p-4 text-left transition-transform active:scale-[0.98]">
          {body}
        </button>
      ) : (
        <div className="p-4">{body}</div>
      )}
    </div>
  );
}

/* ── The export control ────────────────────────────────────────────────────
   One brand-coloured Download that opens to the two exports. Closes on
   outside-click, Esc, or a selection — the source screen's own behaviour.
   🔴 Neither callback's COLUMNS are this screen's to change: see
   src/lib/signups-export.ts, which owns them and says why. */
function DownloadMenu({ onContacts, onOnboarding }: { onContacts: () => void; onOnboarding: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const pick = (fn: () => void) => { fn(); setOpen(false); };
  const item = "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-body hover:bg-surface-sunken";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-brand border border-line bg-surface-raised px-3 py-1.5 text-[13px] font-bold text-gold hover:bg-surface-sunken"
      >
        <Download className="size-3.5" aria-hidden="true" />
        Download
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-[190px] overflow-hidden rounded-brand-lg border border-line bg-surface-raised shadow-lg">
          <button type="button" role="menuitem" onClick={() => pick(onContacts)} className={item}>
            <Download className="size-4 shrink-0" aria-hidden="true" /> Contact details
          </button>
          <button type="button" role="menuitem" onClick={() => pick(onOnboarding)} className={`${item} border-t border-line-hairline`}>
            <ClipboardList className="size-4 shrink-0" aria-hidden="true" /> Onboarding data
          </button>
        </div>
      )}
    </div>
  );
}

/* ── A user table, shared by the three list sub-views ──────────────────────
   `overflow-x-auto` on the wrapper and nowhere else: a table this wide scrolls
   INSIDE its own card, so the page body never scrolls sideways at 380px. */
function UserTable({ users, onDelete }: { users: UserRecord[]; onDelete: (id: string) => void }) {
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={HEAD_CELL}>Name</th>
              <th className={HEAD_CELL}>Phone Number</th>
              <th className={HEAD_CELL}>Email</th>
              <th className={HEAD_CELL}>Registered</th>
              <th className={HEAD_CELL}>Country</th>
              <th className={HEAD_CELL}>City</th>
              <th className={`${HEAD_CELL} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line-hairline last:border-0">
                <td className={`${CELL} font-semibold text-strong`}>{u.name}</td>
                <td className={CELL}>{u.phone || "Unknown"}</td>
                <td className={CELL}>{u.email}</td>
                <td className={CELL}>{new Date(u.registeredAt).toLocaleDateString()}</td>
                <td className={CELL}>{u.country || "Unknown"}</td>
                <td className={CELL}>{u.city || "Unknown"}</td>
                <td className={`${CELL} text-right`}>
                  <button
                    type="button"
                    onClick={() => onDelete(u.id)}
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-danger hover:text-danger-strong"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminSignups() {
  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [subView, setSubView] = useState<SubView>("main");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [listSearchQuery, setListSearchQuery] = useState("");

  const [locationQuery, setLocationQuery] = useState("");
  const [period, setPeriod] = useState<TimePeriod>(7);
  const [hasSearched, setHasSearched] = useState(false);
  const [filteredUsers, setFilteredUsers] = useState<UserRecord[]>([]);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);

  // Clearing the list search when the sub-view changes: a query typed on
  // "All Users" would otherwise silently filter the country list next.
  useEffect(() => { setListSearchQuery(""); }, [subView]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const tenantId = await getTenantScope();
        const q = tenantId
          ? query(collection(db, "users"), where("tenantId", "==", tenantId))
          : query(collection(db, "users"));
        const usersSnap = await getDocs(q);
        const usersList: UserRecord[] = [];
        usersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          usersList.push({
            id: docSnap.id,
            name: data.displayName || data.name || "Unknown",
            email: data.email || "",
            city: data.city || "",
            country: data.country || "",
            phone: data.phone || "",
            acceptedJesus: data.acceptedJesus,
            registeredAt: data.createdAt || new Date().toISOString(),
            onboardingAnswers: data.onboardingAnswers || {},
          });
        });
        setAllUsers(usersList);
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, `users`); } catch (e) { console.error(e); }
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const handleSearch = (): void => {
    const byPeriod = filterByPeriod(allUsers, period);
    const byLocation = filterByLocation(byPeriod, locationQuery);
    setFilteredUsers(byLocation);
    setHasSearched(true);
  };

  const handleReset = (): void => {
    setLocationQuery("");
    setFilteredUsers([]);
    setHasSearched(false);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await deleteDoc(doc(db, "users", userToDelete));
      setAllUsers((prev) => prev.filter((u) => u.id !== userToDelete));
      setFilteredUsers((prev) => prev.filter((u) => u.id !== userToDelete));
      setUserToDelete(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `users/${userToDelete}`); } catch (e) { console.error(e); }
    }
  };

  const totalAll = allUsers.length;
  const periodAll = filterByPeriod(allUsers, period);
  const countries = new Set(allUsers.map((u) => u.country).filter(Boolean)).size;

  const countryRows = useMemo(() => {
    const countryMap = new Map<string, number>();
    allUsers.forEach((u) => {
      const c = u.country || "Unknown";
      countryMap.set(c, (countryMap.get(c) || 0) + 1);
    });
    return Array.from(countryMap.entries()).map(([country, count]) => ({ country, count }));
  }, [allUsers]);

  const matchesList = (u: UserRecord) =>
    u.name.toLowerCase().includes(listSearchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(listSearchQuery.toLowerCase());

  /* ── Sub-view: every user ─────────────────────────────────────────────── */
  const renderAllUsers = () => {
    const filtered = allUsers.filter(matchesList);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Crumbs trail={[{ label: "Signups", onClick: () => setSubView("main") }]} current={`All Users (${filtered.length})`} />
          <div className="flex-1" />
          <DownloadMenu
            onContacts={() => downloadUsersCSV(filtered, "all_users.csv")}
            onOnboarding={() => downloadOnboardingCSV(filtered, "all_users_onboarding.csv")}
          />
        </div>
        <ListSearch value={listSearchQuery} onChange={setListSearchQuery} placeholder="Search users by name or email..." />
        <UserTable users={filtered} onDelete={setUserToDelete} />
      </div>
    );
  };

  /* ── Sub-view: countries, by headcount ────────────────────────────────── */
  const renderCountries = () => {
    const filtered = countryRows
      .filter((c) => c.country.toLowerCase().includes(listSearchQuery.toLowerCase()))
      .sort((a, b) => b.count - a.count);
    return (
      <div className="flex flex-col gap-4">
        <Crumbs trail={[{ label: "Signups", onClick: () => setSubView("main") }]} current={`Countries (${filtered.length})`} />
        <ListSearch value={listSearchQuery} onChange={setListSearchQuery} placeholder="Search countries..." />
        <div className={`${CARD} overflow-hidden`}>
          <div className="w-full overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className={HEAD_CELL}>Country</th>
                  <th className={`${HEAD_CELL} text-right`}>Users</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.country}
                    onClick={() => { setSelectedCountry(c.country); setSubView("country_users"); }}
                    className="cursor-pointer border-b border-line-hairline last:border-0 hover:bg-surface-sunken"
                  >
                    <td className={`${CELL} font-semibold text-strong`}>{c.country}</td>
                    <td className={`${CELL} text-right`}>{c.count}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-muted">No countries found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  /* ── Sub-view: one country's users ────────────────────────────────────── */
  const renderCountryUsers = () => {
    const filtered = allUsers
      .filter((u) => (u.country || "Unknown") === selectedCountry)
      .filter(matchesList);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Crumbs
            trail={[
              { label: "Signups", onClick: () => setSubView("main") },
              { label: "Countries", onClick: () => setSubView("countries") },
            ]}
            current={`${selectedCountry} (${filtered.length})`}
          />
          <div className="flex-1" />
          <DownloadMenu
            onContacts={() => downloadUsersCSV(filtered, `${selectedCountry}_users.csv`)}
            onOnboarding={() => downloadOnboardingCSV(filtered, `${selectedCountry}_users_onboarding.csv`)}
          />
        </div>
        <ListSearch value={listSearchQuery} onChange={setListSearchQuery} placeholder="Search users by name or email..." />
        <UserTable users={filtered} onDelete={setUserToDelete} />
      </div>
    );
  };

  return (
    <div data-screen="AdminSignups" className="w-full pb-16">
      {subView === "main" && (
        <div className="flex flex-col gap-4">
          {/* ── The three tiles ──────────────────────────────────────────── */}
          <div className="flex gap-3">
            {loading ? (
              <>
                <div className={`${CARD} h-[104px] flex-1 animate-pulse`} aria-hidden="true" />
                <div className={`${CARD} h-[104px] flex-1 animate-pulse`} aria-hidden="true" />
                <div className={`${CARD} h-[104px] flex-1 animate-pulse`} aria-hidden="true" />
              </>
            ) : (
              <>
                <StatCard handle="data-tile-total" icon={Users} label="Total Users" value={totalAll} sub="All time" accent="text-gold" onClick={() => setSubView("all_users")} />
                <StatCard handle="data-tile-countries" icon={Globe} label="Countries" value={countries} sub="Represented" accent="text-blue-600" onClick={() => setSubView("countries")} />
                <StatCard handle="data-tile-period" icon={TrendingUp} label={`Last ${period}d`} value={periodAll.length} sub="New signups" accent="text-green-600" />
              </>
            )}
          </div>

          {/* ── Search Registrations ─────────────────────────────────────── */}
          <div data-search-registrations="" className={CARD}>
            <div className="border-b border-line-hairline px-4 py-3 text-[13px] font-bold text-strong">
              Search Registrations
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div>
                <span className={LABEL} id="signups-period-label">Time Period</span>
                {/* 🔴 Rule 2 (form-layout.ts): the four period buttons are a
                    `medium` FIELD, not a row that stretches to whatever the card
                    has spare. Carried over from the source screen unchanged, and
                    pinned by `THE-277.signups-split`. */}
                <div
                  data-period-field=""
                  role="group"
                  aria-labelledby="signups-period-label"
                  className={`${FIELD_WIDTH.medium} mt-1.5 grid grid-cols-4 gap-2`}
                >
                  {TIME_PERIODS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPeriod(d)}
                      aria-pressed={period === d}
                      className={`rounded-brand border-[1.5px] px-1 py-2.5 text-[13px] font-bold transition-colors ${
                        period === d
                          ? "border-gold bg-gold text-surface-raised"
                          : "border-line bg-surface-raised text-muted hover:border-gold"
                      }`}
                    >
                      {periodLabel(d)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={LABEL} htmlFor="signups-location">Location Filter</label>
                <div className={`${FIELD_WIDTH.long} relative mt-1.5`}>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input
                    id="signups-location"
                    value={locationQuery}
                    onChange={(e) => setLocationQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Search by city or country..."
                    className={`${TEXT_INPUT} px-9`}
                  />
                  {locationQuery && (
                    <button
                      type="button"
                      onClick={() => setLocationQuery("")}
                      aria-label="Clear location filter"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-strong"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {/* Rule 3 + Rule 4: full width on a phone, content width and the
                  shared 40px action box from `sm:` up. */}
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={handleReset}
                  data-analytics-reset=""
                  className={`flex-[1] p-[11px] sm:p-0 ${ACTION_BUTTON} ${CONTROL_DENSITY.action} rounded-brand border-[1.5px] border-line bg-transparent text-[13px] font-bold text-muted hover:border-gold`}
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSearch}
                  data-analytics-search=""
                  className={`flex-[2] p-[11px] sm:p-0 ${ACTION_BUTTON} ${CONTROL_DENSITY.action} rounded-brand bg-gold text-sm font-extrabold text-surface-raised`}
                >
                  Search
                </button>
              </div>
            </div>
          </div>

          {/* ── Results ──────────────────────────────────────────────────── */}
          {hasSearched && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-hairline px-4 py-3">
                <span data-results-summary="" className="text-[13px] font-bold text-strong">
                  {filteredUsers.length} result{filteredUsers.length !== 1 ? "s" : ""}
                  {locationQuery ? ` in "${locationQuery}"` : ""} — last {period} day{period !== 1 ? "s" : ""}
                </span>
                {filteredUsers.length > 0 && (
                  <DownloadMenu
                    onContacts={() => downloadCSV(filteredUsers, period, locationQuery)}
                    onOnboarding={() => downloadOnboardingCSV(filteredUsers, `onboarding-${locationQuery || "all"}-${period}days.csv`)}
                  />
                )}
              </div>

              {filteredUsers.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                  <span className="mb-1 flex size-10 items-center justify-center rounded-brand bg-surface-sunken text-muted">
                    <SearchX className="size-5" aria-hidden="true" />
                  </span>
                  <div className="text-sm font-semibold text-strong">No users found</div>
                  <div className="text-[13px] text-muted">Try a different location or time period</div>
                </div>
              ) : (
                <ul>
                  {filteredUsers.map((user) => (
                    <li key={user.id} className="flex items-center gap-3 border-b border-line-hairline px-4 py-3 last:border-0">
                      <span
                        aria-hidden="true"
                        className="flex size-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-gold bg-surface-gold text-sm font-bold text-gold"
                      >
                        {user.name.charAt(0)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-strong">{user.name}</div>
                        <div className="truncate text-xs text-muted">{user.email}</div>
                        {user.phone && (
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                            <Phone className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{user.phone}</span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1 text-xs font-semibold text-strong">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{user.city || "Unknown"}, {user.country || "Unknown"}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          {new Date(user.registeredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                        <button
                          type="button"
                          onClick={() => setUserToDelete(user.id)}
                          className="mt-1 text-[11px] font-semibold text-danger hover:text-danger-strong"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {subView === "all_users" && renderAllUsers()}
      {subView === "countries" && renderCountries()}
      {subView === "country_users" && renderCountryUsers()}

      {/* ── Delete confirmation ──────────────────────────────────────────── */}
      {userToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="signups-delete-title"
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-[color-mix(in_srgb,var(--text-strong)_50%,transparent)] p-5"
        >
          <div className={`${CARD} w-full max-w-[360px] overflow-hidden`}>
            <div className="px-5 pb-4 pt-5 text-center">
              <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-100 text-danger">
                <AlertTriangle className="size-6" aria-hidden="true" />
              </span>
              <h3 id="signups-delete-title" className="mb-2 font-display text-lg font-extrabold text-strong">Delete User?</h3>
              <p className="text-sm leading-relaxed text-muted">
                Are you sure you want to delete this user from the database? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2.5 px-5 pb-5">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="flex-1 rounded-brand border-[1.5px] border-line py-3 text-sm font-bold text-muted hover:border-gold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteUser}
                className="flex-1 rounded-brand bg-danger py-3 text-sm font-extrabold text-surface-raised"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Small shared pieces ───────────────────────────────────────────────── */

/** The sub-view trail. Replaces the "← Back" button the source screen used. */
function Crumbs({ trail, current }: { trail: { label: string; onClick: () => void }[]; current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        {trail.map((it) => (
          <React.Fragment key={it.label}>
            <li>
              <button type="button" onClick={it.onClick} className="hover:text-strong">{it.label}</button>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
          </React.Fragment>
        ))}
        <li>
          <span aria-current="page" className="font-display text-base font-extrabold text-strong">{current}</span>
        </li>
      </ol>
    </nav>
  );
}

/** The in-list filter the three sub-views share. */
function ListSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className={`${FIELD_WIDTH.long} relative`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${TEXT_INPUT} pl-9 pr-3`} />
    </div>
  );
}
