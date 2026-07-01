import React, { useState, useEffect, CSSProperties } from "react";
import { collection, query, getDocs, getDoc, doc, updateDoc, where, deleteDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import { getTenantScope, SUPER_ADMIN_EMAIL } from '../utils/tenant-scope';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import {
  FileText, Rss, GraduationCap, BrainCircuit, Mail, StickyNote,
  Church, Users, MessageCircle, ClipboardList, Heart, Receipt, FileSpreadsheet,
  CalendarCheck, ClipboardCheck, QrCode, Radio, MessageSquare,
  BarChart3, Shield, Palette, Link2, Plug, Crown,
  Search, X, ChevronDown, type LucideIcon,
} from "lucide-react";



const GOLD = "var(--brand-color, #C9963A)";
const GOLD_LIGHT = "#FBF3E4";
const GOLD_BTN = "linear-gradient(135deg, #C9963A, #D4A843)";
// Brand-adaptive accents for the redesigned Add/Edit Admin sheet (white-label:
// every accent derives from the tenant's --brand-color).
const GOLD_SOFT = "color-mix(in srgb, var(--brand-color, #C9963A) 12%, white)";
const GOLD_GLOW = "0 4px 14px color-mix(in srgb, var(--brand-color, #C9963A) 35%, transparent)";
const BG = "#F2F4F7";
const CARD = "#FFFFFF";
const TEXT = "#111111";
const TEXT2 = "#888888";
const BORDER = "#E8E8E8";
const GREEN = "#16A34A";
const GREEN_BG = "#F0FDF4";
const RED = "#E74C3C";
const RED_BG = "#FEF2F2";
const BLUE = "#2563EB";
const BLUE_BG = "#EFF6FF";
const PURPLE = "#7C3AED";
const PURPLE_BG = "#F5F3FF";

const uid = (): string => Math.random().toString(36).slice(2, 9);

type MainTab = "analytics" | "roles";
type TimePeriod = 1 | 3 | 7 | 30;

interface UserRecord {
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
      { key: "manageSettings", label: "Settings & Integrations", desc: "Configure SMS, AI Assistant and third-party integrations", icon: Plug },
    ],
  },
];

export const ALL_PERMISSION_DEFS: PermissionItem[] = PERMISSION_CATEGORIES.flatMap((c) => c.items);

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

const filterByPeriod = (users: UserRecord[], days: TimePeriod): UserRecord[] => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return users.filter((u) => new Date(u.registeredAt) >= cutoff);
};

const filterByLocation = (users: UserRecord[], q: string): UserRecord[] => {
  if (!q.trim()) return users;
  const lower = q.toLowerCase();
  return users.filter((u) =>
    (u.city && u.city.toLowerCase().includes(lower)) || (u.country && u.country.toLowerCase().includes(lower))
  );
};

const escapeCsvValue = (val: string): string => {
  // Prefix formula chars to prevent CSV injection in spreadsheet apps
  const str = String(val);
  const safe = /^[=+@\-]/.test(str) ? "'" + str : str;
  return `"${safe.replace(/"/g, '""')}"`;
};

