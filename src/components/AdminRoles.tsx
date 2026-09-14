import React, { useState, useEffect, CSSProperties } from "react";
import { collection, query, getDocs, getDoc, doc, updateDoc, where } from "firebase/firestore";
import { db, auth } from "../firebase";
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import { getTenantScope, SUPER_ADMIN_EMAIL } from '../utils/tenant-scope';
import { AFFILIATE_PROGRAM_ENABLED } from '../utils/plan-features';
import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';
import {
  resolveAdminLimit, countAdminSeats, isAtAdminLimit, adminLimitMessage,
  wouldSpendNewSeat, UNLIMITED,
} from '../utils/admin-seats';
import { useTenant } from '@/contexts/TenantContext';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import {
  FileText, Rss, GraduationCap, BrainCircuit, Mail, StickyNote,
  Church, Users, MessageCircle, ClipboardList, Heart, Receipt, FileSpreadsheet,
  CalendarCheck, ClipboardCheck, QrCode, Radio, MessageSquare,
  BarChart3, Shield, Palette, Link2, Plug, Crown,
  Search, X, ChevronDown, User, AlertTriangle, type LucideIcon,
} from "lucide-react";
import { CONTROL_DENSITY } from './layout/form-layout';



const GOLD = "var(--brand-color, #C9963A)";
const GOLD_LIGHT = "color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent)";
const GOLD_BTN = "linear-gradient(135deg, var(--brand-color, #C9963A), color-mix(in srgb, var(--brand-color, #C9963A) 82%, #ffffff))";
// Brand-adaptive accents for the redesigned Add/Edit Admin sheet (white-label:
// every accent derives from the tenant's --brand-color).
const GOLD_SOFT = "color-mix(in srgb, var(--brand-color, #C9963A) 12%, var(--surface-raised))";
const GOLD_GLOW = "0 4px 14px color-mix(in srgb, var(--brand-color, #C9963A) 35%, transparent)";
const BG = "var(--surface)";
const CARD = "var(--surface-raised)";
/**
 * THE-181 — these were literal hexes, and this file styles itself with inline
 * `style` objects rather than classes, so nothing in the theming work could
 * reach them. Every one of them was pinned light in all four palettes:
 * `TEXT` (#111111) is the body colour of both this screen's tabs, so on the
 * dark ground it rendered near-black text on `--surface-raised` (#242424) —
 * 1.2:1, i.e. invisible — and `GREEN_BG`/`RED_BG`/`PURPLE_BG` were white-ish
 * pills on that same dark card.
 *
 * Each now names the token the rest of the app already uses for that role, so
 * all four palettes (Harvest light/dark, Classic light/dark) resolve from one
 * place. The `--ink-*` / `--c-*` tokens hold CHANNEL TRIPLETS ("R G B"), which
 * is why they are wrapped in `rgb(…)` here — Tailwind does that wrapping in the
 * config, and an inline style has to do it itself.
 */
const TEXT = "var(--text-strong)";
const TEXT2 = "var(--text-muted)";
const BORDER = "var(--border-default)";
const GREEN = "rgb(var(--ink-green-600))";
const GREEN_BG = "rgb(var(--c-green-100))";
const RED = "rgb(var(--ink-red-600))";
const RED_BG = "rgb(var(--c-red-100))";
const BLUE = "rgb(var(--ink-blue-600))";
/**
 * Violet is NOT part of this app's palette — the founder's report on the Roles
 * tab named it, and it is absent from the Harvest ramp, the Classic ramp and
 * the tenant accent alike. Every use of it on the Roles TAB is gone (the notice
 * banner, the SUPER badge, the reference crown). What remains is the Add/Edit
 * Admin sheet's "Full Access" row — a modal, outside this PR's three-tab
 * scope — so the constants stay, pointed at real tokens so that sheet at least
 * stops rendering a light violet card on the dark ground.
 */
const PURPLE = "rgb(var(--ink-purple-700))";
const PURPLE_BG = "rgb(var(--c-purple-100))";

const uid = (): string => Math.random().toString(36).slice(2, 9);

/**
 * The users-collection row, as the admin picker in the Add/Edit sheet reads it.
 *
 * THE-277 — one definition, imported rather than restated. The Signups screen
 * reads the same rows and exports them to CSV, so a field added or renamed in
 * one place cannot silently disagree with the other.
 */
import type { UserRecord } from '../lib/signups-export';
import { ANALYTICS_EVENTS } from '../lib/analytics/events';
import { trackProductEvent } from '../lib/analytics/client';

export interface Permission {
  analytics: boolean;
  analyticsLocations: string[];
  writeArticles: boolean;
  createPosts: boolean;
  postRegions: string[];
  uploadRag: boolean;
  modifyChurches: boolean;
  manageForms: boolean;
  createCourses: boolean;
  manageAdmins: boolean;
  // Expanded catalog (2024 roles redesign) — one flag per manageable section.
  manageNewsletter: boolean;
  manageDocs: boolean;
  manageCRM: boolean;
  manageCommunity: boolean;
  manageFundraising: boolean;
  manageAccounting: boolean;
  manageGivingStatements: boolean;
  manageEvents: boolean;
  manageCheckin: boolean;
  manageQR: boolean;
  manageLivestream: boolean;
  manageSms: boolean;
  manageBranding: boolean;
  manageAffiliate: boolean;
  manageSettings: boolean;
  fullAccess: boolean;
}

// Every catalog key is a boolean flag on Permission (the two array fields and the
// fullAccess master toggle are handled separately).
export type PermissionKey = Exclude<keyof Permission, "analyticsLocations" | "postRegions" | "fullAccess">;

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  picture: string;
  role: "super_admin" | "admin" | "user";
  permissions: Permission;
}

