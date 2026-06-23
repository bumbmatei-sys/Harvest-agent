import React, { useState, useEffect, CSSProperties } from "react";
import { collection, query, getDocs, doc, updateDoc, where, deleteDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, SUPER_ADMIN_EMAIL } from '../utils/tenant-scope';



const GOLD = "#C9963A";
const GOLD_LIGHT = "#FBF3E4";
const GOLD_BTN = "linear-gradient(135deg, #C9963A, #D4A843)";
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
  seeFormsInbox: boolean;
  createCourses: boolean;
  manageAdmins: boolean;
  fullAccess: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  picture: string;
  role: "super_admin" | "admin" | "user";
  permissions: Permission;
  assignedRegions: string[];
}

const emptyPermission = (): Permission => ({
  analytics: false, analyticsLocations: [], writeArticles: false,
  createPosts: false, postRegions: [], uploadRag: false,
  modifyChurches: false, seeFormsInbox: false, createCourses: false, manageAdmins: false, fullAccess: false,
});

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
      permissions: emptyPermission(), assignedRegions: [],
    }
  );
  const [regionInput, setRegionInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserRecord[]>([]);

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

  const toggleFullAccess = (val: boolean): void => {
    if (val) {
      setForm((f) => ({
        ...f, permissions: {
          analytics: true, analyticsLocations: [], writeArticles: true,
          createPosts: true, postRegions: [], uploadRag: true,
          modifyChurches: true, seeFormsInbox: true, createCourses: true, manageAdmins: true, fullAccess: true,
        }
      }));
    } else {
      setForm((f) => ({ ...f, permissions: { ...f.permissions, fullAccess: false } }));
    }
  };

  const addRegion = (): void => {
    const r = regionInput.trim();
    if (!r || form.assignedRegions.includes(r)) return;
    setForm((f) => ({ ...f, assignedRegions: [...f.assignedRegions, r] }));
    setRegionInput("");
  };

  const removeRegion = (r: string): void =>
    setForm((f) => ({ ...f, assignedRegions: f.assignedRegions.filter((x) => x !== r) }));

  const PERMISSION_ROWS: { key: keyof Permission; label: string; desc: string; icon: string; superOnly?: boolean }[] = [
    { key: "writeArticles", label: "Write Articles", desc: "Create, edit and publish blog articles", icon: "✍️" },
    { key: "createPosts", label: "Create Posts", desc: "Create posts, polls and events in the feed", icon: "📣" },
    { key: "createCourses", label: "Create Courses", desc: "Create and edit learning courses", icon: "🎓" },
    { key: "uploadRag", label: "Upload to AI", desc: "Add knowledge to the AI RAG database", icon: "🧠" },
    { key: "modifyChurches", label: "Modify Churches", desc: "Approve, reject and edit church entries", icon: "⛪" },
    { key: "seeFormsInbox", label: "Forms Inbox", desc: "View contact, prayer and church form submissions", icon: "📥" },
    { key: "analytics", label: "Analytics Access", desc: "View analytics data for assigned regions", icon: "📊" },
    { key: "manageAdmins", label: "Manage Admins", desc: "Create and edit admin roles", icon: "🛡️" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 99, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: CARD, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 -8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "10px 0 0", display: "flex", justifyContent: "center", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: BORDER, borderRadius: 99 }} />
        </div>
        <div style={{ padding: "12px 20px 14px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 16, color: TEXT }}>{isNew ? "Add Admin" : `Edit — ${form.name}`}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: TEXT2, cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, paddingTop: 60, paddingBottom: 120, paddingLeft: 20, paddingRight: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {isNew && !form.id && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
              <label style={s.label}>Search User</label>
              <input style={s.input} placeholder="Search by name or email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {searchResults.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, maxHeight: 200, overflowY: "auto", zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                  {searchResults.map(u => (
                    <div key={u.id} onClick={() => selectUser(u)} style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}`, cursor: "pointer" }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                      <div style={{ fontSize: 12, color: TEXT2 }}>{u.email}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {form.id && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={s.label}>User Details</label>
              <div style={{ padding: "12px", background: "#FAFAFA", border: `1.5px solid ${BORDER}`, borderRadius: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{form.name}</div>
                <div style={{ fontSize: 13, color: TEXT2 }}>{form.email}</div>
                {isNew && <button onClick={() => setForm(f => ({...f, id: "", name: "", email: ""}))} style={{ marginTop: 8, fontSize: 12, color: BLUE, background: "none", border: "none", cursor: "pointer" }}>Change User</button>}
              </div>
            </div>
          )}

          <div onClick={() => toggleFullAccess(!form.permissions.fullAccess)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 14, border: `1.5px solid ${form.permissions.fullAccess ? PURPLE : BORDER}`, background: form.permissions.fullAccess ? PURPLE_BG : BG, cursor: "pointer", transition: "all 0.2s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>🔓</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: form.permissions.fullAccess ? PURPLE : TEXT }}>Full Access</div>
                <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>All permissions enabled, global scope</div>
              </div>
            </div>
            <div style={{ width: 44, height: 24, borderRadius: 99, background: form.permissions.fullAccess ? PURPLE : BORDER, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ position: "absolute", top: 3, left: form.permissions.fullAccess ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
            </div>
          </div>

          {!form.permissions.fullAccess && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={s.label}>Permissions</label>
              {PERMISSION_ROWS.map(({ key, label, desc, icon }) => {
                const val = form.permissions[key] as boolean;
                return (
                  <div key={key} onClick={() => setPerm(key, !val)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, border: `1.5px solid ${val ? GOLD : BORDER}`, background: val ? GOLD_LIGHT : CARD, cursor: "pointer", transition: "all 0.15s" }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: val ? GOLD : TEXT }}>{label}</div>
                      <div style={{ fontSize: 11, color: TEXT2, marginTop: 1 }}>{desc}</div>
                    </div>
                    <div style={{ width: 38, height: 22, borderRadius: 99, background: val ? GOLD : BORDER, position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
                      <div style={{ position: "absolute", top: 2, left: val ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={s.label}>Assigned Regions</label>
            <div style={{ fontSize: 12, color: TEXT2, marginTop: -6 }}>
              Cities or countries this admin can access. Leave empty for global access.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...s.input, flex: 1 }} placeholder="e.g. Lagos, Nigeria, UK..."
                value={regionInput} onChange={(e) => setRegionInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRegion()} />
              <button onClick={addRegion}
                style={{ background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "0 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap" }}>
                Add
              </button>
            </div>
            {form.assignedRegions.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {form.assignedRegions.map((r) => (
                  <div key={r} style={{ display: "flex", alignItems: "center", gap: 6, background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, borderRadius: 99, padding: "4px 12px" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>📍 {r}</span>
                    <button onClick={() => removeRegion(r)} style={{ background: "none", border: "none", color: GOLD, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1, fontWeight: 700 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {form.assignedRegions.length === 0 && (
              <div style={{ fontSize: 12, color: TEXT2, fontStyle: "italic" }}>No regions assigned — global access if Analytics is enabled.</div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 20px 28px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, background: "transparent", border: `1.5px solid ${BORDER}`, color: TEXT2, padding: "12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 14 }}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={!form.id}
            style={{ flex: 2, background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 800, padding: "12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 14, boxShadow: "0 2px 10px rgba(201,150,58,0.35)", opacity: form.id ? 1 : 0.5 }}>
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

  const [locationQuery, setLocationQuery] = useState("");
  const [period, setPeriod] = useState<TimePeriod>(7);
  const [hasSearched, setHasSearched] = useState(false);
  const [filteredUsers, setFilteredUsers] = useState<UserRecord[]>([]);

  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [isNewAdmin, setIsNewAdmin] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);

  useEffect(() => {
    setListSearchQuery("");
  }, [subView]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const tenantId = await getTenantScope();
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
              permissions: data.permissions || emptyPermission(),
              assignedRegions: data.assignedRegions || []
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

  const handleSaveAdmin = async (admin: AdminUser): void => {
    try {
      const userRef = doc(db, "users", admin.id);
      await updateDoc(userRef, {
        role: admin.role,
        permissions: admin.permissions,
        assignedRegions: admin.assignedRegions
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
      try { handleFirestoreError(error, OperationType.UPDATE, `users/${admin.id}`); } catch (e) { console.error(e); }
    }
  };

  const handleRemoveAdmin = async (id: string): void => {
    try {
      const userRef = doc(db, "users", id);
      await updateDoc(userRef, {
        role: "user",
        permissions: emptyPermission(),
        assignedRegions: []
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

              <button onClick={openNewAdmin} style={s.newBtn}>+ Add Admin</button>

              {admins.map((admin) => {
                const isSuperAdmin = admin.role === "super_admin";
                const perms = admin.permissions;
                const activePerms = isSuperAdmin ? ["Full Access"] : [
                  perms.fullAccess && "Full Access",
                  perms.writeArticles && "Articles",
                  perms.createPosts && "Posts",
                  perms.createCourses && "Courses",
                  perms.uploadRag && "AI RAG",
                  perms.modifyChurches && "Churches",
                  perms.seeFormsInbox && "Inbox",
                  perms.analytics && "Analytics",
                  perms.manageAdmins && "Manage Admins",
                ].filter(Boolean) as string[];

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
                          {activePerms.map((p) => (
                            <span key={p} style={{ fontSize: 10, fontWeight: 700, background: GOLD_LIGHT, color: GOLD, borderRadius: 99, padding: "2px 8px" }}>{p}</span>
                          ))}
                          {activePerms.length === 0 && <span style={{ fontSize: 11, color: TEXT2, fontStyle: "italic" }}>No permissions assigned</span>}
                        </div>

                        {admin.assignedRegions.length > 0 && (
                          <div style={{ fontSize: 11, color: TEXT2, marginTop: 5 }}>
                            📍 {admin.assignedRegions.join(", ")}
                          </div>
                        )}
                        {!isSuperAdmin && admin.assignedRegions.length === 0 && (
                          <div style={{ fontSize: 11, color: TEXT2, marginTop: 5 }}>🌍 Global access</div>
                        )}
                      </div>

                      {!isSuperAdmin && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                          <button onClick={() => openEditAdmin(admin)}
                            style={{ background: GOLD_LIGHT, border: `1px solid ${GOLD}33`, color: GOLD, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>
                            Edit
                          </button>
                          <button onClick={() => setShowRemoveConfirm(admin.id)}
                            style={{ background: RED_BG, border: `1px solid ${RED}22`, color: RED, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div style={{ ...s.card, marginTop: 4 }}>
                <div style={s.sectionHeading}>Permission Reference</div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    ["✍️", "Write Articles", "Create, edit and publish blog articles"],
                    ["📣", "Create Posts", "Create posts, polls and events in the user feed"],
                    ["🎓", "Create Courses", "Create and edit learning courses"],
                    ["🧠", "Upload to AI", "Add knowledge sources to the AI RAG database"],
                    ["⛪", "Modify Churches", "Approve, reject and edit church entries on the map"],
                    ["📥", "Forms Inbox", "View contact, prayer request, and church application submissions"],
                    ["📊", "Analytics", "View user registration analytics for assigned region(s)"],
                    ["🛡️", "Manage Admins", "Create and edit admin roles"],
                    ["🔓", "Full Access", "All of the above with global scope"],
                  ].map(([icon, name, desc]) => (
                    <div key={name} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>{name}</div>
                        <div style={{ fontSize: 12, color: TEXT2, marginTop: 1 }}>{desc}</div>
                      </div>
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
};