const downloadUsersCSV = (users: UserRecord[], filename: string): void => {
  const headers = ["Name", "Phone Number", "Email", "Registration Date", "Country", "City", "Accepted Jesus"];
  const rows = users.map((u) => [
    u.name, u.phone || "Unknown", u.email,
    new Date(u.registeredAt).toLocaleDateString("en-US"),
    u.country || "Unknown", u.city || "Unknown", u.acceptedJesus !== undefined ? (u.acceptedJesus ? "Yes" : "No") : "Unknown",
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const downloadCSV = (users: UserRecord[], period: TimePeriod, location: string): void => {
  downloadUsersCSV(users, `harvest-users-${location || "all"}-${period}days.csv`);
};

const downloadOnboardingCSV = async (users: UserRecord[], filename: string): Promise<void> => {
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
      "Name", "Phone Number", "Email", "Registration Date", "Country", "City", "Accepted Jesus",
      ...questionLabels.map(q => q.label),
    ];

    const rows = users.map((u) => [
      u.name, u.phone || "Unknown", u.email,
      new Date(u.registeredAt).toLocaleDateString("en-US"),
      u.country || "Unknown", u.city || "Unknown",
      u.acceptedJesus !== undefined ? (u.acceptedJesus ? "Yes" : "No") : "Unknown",
      ...questionLabels.map(q => (u.onboardingAnswers && u.onboardingAnswers[q.id]) || ""),
    ]);

    const csv = [headers, ...rows].map((r) => r.map(escapeCsvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Failed to download onboarding CSV:", e);
  }
};

interface StatCardProps { label: string; value: string | number; sub?: string; color?: string; icon: string; onClick?: () => void; }
function StatCard({ label, value, sub, color = GOLD, icon, onClick }: StatCardProps) {
  return (
    <div onClick={onClick} style={{ background: CARD, borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)", flex: 1, minWidth: 0, cursor: onClick ? "pointer" : "default", transition: "transform 0.1s" }}
         onMouseDown={e => onClick && (e.currentTarget.style.transform = "scale(0.98)")}
         onMouseUp={e => onClick && (e.currentTarget.style.transform = "scale(1)")}
         onMouseLeave={e => onClick && (e.currentTarget.style.transform = "scale(1)")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 22 }}>{icon}</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: color, background: `${color}18`, borderRadius: 99, padding: "2px 8px" }}>LIVE</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: TEXT, marginTop: 8, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: TEXT2, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: color, fontWeight: 600, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Toggle({ on, color }: { on: boolean; color: string }) {
  return (
    <div style={{ width: 42, height: 24, borderRadius: 99, background: on ? color : BORDER, position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
      <div style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.25)", transition: "left 0.2s" }} />
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

  const enabledCount = ALL_PERMISSION_DEFS.filter((d) => form.permissions[d.key]).length;
  const totalCount = ALL_PERMISSION_DEFS.length;
  const q = permSearch.trim().toLowerCase();
  const matchesQuery = (item: PermissionItem): boolean =>
    !q || item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q);
  const noMatches = q.length > 0 && PERMISSION_CATEGORIES.every((cat) => cat.items.filter(matchesQuery).length === 0);
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
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 14, flexShrink: 0 }}>
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

              {PERMISSION_CATEGORIES.map((cat) => {
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
            style={{ flex: 2, background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 800, padding: "12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 14, boxShadow: GOLD_GLOW, opacity: form.id ? 1 : 0.5 }}>
            {isNew ? "Add Admin" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsAndRoles({ currentUserRole, currentUserPermissions, mode = "full" }: { currentUserRole: string, currentUserPermissions?: Permission | null, mode?: "full" | "analytics" | "roles" }) {
  const [tab, setTab] = useState<MainTab>(mode === "roles" ? "roles" : "analytics");
  const [subView, setSubView] = useState<"main" | "all_users" | "countries" | "country_users">("main");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [listSearchQuery, setListSearchQuery] = useState("");
  
  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  // tenants/{id}.ownerId — the buyer. Their card gets an Owner badge instead of
  // Edit/Remove (firestore.rules is the real guard; this avoids a dead-end UI).
  const [tenantOwnerId, setTenantOwnerId] = useState<string | null>(null);

  const [locationQuery, setLocationQuery] = useState("");
  const [period, setPeriod] = useState<TimePeriod>(7);
  const [hasSearched, setHasSearched] = useState(false);
  const [filteredUsers, setFilteredUsers] = useState<UserRecord[]>([]);

  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [isNewAdmin, setIsNewAdmin] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);

  // Follow the `mode` prop. AdminCRM renders this component with mode="analytics"
  // and mode="roles" for its two sub-tabs; switching between them reuses the same
  // instance (only the prop changes), so the internal `tab` view must be re-synced
  // to the prop or it goes stale and the shown view stops matching the sub-tab.
  useEffect(() => {
    if (mode === "roles") setTab("roles");
    else if (mode === "analytics") setTab("analytics");
  }, [mode]);

  useEffect(() => {
    setListSearchQuery("");
  }, [subView]);

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

  const handleSearch = (): void => {
    const byPeriod = filterByPeriod(allUsers, period);
    const byLocation = filterByLocation(byPeriod, locationQuery);
    setFilteredUsers(byLocation);
    setHasSearched(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await deleteDoc(doc(db, "users", userToDelete));
      setAllUsers(prev => prev.filter(u => u.id !== userToDelete));
      setFilteredUsers(prev => prev.filter(u => u.id !== userToDelete));
      setUserToDelete(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `users/${userToDelete}`); } catch (e) { console.error(e); }
    }
  };

  const renderAllUsers = () => {
    const filtered = allUsers.filter(u => 
      u.name.toLowerCase().includes(listSearchQuery.toLowerCase()) || 
      u.email.toLowerCase().includes(listSearchQuery.toLowerCase())
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeUp 0.3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSubView("main")} style={s.backBtn}>← Back</button>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: TEXT }}>All Users ({filtered.length})</h2>
          <div style={{ flex: 1 }} />
          <button onClick={() => downloadOnboardingCSV(filtered, "all_users_onboarding.csv")} style={{ ...s.downloadBtn, marginRight: 8 }}>📋 Onboarding Data</button>
          <button onClick={() => downloadUsersCSV(filtered, "all_users.csv")} style={s.downloadBtn}>⬇ Download CSV</button>
        </div>
        
        <input 
          style={s.input} 
          placeholder="Search users by name or email..." 
          value={listSearchQuery} 
          onChange={e => setListSearchQuery(e.target.value)} 
        />

        <div style={{ ...s.card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}`, background: "#FAFAFA" }}>
                <th style={s.th}>Name</th>
                <th style={s.th}>Phone Number</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>Registered</th>
                <th style={s.th}>Country</th>
                <th style={s.th}>City</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={s.td}>{u.name}</td>
                  <td style={s.td}>{u.phone || "Unknown"}</td>
                  <td style={s.td}>{u.email}</td>
                  <td style={s.td}>{new Date(u.registeredAt).toLocaleDateString()}</td>
                  <td style={s.td}>{u.country || "Unknown"}</td>
                  <td style={s.td}>{u.city || "Unknown"}</td>
                  <td style={s.td}>
                    <button 
                      onClick={() => setUserToDelete(u.id)}
                      style={{ background: "none", border: "none", color: "red", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: TEXT2 }}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderCountries = () => {
    const countryMap = new Map<string, number>();
    allUsers.forEach(u => {
      const c = u.country || "Unknown";
      countryMap.set(c, (countryMap.get(c) || 0) + 1);
    });

    const countryList = Array.from(countryMap.entries()).map(([country, count]) => ({ country, count }));
    
    const filtered = countryList.filter(c => c.country.toLowerCase().includes(listSearchQuery.toLowerCase()));
    filtered.sort((a, b) => b.count - a.count);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeUp 0.3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSubView("main")} style={s.backBtn}>← Back</button>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: TEXT }}>Countries ({filtered.length})</h2>
        </div>
        
        <input 
          style={s.input} 
          placeholder="Search countries..." 
          value={listSearchQuery} 
          onChange={e => setListSearchQuery(e.target.value)} 
        />

        <div style={{ ...s.card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}`, background: "#FAFAFA" }}>
                <th style={s.th}>Country</th>
                <th style={s.th}>Users</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr 
                  key={c.country} 
                  onClick={() => { setSelectedCountry(c.country); setSubView("country_users"); }}
                  style={{ borderBottom: `1px solid ${BORDER}`, cursor: "pointer", transition: "background 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#FAFAFA"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={s.td}>{c.country}</td>
                  <td style={s.td}>{c.count}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={2} style={{ padding: 20, textAlign: "center", color: TEXT2 }}>No countries found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderCountryUsers = () => {
    const countryUsers = allUsers.filter(u => (u.country || "Unknown") === selectedCountry);
    const filtered = countryUsers.filter(u => 
      u.name.toLowerCase().includes(listSearchQuery.toLowerCase()) || 
      u.email.toLowerCase().includes(listSearchQuery.toLowerCase())
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeUp 0.3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSubView("countries")} style={s.backBtn}>← Back</button>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: TEXT }}>Users in {selectedCountry} ({filtered.length})</h2>
          <div style={{ flex: 1 }} />
          <button onClick={() => downloadUsersCSV(filtered, `users_${selectedCountry}.csv`)} style={s.downloadBtn}>⬇ Download CSV</button>
        </div>
        
        <input 
          style={s.input} 
          placeholder="Search users by name or email..." 
          value={listSearchQuery} 
          onChange={e => setListSearchQuery(e.target.value)} 
        />

        <div style={{ ...s.card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}`, background: "#FAFAFA" }}>
                <th style={s.th}>Name</th>
                <th style={s.th}>Phone Number</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>Registered</th>
                <th style={s.th}>Country</th>
                <th style={s.th}>City</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={s.td}>{u.name}</td>
                  <td style={s.td}>{u.phone || "Unknown"}</td>
                  <td style={s.td}>{u.email}</td>
                  <td style={s.td}>{new Date(u.registeredAt).toLocaleDateString()}</td>
                  <td style={s.td}>{u.country || "Unknown"}</td>
                  <td style={s.td}>{u.city || "Unknown"}</td>
                  <td style={s.td}>
                    <button 
                      onClick={() => setUserToDelete(u.id)}
                      style={{ background: "none", border: "none", color: "red", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: TEXT2 }}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const handleReset = (): void => {
    setLocationQuery("");
    setFilteredUsers([]);
    setHasSearched(false);
  };

  const totalAll = allUsers.length;
  const periodAll = filterByPeriod(allUsers, period);
  const countries = new Set(allUsers.map((u) => u.country).filter(Boolean)).size;

  const handleSaveAdmin = async (admin: AdminUser): Promise<void> => {
    if (!admin.id) {
      notifyError('Select a user before adding them as an admin', 'No user selected');
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

  const openNewAdmin = (): void => { setEditingAdmin(null); setIsNewAdmin(true); setShowEditor(true); };
  const openEditAdmin = (admin: AdminUser): void => { setEditingAdmin(admin); setIsNewAdmin(false); setShowEditor(true); };

  const { setHeaderAction } = useAdminHeader();

  useEffect(() => {
    if (mode !== "roles") { setHeaderAction(null); return; }
    setHeaderAction(<HeaderActionButton label="Add Admin" onClick={openNewAdmin} />);
    return () => setHeaderAction(null);
  }, [setHeaderAction, mode]);

  return (
    <div style={pageStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input::placeholder { color: #BBB; }
        input, select { outline: none; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #DDD; border-radius: 4px; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
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
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: TEXT, marginBottom: 8 }}>Remove Admin?</div>
            <div style={{ fontSize: 14, color: TEXT2, lineHeight: 1.6, marginBottom: 24 }}>
              This will revoke all their permissions. They will no longer have admin access.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowRemoveConfirm(null)} style={{ flex: 1, background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "11px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Cancel</button>
              <button onClick={() => handleRemoveAdmin(showRemoveConfirm)} style={{ flex: 1, background: `linear-gradient(135deg, ${RED}, #F87171)`, border: "none", color: "#fff", padding: "11px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 800 }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {mode === "full" && (currentUserRole === "super_admin" || currentUserPermissions?.manageAdmins || currentUserPermissions?.fullAccess) && (
        <div style={s.tabBar}>
          {([["analytics", "📊 Analytics"], ["roles", "👥 Admin Roles"]] as [MainTab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ ...s.tab, ...(tab === id ? s.tabActive : {}) }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 60px" }}>

          {tab === "analytics" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {subView === "main" && (
                <>
                  <div style={{ display: "flex", gap: 12 }}>
                    <StatCard icon="👥" label="Total Users" value={totalAll} sub="All time" onClick={() => setSubView("all_users")} />
                    <StatCard icon="🌍" label="Countries" value={countries} sub="Represented" color={BLUE} onClick={() => setSubView("countries")} />
                    <StatCard icon="📈" label={`Last ${period}d`} value={periodAll.length} sub="New signups" color={GREEN} />
                  </div>

                  <div style={s.card}>
                    <div style={s.sectionHeading}>Search Registrations</div>
                    <div style={s.cardBody}>
                      <div>
                        <label style={s.label}>Time Period</label>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 6 }}>
                          {([1, 3, 7, 30] as TimePeriod[]).map((d) => (
                            <button key={d} onClick={() => setPeriod(d)}
                              style={{ padding: "10px 4px", border: `1.5px solid ${period === d ? GOLD : BORDER}`, background: period === d ? GOLD_BTN : CARD, color: period === d ? "#fff" : TEXT2, fontWeight: 700, fontSize: 13, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
                              {d === 1 ? "Today" : `${d}d`}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label style={s.label}>Location Filter</label>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FAFAFA", borderRadius: 10, border: `1.5px solid ${BORDER}`, padding: "0 12px", marginTop: 6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TEXT2} strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                          <input value={locationQuery} onChange={(e) => setLocationQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            placeholder="Search by city or country..."
                            style={{ flex: 1, border: "none", background: "transparent", fontSize: 14, fontFamily: "inherit", color: TEXT, padding: "11px 0" }} />
                          {locationQuery && <button onClick={() => setLocationQuery("")} style={{ background: "none", border: "none", color: TEXT2, cursor: "pointer", fontSize: 14 }}>✕</button>}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={handleReset} style={{ flex: 1, background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "11px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13 }}>Reset</button>
                        <button onClick={handleSearch} style={{ flex: 2, background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 800, padding: "11px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 14, boxShadow: "0 2px 8px rgba(201,150,58,0.3)" }}>
                          Search
                        </button>
                      </div>
                    </div>
                  </div>

                  {hasSearched && (
                    <div style={{ animation: "fadeUp 0.3s ease" }}>
                      <div style={s.card}>
                        <div style={{ ...s.sectionHeading, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>
                            {filteredUsers.length} result{filteredUsers.length !== 1 ? "s" : ""}
                            {locationQuery ? ` in "${locationQuery}"` : ""} — last {period} day{period !== 1 ? "s" : ""}
                          </span>
                          {filteredUsers.length > 0 && (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => downloadOnboardingCSV(filteredUsers, `onboarding-${locationQuery || "all"}-${period}days.csv`)}
                                style={{ background: BLUE_BG, border: `1px solid ${BLUE}33`, color: BLUE, borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                                📋 Onboarding
                              </button>
                              <button onClick={() => downloadCSV(filteredUsers, period, locationQuery)}
                                style={{ background: GREEN_BG, border: `1px solid ${GREEN}33`, color: GREEN, borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                                ⬇ CSV
                              </button>
                            </div>
                          )}
                        </div>

                        {filteredUsers.length === 0 ? (
                          <div style={{ padding: "32px 16px", textAlign: "center", color: TEXT2 }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>No users found</div>
                            <div style={{ fontSize: 13, marginTop: 4 }}>Try a different location or time period</div>
                          </div>
                        ) : (
                          filteredUsers.map((user, i) => (
                            <div key={user.id} style={{ padding: "13px 16px", borderBottom: i < filteredUsers.length - 1 ? `1px solid ${BORDER}` : "none", display: "flex", alignItems: "center", gap: 12 }}>
                              <div style={{ width: 36, height: 36, borderRadius: "50%", background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, fontWeight: 700, color: GOLD }}>
                                {user.name.charAt(0)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>{user.name}</div>
                                <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>{user.email}</div>
                                {user.phone && <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>📞 {user.phone}</div>}
                              </div>
                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>📍 {user.city || "Unknown"}, {user.country || "Unknown"}</div>
                                <div style={{ fontSize: 11, color: TEXT2, marginTop: 1 }}>
                                  {new Date(user.registeredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </div>
                                <button 
                                  onClick={() => setUserToDelete(user.id)}
                                  style={{ background: "none", border: "none", color: "red", cursor: "pointer", fontSize: 11, fontWeight: 600, marginTop: 4, padding: 0 }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              {subView === "all_users" && renderAllUsers()}
              {subView === "countries" && renderCountries()}
              {subView === "country_users" && renderCountryUsers()}
            </div>
          )}

          {tab === "roles" && (currentUserRole === "super_admin" || currentUserPermissions?.manageAdmins || currentUserPermissions?.fullAccess) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: PURPLE_BG, border: `1.5px solid ${PURPLE}33`, borderRadius: 14, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>👑</span>
                <div style={{ fontSize: 13, color: PURPLE, lineHeight: 1.6 }}>
                  <strong>Admin Management.</strong> You can promote users and configure their permissions. Sections a limited admin has no access to are hidden from their dashboard entirely.
                </div>
              </div>

              {admins.map((admin) => {
                const isSuperAdmin = admin.role === "super_admin";
                const isOwner = !!tenantOwnerId && admin.id === tenantOwnerId;
                const perms = admin.permissions;
                const activePerms = isSuperAdmin || perms.fullAccess
                  ? ["Full Access"]
                  : ALL_PERMISSION_DEFS.filter((d) => perms[d.key]).map((d) => d.label);
                const visiblePerms = activePerms.slice(0, 4);
                const extraCount = activePerms.length - visiblePerms.length;

                return (
                  <div key={admin.id} style={s.card}>
                    <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                      {admin.picture
                        ? <img src={admin.picture} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: `2px solid ${isSuperAdmin ? PURPLE : GOLD_LIGHT}`, flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        : <div style={{ width: 44, height: 44, borderRadius: "50%", background: GOLD_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>👤</div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{admin.name}</span>
                          {isSuperAdmin && <span style={{ fontSize: 10, fontWeight: 800, color: PURPLE, background: PURPLE_BG, borderRadius: 99, padding: "2px 7px" }}>SUPER</span>}
                          {!isSuperAdmin && perms.fullAccess && <span style={{ fontSize: 10, fontWeight: 800, color: GREEN, background: GREEN_BG, borderRadius: 99, padding: "2px 7px" }}>FULL</span>}
                        </div>
                        <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>{admin.email}</div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                          {visiblePerms.map((p) => (
                            <span key={p} style={{ fontSize: 10, fontWeight: 700, background: GOLD_LIGHT, color: GOLD, borderRadius: 99, padding: "2px 8px" }}>{p}</span>
                          ))}
                          {extraCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: "#F2F2F2", color: TEXT2, borderRadius: 99, padding: "2px 8px" }}>+{extraCount} more</span>}
                          {activePerms.length === 0 && <span style={{ fontSize: 11, color: TEXT2, fontStyle: "italic" }}>No permissions assigned</span>}
                        </div>
                      </div>

                      {!isSuperAdmin && (isOwner ? (
                        // The owner's role/permissions are locked by firestore.rules —
                        // no Edit/Remove, just a badge so the lock isn't a dead end.
                        <div title="The plan owner's admin access is locked and cannot be edited or removed."
                          style={{ display: "flex", alignItems: "center", gap: 5, background: GOLD_LIGHT, color: GOLD, borderRadius: 99, padding: "5px 12px", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                          <Crown size={13} /> Owner
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                          <button onClick={() => openEditAdmin(admin)}
                            style={{ background: GOLD_LIGHT, border: `1px solid color-mix(in srgb, var(--brand-color) 20%, transparent)`, color: GOLD, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>
                            Edit
                          </button>
                          <button onClick={() => setShowRemoveConfirm(admin.id)}
                            style={{ background: RED_BG, border: `1px solid ${RED}22`, color: RED, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div style={{ ...s.card, marginTop: 4 }}>
                <div style={s.sectionHeading}>Permission Reference</div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: PURPLE_BG, color: PURPLE }}><Crown size={14} /></div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>Full Access</div>
                      <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>Every permission below, current and future</div>
                    </div>
                  </div>
                  {PERMISSION_CATEGORIES.map((cat) => (
                    <div key={cat.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: TEXT2, letterSpacing: "0.08em", textTransform: "uppercase" }}>{cat.label}</div>
                      {cat.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <div style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "#F5F5F5", color: TEXT2 }}><Icon size={14} /></div>
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

      {userToDelete && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn 0.2s ease" }}>
          <div style={{ background: CARD, borderRadius: 16, width: "100%", maxWidth: 360, overflow: "hidden", animation: "scaleUp 0.2s ease" }}>
            <div style={{ padding: "20px 20px 16px", textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#FEF2F2", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 16px" }}>
                ⚠️
              </div>
              <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: TEXT }}>Delete User?</h3>
              <p style={{ margin: 0, fontSize: 14, color: TEXT2, lineHeight: 1.5 }}>
                Are you sure you want to delete this user from the database? This action cannot be undone.
              </p>
            </div>
            <div style={{ padding: "16px 20px 20px", display: "flex", gap: 10 }}>
              <button onClick={() => setUserToDelete(null)} style={{ flex: 1, background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14 }}>Cancel</button>
              <button onClick={confirmDeleteUser} style={{ flex: 1, background: "#DC2626", border: "none", color: "#fff", fontWeight: 800, padding: "12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 14, boxShadow: "0 2px 10px rgba(220,38,38,0.3)" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const pageStyle: CSSProperties = {
  fontFamily: "'Nunito', sans-serif",
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
  input: { background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: "10px 13px", fontSize: 14, width: "100%", fontFamily: "inherit" },
  newBtn: { background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "13px", borderRadius: 12, cursor: "pointer", fontSize: 14, width: "100%", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(201,150,58,0.3)" },
  backBtn: { background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13 },
  downloadBtn: { background: GREEN_BG, border: `1px solid ${GREEN}33`, color: GREEN, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13 },
  th: { padding: "12px 16px", fontSize: 12, fontWeight: 700, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.05em" },
  td: { padding: "12px 16px", fontSize: 14, color: TEXT },
  closeBtn: { width: 30, height: 30, borderRadius: "50%", background: "#F2F4F7", border: "none", color: TEXT2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarInitial: { width: 34, height: 34, borderRadius: "50%", background: GOLD_SOFT, color: GOLD, fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
};