/* ------------------------------------------------------------------ */
/*  Permission catalog — the single source of truth the Add/Edit form, */
/*  the admin-card badges, and the reference list all read from. Keep   */
/*  every drawer gate in AdminDashboard in sync with these keys.        */
/* ------------------------------------------------------------------ */
interface PermissionItem { key: PermissionKey; label: string; desc: string; icon: LucideIcon; }
interface PermissionCategory { id: string; label: string; items: PermissionItem[]; }

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "content", label: "Content", items: [
      { key: "writeArticles", label: "Blog", desc: "Write, edit and publish blog articles", icon: FileText },
      { key: "createPosts", label: "Posts", desc: "Post updates, polls and events to the community feed", icon: Rss },
      { key: "createCourses", label: "Courses", desc: "Build and edit discipleship courses", icon: GraduationCap },
      { key: "uploadRag", label: "AI Knowledge", desc: "Add sources the AI chat can draw answers from", icon: BrainCircuit },
      { key: "manageNewsletter", label: "Newsletter", desc: "Write and send newsletter campaigns", icon: Mail },
      { key: "manageDocs", label: "Docs", desc: "Create and share internal notes and documents", icon: StickyNote },
    ],
  },
  {
    id: "ministry", label: "Ministry", items: [
      { key: "modifyChurches", label: "Church Directory", desc: "Approve, edit and remove church map listings", icon: Church },
      { key: "manageCRM", label: "CRM & Contacts", desc: "Manage the donor and member pipeline", icon: Users },
      { key: "manageCommunity", label: "Community Groups", desc: "Moderate community chat channels", icon: MessageCircle },
      { key: "manageForms", label: "Forms", desc: "Build forms and work submissions into the pipeline", icon: ClipboardList },
      { key: "manageFundraising", label: "Fundraising", desc: "Run campaigns and track pledges", icon: Heart },
      { key: "manageAccounting", label: "Accounting", desc: "Manage invoices and giving receipts", icon: Receipt },
      { key: "manageGivingStatements", label: "Giving Statements", desc: "Generate and send year-end tax statements", icon: FileSpreadsheet },
    ],
  },
  {
    id: "broadcasting", label: "Broadcasting", items: [
      { key: "manageEvents", label: "Events", desc: "Create events and manage registration, tickets and waitlists", icon: CalendarCheck },
      { key: "manageCheckin", label: "Check-In", desc: "Run attendance check-in sessions", icon: ClipboardCheck },
      { key: "manageQR", label: "QR Codes", desc: "Generate QR codes for giving, events, forms and check-in", icon: QrCode },
      { key: "manageLivestream", label: "Livestream", desc: "Go live and moderate live prayer requests", icon: Radio },
      { key: "manageSms", label: "SMS Broadcasts", desc: "Send SMS broadcasts and set up Text-to-Give", icon: MessageSquare },
    ],
  },
  {
    id: "admin", label: "Administration", items: [
      { key: "analytics", label: "Analytics", desc: "View registration analytics", icon: BarChart3 },
      { key: "manageAdmins", label: "Manage Admins", desc: "Create admins and edit their permissions", icon: Shield },
      { key: "manageBranding", label: "Branding", desc: "Change logo, colors, background and domain", icon: Palette },
      { key: "manageAffiliate", label: "Affiliate Program", desc: "View commission rates and referral payouts", icon: Link2 },
      // THE-245 — the description names the integrations this row unlocks, and
      // SMS is hidden, so the visible copy stops naming it. `desc` is display
      // copy only: the `manageSettings` key, and everything it grants, are
      // unchanged.
      { key: "manageSettings", label: "Settings & Integrations", desc: SMS_FEATURE_ENABLED ? "Configure SMS and third-party integrations" : "Configure third-party integrations", icon: Plug },
    ],
  },
];

export const ALL_PERMISSION_DEFS: PermissionItem[] = PERMISSION_CATEGORIES.flatMap((c) => c.items);

// ── What the UI actually SHOWS ───────────────────────────────────────────────
//
// While the affiliate programme is hidden, drop its permission row from every
// surface that renders one — the Add/Edit form, the per-admin badge list, the
// reference list, and the "N of M" counter that has to agree with them. Flip
// AFFILIATE_PROGRAM_ENABLED to bring the row back.
//
// DISPLAY ONLY. `PERMISSION_CATEGORIES` and `ALL_PERMISSION_DEFS` above stay
// complete on purpose: they are what `normalizePermissions` reads stored docs
// through and what `buildPermission` writes, so an admin who already holds
// `manageAffiliate` keeps it, Full Access still grants it, and nothing in
// Firestore is rewritten by hiding a row. Filtering the catalog itself would
// silently strip the flag off every doc that round-trips through this screen.
const HIDDEN_PERMISSION_KEYS = new Set<string>([
  ...(AFFILIATE_PROGRAM_ENABLED ? [] : ['manageAffiliate']),
  // THE-245 — the "SMS Broadcasts" row, while SMS is hidden. The same
  // DISPLAY-ONLY treatment for the same reason: an admin who already holds
  // `manageSms` keeps it, Full Access still grants it, nothing in Firestore is
  // rewritten, and the row returns with the switch.
  ...(SMS_FEATURE_ENABLED ? [] : ['manageSms']),
]);
export const VISIBLE_PERMISSION_CATEGORIES: PermissionCategory[] = PERMISSION_CATEGORIES
  .map((c) => ({ ...c, items: c.items.filter((i) => !HIDDEN_PERMISSION_KEYS.has(i.key)) }))
  .filter((c) => c.items.length > 0);
export const VISIBLE_PERMISSION_DEFS: PermissionItem[] = VISIBLE_PERMISSION_CATEGORIES.flatMap((c) => c.items);

// Build a Permission with every catalog flag set to `value` (and fullAccess set
// explicitly). Built as a plain record and cast once, so adding a catalog key
// never means editing a hand-written literal here.
const buildPermission = (value: boolean, fullAccess: boolean): Permission => {
  const p: Record<string, unknown> = { analyticsLocations: [], postRegions: [], fullAccess };
  ALL_PERMISSION_DEFS.forEach((d) => { p[d.key] = value; });
  return p as unknown as Permission;
};

const emptyPermission = (): Permission => buildPermission(false, false);
// "Grant everything" preset for the Full Access toggle — every catalog flag on.
const allPermissionsTrue = (): Permission => buildPermission(true, true);

// Normalise stored permissions on read so old admin docs keep working:
//  - legacy `seeFormsInbox: true` counts as `manageForms: true` (Forms migration)
//  - any missing new flags default to false, arrays default to []
// Defensive against undefined / non-object values (old or partial docs).
export const normalizePermissions = (raw: unknown): Permission => {
  const out: Record<string, unknown> = { analyticsLocations: [], postRegions: [], fullAccess: false };
  ALL_PERMISSION_DEFS.forEach((d) => { out[d.key] = false; });
  if (raw && typeof raw === "object") {
    const src = raw as Record<string, unknown>;
    ALL_PERMISSION_DEFS.forEach((d) => {
      if (typeof src[d.key] === "boolean") out[d.key] = src[d.key];
    });
    if (typeof src.fullAccess === "boolean") out.fullAccess = src.fullAccess;
    // Legacy Forms permission → manageForms (don't downgrade an already-set flag).
    if (src.seeFormsInbox === true) out.manageForms = true;
    if (Array.isArray(src.analyticsLocations)) out.analyticsLocations = src.analyticsLocations;
    if (Array.isArray(src.postRegions)) out.postRegions = src.postRegions;
  }
  return out as unknown as Permission;
};

function Toggle({ on, color }: { on: boolean; color: string }) {
  return (
    <div style={{ width: 42, height: 24, borderRadius: 99, background: on ? color : BORDER, position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
      <div style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "var(--surface-raised)", boxShadow: "0 1px 4px rgba(0,0,0,0.25)", transition: "left 0.2s" }} />
    </div>
  );
}

interface PermissionEditorProps {
  admin: AdminUser | null;
  isNew: boolean;
  onSave: (admin: AdminUser) => void;
  onClose: () => void;
  allUsers: UserRecord[];
}

function PermissionEditor({ admin, isNew, onSave, onClose, allUsers }: PermissionEditorProps) {
  const [form, setForm] = useState<AdminUser>(
    admin || {
      id: "", name: "", email: "", picture: "", role: "admin",
      permissions: emptyPermission(),
    }
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
  const [permSearch, setPermSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isNew && searchQuery.trim().length > 1) {
      const lower = searchQuery.toLowerCase();
      setSearchResults(allUsers.filter(u => 
        u.name.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower)
      ));
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, isNew, allUsers]);

  const selectUser = (user: UserRecord) => {
    setForm(f => ({
      ...f,
      id: user.id,
      name: user.name,
      email: user.email,
    }));
    setSearchQuery("");
    setSearchResults([]);
  };

  const setPerm = <K extends keyof Permission>(k: K, v: Permission[K]): void =>
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [k]: v } }));

  // Full Access is the master toggle: on → grant the whole catalog; off → just
  // clear fullAccess and keep whatever individual flags were set.
  const toggleFullAccess = (val: boolean): void =>
    setForm((f) => ({ ...f, permissions: val ? allPermissionsTrue() : { ...f.permissions, fullAccess: false } }));

  const toggleCategory = (id: string): void =>
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const enabledCount = VISIBLE_PERMISSION_DEFS.filter((d) => form.permissions[d.key]).length;
  const totalCount = VISIBLE_PERMISSION_DEFS.length;
  const q = permSearch.trim().toLowerCase();
  const matchesQuery = (item: PermissionItem): boolean =>
    !q || item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q);
  const noMatches = q.length > 0 && VISIBLE_PERMISSION_CATEGORIES.every((cat) => cat.items.filter(matchesQuery).length === 0);
  const initial = (form.name || form.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,17,17,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: CARD, borderRadius: "22px 22px 0 0", width: "100%", maxWidth: 480, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -12px 40px rgba(0,0,0,0.25)" }}>
        {/* Fixed drag handle + header */}
        <div style={{ padding: "10px 0 0", display: "flex", justifyContent: "center", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: BORDER, borderRadius: 99 }} />
        </div>
        <div style={{ padding: "14px 20px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: TEXT }}>{isNew ? "Add Admin" : form.name}</div>
            <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 2 }}>{isNew ? "Choose what this person can see and manage." : form.email}</div>
          </div>
          <button onClick={onClose} style={s.closeBtn} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Scrolling body — this is what makes every permission (and the footer)
            reachable on a phone-height screen: overflowY auto + flex 1 + minHeight 0
            inside the maxHeight:92vh sheet. */}
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
          {isNew && !form.id && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "relative", flexShrink: 0 }}>
              <label style={s.label}>Search User</label>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: TEXT2, pointerEvents: "none" }} />
                <input style={{ ...s.input, paddingLeft: 36 }} placeholder="Search by name or email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              {searchResults.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, maxHeight: 220, overflowY: "auto", zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)" }}>
                  {searchResults.map((u) => (
                    <div key={u.id} onClick={() => selectUser(u)} style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}`, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={s.avatarInitial}>{u.name.charAt(0).toUpperCase()}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>{u.name}</div>
                        <div style={{ fontSize: 12, color: TEXT2 }}>{u.email}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {form.id && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface)", border: `1.5px solid ${BORDER}`, borderRadius: 14, flexShrink: 0 }}>
              <div style={s.avatarInitial}>{initial}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{form.name}</div>
                <div style={{ fontSize: 12.5, color: TEXT2 }}>{form.email}</div>
              </div>
              {isNew && <button onClick={() => setForm((f) => ({ ...f, id: "", name: "", email: "" }))} style={{ fontSize: 12, color: BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>Change</button>}
            </div>
          )}

          {/* Full Access master toggle */}
          <div onClick={() => toggleFullAccess(!form.permissions.fullAccess)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderRadius: 16, cursor: "pointer", transition: "all 0.2s",
              border: `1.5px solid ${form.permissions.fullAccess ? PURPLE : BORDER}`,
              background: form.permissions.fullAccess ? "linear-gradient(135deg, #F5F3FF, #EDE9FE)" : BG,
              boxShadow: form.permissions.fullAccess ? "0 6px 20px rgba(124,58,237,0.18)" : "none",
              flexShrink: 0,
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: form.permissions.fullAccess ? PURPLE : "#fff", color: form.permissions.fullAccess ? "#fff" : TEXT2, border: form.permissions.fullAccess ? "none" : `1.5px solid ${BORDER}` }}>
                <Crown size={19} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14.5, color: form.permissions.fullAccess ? PURPLE : TEXT }}>Full Access</div>
                <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>Unlocks every section below — current and future</div>
              </div>
            </div>
            <Toggle on={form.permissions.fullAccess} color={PURPLE} />
          </div>

          {!form.permissions.fullAccess && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={s.label}>Permissions</label>
                  <span style={{ fontSize: 11.5, color: TEXT2, fontWeight: 700 }}>{enabledCount} of {totalCount} enabled</span>
                </div>
                <div style={{ height: 5, borderRadius: 99, background: BORDER, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${totalCount ? (enabledCount / totalCount) * 100 : 0}%`, background: GOLD, borderRadius: 99, transition: "width 0.2s" }} />
                </div>
                <div style={{ position: "relative", marginTop: 4 }}>
                  <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: TEXT2, pointerEvents: "none" }} />
                  <input style={{ ...s.input, paddingLeft: 34, paddingRight: permSearch ? 32 : 13, fontSize: 13 }} placeholder="Search permissions..." value={permSearch} onChange={(e) => setPermSearch(e.target.value)} />
                  {permSearch && (
                    <button onClick={() => setPermSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: TEXT2, cursor: "pointer", display: "flex", padding: 2 }} aria-label="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {VISIBLE_PERMISSION_CATEGORIES.map((cat) => {
                const matched = cat.items.filter(matchesQuery);
                if (matched.length === 0) return null;
                const catEnabled = cat.items.filter((i) => form.permissions[i.key]).length;
                const expanded = q ? true : !collapsedCategories.has(cat.id);
                return (
                  <div key={cat.id} style={{ ...s.card, flexShrink: 0 }}>
                    <div onClick={() => toggleCategory(cat.id)}
                      style={{ ...s.sectionHeading, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: expanded ? `1px solid ${BORDER}` : "none" }}>
                      <span>{cat.label}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: catEnabled > 0 ? GOLD : TEXT2, background: catEnabled > 0 ? GOLD_SOFT : "#F2F2F2", borderRadius: 99, padding: "2px 8px", textTransform: "none", letterSpacing: "normal" }}>
                          {catEnabled}/{cat.items.length}
                        </span>
                        <ChevronDown size={14} style={{ color: TEXT2, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                      </span>
                    </div>
                    {expanded && (
                      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        {matched.map((item) => {
                          const val = form.permissions[item.key];
                          const Icon = item.icon;
                          return (
                            <div key={item.key} onClick={() => setPerm(item.key, !val)}
                              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 12, border: `1.5px solid ${val ? GOLD : BORDER}`, background: val ? GOLD_SOFT : CARD, cursor: "pointer", transition: "background 0.15s, border-color 0.15s" }}>
                              <div style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: val ? "#fff" : "#F5F5F5", color: val ? GOLD : TEXT2 }}>
                                <Icon size={15} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: val ? GOLD : TEXT }}>{item.label}</div>
                                <div style={{ fontSize: 11, color: TEXT2, marginTop: 1 }}>{item.desc}</div>
                              </div>
                              <Toggle on={val} color={GOLD} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {noMatches && (
                <div style={{ textAlign: "center", padding: "24px 12px", color: TEXT2 }}>
                  <div style={{ fontSize: 13 }}>No permissions match &ldquo;{permSearch}&rdquo;.</div>
                  <button onClick={() => setPermSearch("")} style={{ marginTop: 8, fontSize: 12.5, color: BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Clear search</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Fixed footer — Cancel / Save always visible above the fold */}
        <div style={{ display: "flex", gap: 10, padding: "14px 20px", borderTop: `1px solid ${BORDER}`, background: CARD, flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14 }}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={!form.id}
            style={{ flex: 2, background: GOLD_BTN, border: "none", color: "var(--surface-raised)", fontWeight: 800, padding: "12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 14, boxShadow: GOLD_GLOW, opacity: form.id ? 1 : 0.5 }}>
            {isNew ? "Add Admin" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminRoles({ currentUserRole, currentUserPermissions, mode = "roles" }: { currentUserRole: string, currentUserPermissions?: Permission | null, mode?: "full" | "roles" }) {
  
  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  // tenants/{id}.ownerId — the buyer. Their card gets an Owner badge instead of
  // Edit/Remove (firestore.rules is the real guard; this avoids a dead-end UI).
  const [tenantOwnerId, setTenantOwnerId] = useState<string | null>(null);

  // maxAdmins — CLIENT-SIDE ONLY, and it blocks NEW promotions only. A tenant
  // already over its cap keeps every admin it has; see src/utils/admin-seats.ts
  // for the seat rule (super admins excluded, permissionless admins and the plan
  // owner counted) and for where a real server-side gate would live.
  //
  // No new query: `admins` is already derived from the users read below, so the
  // count is free and cannot miss an index.
  const { tenantPlan } = useTenant();
  const maxAdmins = resolveAdminLimit(tenantPlan);
  const adminSeatsUsed = countAdminSeats(admins);
  const atAdminLimit = isAtAdminLimit(adminSeatsUsed, maxAdmins);
  const adminLimitNotice = adminLimitMessage(maxAdmins);

  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [isNewAdmin, setIsNewAdmin] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const tenantId = await getTenantScope();
        if (tenantId) {
          try {
            const tenantDoc = await getDoc(doc(db, "tenants", tenantId));
            setTenantOwnerId(tenantDoc.data()?.ownerId || null);
          } catch (ownerErr) {
            // Badge-only degradation: without ownerId the owner card shows the usual
            // buttons, but firestore.rules still rejects any role/permissions change.
            console.error("Failed to load tenant ownerId:", ownerErr);
          }
        }
        const q = tenantId
          ? query(collection(db, "users"), where("tenantId", "==", tenantId))
          : query(collection(db, "users"));
        const usersSnap = await getDocs(q);
        const usersList: UserRecord[] = [];
        const adminsList: AdminUser[] = [];
        
        usersSnap.forEach(docSnap => {
          const data = docSnap.data();
          const user: UserRecord = {
            id: docSnap.id,
            name: data.displayName || data.name || "Unknown",
            email: data.email || "",
            city: data.city || "",
            country: data.country || "",
            phone: data.phone || "",
            acceptedJesus: data.acceptedJesus,
            registeredAt: data.createdAt || new Date().toISOString(),
            onboardingAnswers: data.onboardingAnswers || {}
          };
          usersList.push(user);

          if (data.role === "admin" || data.role === "super_admin" || data.email === SUPER_ADMIN_EMAIL) {
            adminsList.push({
              id: docSnap.id,
              name: user.name,
              email: user.email,
              picture: data.photoURL || "",
              role: data.email === SUPER_ADMIN_EMAIL ? "super_admin" : data.role,
              permissions: normalizePermissions(data.permissions),
            });
          }
        });
        
        setAllUsers(usersList);
        setAdmins(adminsList);
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, `users`); } catch (e) { console.error(e); }
      }
    };
    fetchUsers();
  }, []);

  const handleSaveAdmin = async (admin: AdminUser): Promise<void> => {
    if (!admin.id) {
      notifyError('Select a user before adding them as an admin', 'No user selected');
      return;
    }
    // Backstop for the disabled "Add Admin" button — a save is refused only when
    // it would spend a NEW seat. Editing an existing admin (including one an
    // over-cap tenant already has) always goes through, so enforcing the cap can
    // never strand a tenant with admins they cannot manage, and never demotes.
    if (atAdminLimit && wouldSpendNewSeat(admins, admin.id)) {
      notifyError(adminLimitNotice, 'Admin limit reached');
      // THE-360 - a refusal: this line is reached only because a promotion was
      // blocked by the seat cap.
      trackProductEvent(ANALYTICS_EVENTS.PLAN_LIMIT_REACHED, { limitKind: 'admin_seats' });
      return;
    }
    try {
      const userRef = doc(db, "users", admin.id);
      await updateDoc(userRef, {
        role: admin.role,
        permissions: admin.permissions,
      });

      // Update custom claims for Firestore security rules
      try {
        const { auth: firebaseAuth } = await import('../firebase');
        const token = await firebaseAuth.currentUser?.getIdToken();
        if (token) {
          await fetch('/api/auth/set-claims', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: admin.id }),
          });
        }
      } catch (claimsErr) {
        console.error('Failed to update custom claims:', claimsErr);
      }

      if (isNewAdmin) {
        setAdmins((prev) => [...prev, admin]);
      } else {
        setAdmins((prev) => prev.map((a) => a.id === admin.id ? admin : a));
      }
      setShowEditor(false);
      setEditingAdmin(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${admin.id}`);
      notifyError('Failed to save admin', error);
    }
  };

  const handleRemoveAdmin = async (id: string): Promise<void> => {
    try {
      const userRef = doc(db, "users", id);
      await updateDoc(userRef, {
        role: "user",
        permissions: emptyPermission(),
      });

      // Update custom claims (remove admin flag)
      try {
        const { auth: firebaseAuth } = await import('../firebase');
        const token = await firebaseAuth.currentUser?.getIdToken();
        if (token) {
          await fetch('/api/auth/set-claims', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: id }),
          });
        }
      } catch (claimsErr) {
        console.error('Failed to update custom claims:', claimsErr);
      }

      setAdmins((prev) => prev.filter((a) => a.id !== id));
      setShowRemoveConfirm(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.UPDATE, `users/${id}`); } catch (e) { console.error(e); }
    }
  };

  // Don't open the form at all at the cap: filling it in and failing on save is
  // the shape this gate exists to avoid. Editing an existing admin is untouched.
  const openNewAdmin = (): void => {
    if (atAdminLimit) return;
    setEditingAdmin(null); setIsNewAdmin(true); setShowEditor(true);
  };
  const openEditAdmin = (admin: AdminUser): void => { setEditingAdmin(admin); setIsNewAdmin(false); setShowEditor(true); };

  const { setHeaderAction } = useAdminHeader();

  useEffect(() => {
    if (mode !== "roles") { setHeaderAction(null); return; }
    setHeaderAction(
      <HeaderActionButton
        label="Add Admin"
        onClick={openNewAdmin}
        disabled={atAdminLimit}
        title={atAdminLimit ? adminLimitNotice : undefined}
      />
    );
    return () => setHeaderAction(null);
    // atAdminLimit/adminLimitNotice are deps: the header action is a rendered
    // node handed to a context, so it does not re-render itself when the seat
    // count changes — the effect has to re-publish it.
  }, [setHeaderAction, mode, atAdminLimit, adminLimitNotice]);

  return (
    <div style={pageStyle} data-admin-roles="">
      {/* 🔴 THE-338 — EVERY RULE HERE IS SCOPED TO `[data-admin-roles]`, and
          that scoping is a BUG FIX, not tidying.

          This block used to open with an unscoped `* { box-sizing: border-box;
          margin: 0; padding: 0; }`. A <style> element paints the whole
          DOCUMENT wherever it is mounted in the tree, so while the Roles
          sub-view was open that rule zeroed the margin and padding of every
          element on the page — including AdminCRM's Contacts/Roles switcher,
          which is rendered as a SIBLING above this component, not inside it.

          That is the founder's report, "in CRM if I press on roles the button
          switch appears very small": the pill pair's own `p-1` container
          padding, each pill's `px-4 py-1.5`, and the bar's `mb-5` were all
          reset to 0, so the control collapsed to bare text at the top-left
          with nothing separating it from the header. The switcher's markup is
          IDENTICAL on both tabs — one `subTabBar` element, rendered from one
          variable — so nothing in AdminCRM.tsx could have explained it.

          The other five rules leaked just as far: `button:disabled` dimmed
          every disabled button in the app, and `input, select { outline:
          none }` removed the focus outline from every field on the page, for
          as long as this screen was mounted. Scoping fixes all six together.

          The `*` reset is DELETED rather than scoped, which is the fix
          `admin-injected-css-isolation.test.ts` prescribes and the one
          AdminRAG.tsx and AdminCourseEditor.tsx already took for the same
          defect: Tailwind's preflight already sets `box-sizing: border-box`
          on everything and zeroes margin and padding on the form elements and
          lists this tree actually uses, so nothing here depended on it.

          `@keyframes` stays unscoped because a keyframe name is global by
          definition and cannot be scoped to a subtree. */}
      <style>{`
        [data-admin-roles] input::placeholder { color: #BBB; }
        [data-admin-roles] input, [data-admin-roles] select { outline: none; }
        [data-admin-roles] ::-webkit-scrollbar { width: 5px; }
        [data-admin-roles] ::-webkit-scrollbar-thumb { background: #DDD; border-radius: 4px; }
        [data-admin-roles] button:disabled { opacity: 0.5; cursor: not-allowed; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {showEditor && (
        <PermissionEditor
          admin={editingAdmin}
          isNew={isNewAdmin}
          onSave={handleSaveAdmin}
          onClose={() => { setShowEditor(false); setEditingAdmin(null); }}
          allUsers={allUsers}
        />
      )}

      {showRemoveConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 99, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: CARD, borderRadius: 20, width: "100%", maxWidth: 360, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, color: RED }}><AlertTriangle size={36} /></div>
            <div style={{ fontWeight: 800, fontSize: 17, color: TEXT, marginBottom: 8, fontFamily: "var(--font-display), Georgia, serif" }}>Remove Admin?</div>
            <div style={{ fontSize: 14, color: TEXT2, lineHeight: 1.6, marginBottom: 24 }}>
              This will revoke all their permissions. They will no longer have admin access.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowRemoveConfirm(null)} style={{ flex: 1, background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "11px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Cancel</button>
              <button onClick={() => handleRemoveAdmin(showRemoveConfirm)} style={{ flex: 1, background: `linear-gradient(135deg, ${RED}, #F87171)`, border: "none", color: "var(--surface-raised)", padding: "11px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 800 }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {/* No container here: AdminCRM wraps this component, and the sub-tab bar
              above it, in the page measure already. A second one would be a
              second definition of the same number. */}
          <div className="w-full" style={{ padding: "20px 16px 60px" }}>

          {(currentUserRole === "super_admin" || currentUserPermissions?.manageAdmins || currentUserPermissions?.fullAccess) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* THE-181 — this banner was #F5F3FF/#7C3AED. Nothing else in the app
                  is violet: it is not in the Harvest ramp, not in Classic, and not
                  in the tenant accent, so it read as a foreign component and stayed
                  the same two hexes in all four palettes — a light violet card on
                  the dark ground. It is ordinary guidance, so it takes the ordinary
                  notice tokens, which resolve in every palette. The emoji goes for
                  the same reason as the tiles': a glyph takes no colour. */}
              <div data-admin-notice="" style={{ background: "var(--surface-sunken)", border: `1px solid ${BORDER}`, borderRadius: 14, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ color: GOLD, flexShrink: 0, display: "flex", marginTop: 1 }}><Crown size={16} /></div>
                <div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--text-strong)" }}>Admin Management.</strong> You can promote users and configure their permissions. Sections a limited admin has no access to are hidden from their dashboard entirely.
                </div>
              </div>

              {/* Seat usage. Super admins are listed below but never counted —
                  they are platform staff, not a seat the church bought.

                  THE-181 — this was 18px of bare uppercase text. It is the plan
                  cap: `maxAdmins` is 2 / 5 / 15 by plan and is raised by the $10
                  Admin Seat add-on, so it is the one line on this screen where an
                  admin learns their limit exists. It is now a labelled figure with
                  a seat meter, sized like the roster it heads.

                  Deliberately NOT a purchase flow, and deliberately no price here:
                  this states what is true (seats used, seats bought) and stops.
                  The at-cap notice below already carries `adminLimitMessage`, which
                  is where the upgrade is named — repeating it on every visit would
                  make a status line into an advertisement. */}
              <div data-admin-seats="" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEXT2, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                  Admin seats
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>
                  {maxAdmins === UNLIMITED
                    ? `${adminSeatsUsed} admin${adminSeatsUsed === 1 ? "" : "s"}`
                    : `${adminSeatsUsed} of ${maxAdmins} admin${maxAdmins === 1 ? "" : "s"} used`}
                </div>
                {maxAdmins !== UNLIMITED && (
                  <div aria-hidden="true" style={{ display: "flex", gap: 4 }}>
                    {Array.from({ length: Math.max(maxAdmins, adminSeatsUsed) }).map((_, i) => (
                      <span key={i} style={{ width: 18, height: 4, borderRadius: 99, background: i < adminSeatsUsed ? GOLD : BORDER }} />
                    ))}
                  </div>
                )}
              </div>

              {atAdminLimit && (
                <div style={{ background: GOLD_SOFT, border: `1.5px solid color-mix(in srgb, var(--brand-color, #C9963A) 22%, transparent)`, borderRadius: 14, padding: "12px 16px", fontSize: 13, color: "var(--text-body)", lineHeight: 1.6 }}>
                  {adminLimitNotice} Everyone listed below keeps their access.
                </div>
              )}

              {/* ── The roster ───────────────────────────────────────────────
                  A stack of cards on a phone (unchanged), a TABLE from `sm:` up.

                  The founder's report is right that a roster is tabular: every
                  row carries the same four facts, and a card stack makes the
                  reader re-find each one per admin. This file already renders
                  its user lists this way — `renderAllUsers` uses exactly this
                  `s.card` + `s.th`/`s.td` idiom — so the table is the screen's
                  own pattern, not a new one.

                  Nothing about behaviour moves: both presentations are built
                  from the SAME derived row, and Edit / Remove / the Owner lock
                  call the same handlers with the same arguments. There is no
                  inline editing and no permission toggle on this screen to
                  break — permissions are edited in the Add/Edit Admin sheet,
                  which `openEditAdmin` still opens unchanged. */}
              {(() => {
                const rows = admins.map((admin) => {
                  const isSuperAdmin = admin.role === "super_admin";
                  // Platform super admins are the one party the owner-protection rule
                  // still lets edit the owner, so they keep the Edit/Remove buttons.
                  const isOwner = !!tenantOwnerId && admin.id === tenantOwnerId && currentUserRole !== "super_admin";
                  const perms = admin.permissions;
                  const activePerms = isSuperAdmin || perms.fullAccess
                    ? ["Full Access"]
                    : VISIBLE_PERMISSION_DEFS.filter((d) => perms[d.key]).map((d) => d.label);
                  const visiblePerms = activePerms.slice(0, 4);
                  return { admin, isSuperAdmin, isOwner, perms, activePerms, visiblePerms, extraCount: activePerms.length - visiblePerms.length };
                });

                const avatar = (admin: AdminUser, size: number) => (admin.picture
                  ? <img src={admin.picture} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: `2px solid ${GOLD_LIGHT}`, flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : <div style={{ width: size, height: size, borderRadius: "50%", background: GOLD_LIGHT, color: GOLD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={Math.round(size * 0.45)} /></div>
                );

                const rankBadge = (r: typeof rows[number]) => (<>
                  {r.isSuperAdmin && <span style={{ fontSize: 10, fontWeight: 800, color: GOLD, background: GOLD_SOFT, borderRadius: 99, padding: "2px 7px" }}>SUPER</span>}
                  {!r.isSuperAdmin && r.perms.fullAccess && <span style={{ fontSize: 10, fontWeight: 800, color: GREEN, background: GREEN_BG, borderRadius: 99, padding: "2px 7px" }}>FULL</span>}
                </>);

                const permPills = (r: typeof rows[number]) => (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {r.visiblePerms.map((p) => (
                      <span key={p} style={{ fontSize: 10, fontWeight: 700, background: GOLD_LIGHT, color: GOLD, borderRadius: 99, padding: "2px 8px" }}>{p}</span>
                    ))}
                    {r.extraCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: "var(--surface-chip)", color: TEXT2, borderRadius: 99, padding: "2px 8px" }}>+{r.extraCount} more</span>}
                    {r.activePerms.length === 0 && <span style={{ fontSize: 11, color: TEXT2, fontStyle: "italic" }}>No permissions assigned</span>}
                  </div>
                );

                const ownerBadge = (
                  <div title="The plan owner's admin access is locked and cannot be edited or removed."
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: GOLD_LIGHT, color: GOLD, borderRadius: 99, padding: "5px 12px", fontSize: 12, fontWeight: 800, flexShrink: 0, whiteSpace: "nowrap" }}>
                    <Crown size={13} /> Owner
                  </div>
                );
                const editBtn = (admin: AdminUser) => (
                  <button onClick={() => openEditAdmin(admin)}
                    style={{ background: GOLD_LIGHT, border: `1px solid color-mix(in srgb, var(--brand-color) 20%, transparent)`, color: GOLD, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>
                    Edit
                  </button>
                );
                const removeBtn = (id: string) => (
                  <button onClick={() => setShowRemoveConfirm(id)}
                    style={{ background: RED_BG, border: `1px solid ${RED}`, color: RED, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>
                    Remove
                  </button>
                );

                return (
                  <div data-admin-roster="">
                    {/* Phone AND narrow tablet: the card stack, exactly as it was.
                        The switch is at `md:` and not `sm:` because that is where
                        the table actually fits. Measured in Chromium: the four
                        columns have an intrinsic minimum of 632px, and at 640px
                        the card offers 565px — the table clipped by 67px and had
                        to be scrolled sideways inside its own card. 768px offers
                        693px, which is the first breakpoint that clears it. `md:`
                        is further from the phone than `sm:`, never nearer, so the
                        sub-640px constraint is kept a fortiori. */}
                    <div className="flex flex-col md:hidden" style={{ gap: 16 }}>
                      {rows.map((r) => (
                        <div key={r.admin.id} style={s.card}>
                          <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                            {avatar(r.admin, 44)}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{r.admin.name}</span>
                                {rankBadge(r)}
                              </div>
                              <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>{r.admin.email}</div>
                              <div style={{ marginTop: 8 }}>{permPills(r)}</div>
                            </div>
                            {!r.isSuperAdmin && (r.isOwner ? ownerBadge : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                                {editBtn(r.admin)}
                                {removeBtn(r.admin.id)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop: one row per admin, one column per fact. */}
                    <div className="hidden md:block" style={{ ...s.card, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${BORDER}`, background: "var(--surface)" }}>
                            <th style={s.th}>Admin</th>
                            <th style={s.th}>Email</th>
                            <th style={s.th}>Permissions</th>
                            <th style={{ ...s.th, textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.admin.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                              <td style={s.td}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  {avatar(r.admin, 34)}
                                  <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{r.admin.name}</span>
                                  {rankBadge(r)}
                                </div>
                              </td>
                              <td style={{ ...s.td, color: TEXT2, fontSize: 13 }}>{r.admin.email}</td>
                              <td style={s.td}>{permPills(r)}</td>
                              <td style={{ ...s.td, textAlign: "right" }}>
                                {!r.isSuperAdmin && (r.isOwner ? ownerBadge : (
                                  <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                                    {editBtn(r.admin)}
                                    {removeBtn(r.admin.id)}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* ── Permission Reference ─────────────────────────────────────
                  Reference material, laid into COLUMNS from `sm:` up.

                  It was one 24-item column: 1525px tall inside a 900px viewport,
                  so two thirds of it sat past the fold on the screen where an
                  admin is deciding what to grant. Of the three options —

                    · a disclosure, which hides it. Wrong for a table an admin
                      consults WHILE editing permissions in the sheet beside it;
                      it would turn one glance into open/read/close per lookup.
                    · beside the roster, which puts two blocks with different
                      growth axes in one row. The roster grows a row per admin
                      and the reference is fixed at 24 items, so one of the two
                      is always the wrong height for the other.
                    · columns, which keep every item visible and cut the height.

                  — columns is the only one that keeps the whole thing scannable,
                  which is what reference material is FOR.

                  Two columns, not three: there are exactly four categories, so a
                  third column leaves a hole, and it would have to be gated at
                  `xl:` — the column split at 1280px that THE-184 is about, taken
                  on for no gain. The CATEGORY blocks are the grid cells, so the
                  phone keeps its single flex column and its 14px/10px gaps
                  untouched. Grid gaps come from Rule 4. */}
              <div data-permission-reference="" style={{ ...s.card, marginTop: 4 }}>
                <div style={s.sectionHeading}>Permission Reference</div>
                <div
                  className={`flex flex-col gap-[14px] sm:grid sm:grid-cols-2 ${CONTROL_DENSITY.rowGap} ${CONTROL_DENSITY.columnGap}`}
                  style={{ padding: "14px 16px" }}
                >
                  <div className="sm:col-span-full" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: GOLD_SOFT, color: GOLD }}><Crown size={14} /></div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>Full Access</div>
                      <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>Every permission below, current and future</div>
                    </div>
                  </div>
                  {VISIBLE_PERMISSION_CATEGORIES.map((cat) => (
                    <div key={cat.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: TEXT2, letterSpacing: "0.08em", textTransform: "uppercase" }}>{cat.label}</div>
                      {cat.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <div style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "var(--surface-chip)", color: TEXT2 }}><Icon size={14} /></div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>{item.label}</div>
                              <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>{item.desc}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  background: BG,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const s: Record<string, CSSProperties> = {
  tabBar: { display: "flex", borderBottom: `1px solid ${BORDER}`, flexShrink: 0, background: CARD },
  tab: { flex: 1, background: "none", border: "none", borderBottom: "2.5px solid transparent", color: TEXT2, fontWeight: 700, fontSize: 14, padding: "12px 8px", cursor: "pointer", fontFamily: "inherit", transition: "color 0.2s" },
  tabActive: { color: GOLD, borderBottom: `2.5px solid ${GOLD}` },
  card: { background: CARD, borderRadius: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", overflow: "hidden" },
  cardBody: { padding: "16px", display: "flex", flexDirection: "column", gap: 14 },
  sectionHeading: { padding: "11px 16px", fontSize: 11, fontWeight: 700, color: TEXT2, letterSpacing: "0.1em", textTransform: "uppercase" as const, borderBottom: `1px solid ${BORDER}` },
  label: { fontSize: 12, fontWeight: 700, color: TEXT2, letterSpacing: "0.04em", textTransform: "uppercase" as const, display: "block" },
  input: { background: "var(--surface)", border: `1.5px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: "10px 13px", fontSize: 14, width: "100%", fontFamily: "inherit" },
  newBtn: { background: GOLD_BTN, border: "none", color: "var(--surface-raised)", fontWeight: 700, padding: "13px", borderRadius: 12, cursor: "pointer", fontSize: 14, width: "100%", fontFamily: "inherit", boxShadow: "0 2px 8px color-mix(in srgb, var(--brand-color, #C9963A) 30%, transparent)" },
  backBtn: { background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13 },
  th: { padding: "12px 16px", fontSize: 12, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.05em" },
  td: { padding: "12px 16px", fontSize: 14, color: TEXT },
  closeBtn: { width: 30, height: 30, borderRadius: "50%", background: "var(--surface)", border: "none", color: TEXT2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarInitial: { width: 34, height: 34, borderRadius: "50%", background: GOLD_SOFT, color: GOLD, fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
};