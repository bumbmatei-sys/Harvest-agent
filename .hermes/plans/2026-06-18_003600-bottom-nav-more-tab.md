# Admin Dashboard Bottom Nav — "More" Tab Redesign

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Reduce mobile bottom nav from 7+ tabs to 4 primary tabs + "More" sheet, keeping desktop sidebar unchanged.

**Architecture:** Split `bottomTabs` into `primaryTabs` (first 4) and `moreTabs` (remainder + Inbox + Settings). Mobile shows primary tabs + "More" button. Desktop sidebar stays as-is with all tabs.

**Tech Stack:** React, Tailwind CSS, Lucide icons

---

## Current State

**File:** `src/components/AdminDashboard.tsx` (300 lines)

**Problem:** Mobile bottom nav shows up to 9 tabs (Dashboard, Church, Courses, Blog, Posts, AI Knowledge, Tenants, Inbox, Settings). Too crowded on small screens.

**What stays unchanged:**
- Desktop sidebar (already works with collapse)
- All tab content/components
- Permission logic
- Badge counts (unread, pending churches)

---

## Plan

### Task 1: Add "More" sheet state and split tabs

**Objective:** Add state for the More sheet, and split the tab array into primary (nav bar) and more (sheet) groups.

**File:** `src/components/AdminDashboard.tsx:28-34`

**Step 1:** Add new state variable after line 32:

```typescript
const [showMoreSheet, setShowMoreSheet] = useState(false);
```

**Step 2:** Replace `bottomTabs` (lines 96-104) with split arrays:

```typescript
// All available tabs for permission filtering
const allTabs = [
  (hasFullAccess || perms.analytics) && { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  (hasFullAccess || perms.modifyChurches) && { id: 'churches', label: isTenantAdmin && features && features.maxChurches === 1 ? 'Church' : 'Church List', icon: Church },
  (isSuperAdmin || !isTenantAdmin || (features && features.blog)) && (hasFullAccess || perms.createCourses) && { id: 'courses', label: 'Courses', icon: GraduationCap },
  (isSuperAdmin || !isTenantAdmin || (features && features.blog)) && (hasFullAccess || perms.writeArticles) && { id: 'blog', label: 'Blog', icon: FileText },
  (hasFullAccess || perms.createPosts) && { id: 'posts', label: 'Posts', icon: Rss },
  (isSuperAdmin || !isTenantAdmin || (features && features.aiKnowledge)) && (hasFullAccess || perms.uploadRag) && { id: 'ai', label: 'AI Knowledge', icon: BrainCircuit },
  isSuperAdmin && { id: 'tenants', label: 'Tenants', icon: Building2 },
].filter(Boolean) as { id: string; label: string; icon: any }[];

// Mobile: first 4 tabs in nav bar, rest go to "More" sheet
const primaryTabs = allTabs.slice(0, 4);
const moreTabs = [
  ...allTabs.slice(4),
  ...(showInbox ? [{ id: 'inbox', label: 'Inbox', icon: Inbox }] : []),
  { id: 'settings', label: 'Settings', icon: Settings },
];

// Desktop: all tabs in sidebar (original behavior)
const bottomTabs = allTabs;
```

**Verify:** File compiles. No visual changes yet.

---

### Task 2: Update useEffect for tab fallback

**Objective:** Fix the active-tab fallback to also check `moreTabs`.

**File:** `src/components/AdminDashboard.tsx:107-111`

**Step:** Update the useEffect:

```typescript
useEffect(() => {
  if (!isLoading && allTabs.length > 0 && !allTabs.find(t => t.id === activeTab) && activeTab !== 'inbox' && activeTab !== 'settings') {
    setActiveTab(allTabs[0].id);
  }
}, [isLoading, allTabs, activeTab]);
```

**Verify:** No behavioral change — same logic, just uses `allTabs` instead of `bottomTabs`.

---

### Task 3: Add "More" button to mobile nav

**Objective:** Replace the full `bottomTabs.map()` in the mobile nav with `primaryTabs.map()` + a "More" button.

**File:** `src/components/AdminDashboard.tsx:138-170`

**Step:** Replace the nav items rendering. The existing `{bottomTabs.map(...)}` stays for desktop. Add a mobile-only section:

Inside the nav div (line 124), replace the `{bottomTabs.map(...)}` block with:

```typescript
{/* Mobile: primary tabs + More button */}
<div className="flex lg:hidden justify-around items-center w-full">
  {primaryTabs.map((tab) => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => setActiveTab(tab.id)}
        className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all relative ${
          isActive ? '' : 'text-gray-400'
        }`}
        style={isActive ? { color: 'var(--brand-color, #d4a017)' } : undefined}
      >
        <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
        <span className="text-[10px] font-medium">{tab.label}</span>
        {tab.id === 'churches' && pendingChurchesCount > 0 && (
          <span className="absolute top-1 right-2 bg-red-500 rounded-full border-2 border-white w-3 h-3"></span>
        )}
      </button>
    );
  })}
  <button
    onClick={() => setShowMoreSheet(!showMoreSheet)}
    className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all ${
      showMoreSheet ? '' : 'text-gray-400'
    }`}
    style={showMoreSheet ? { color: 'var(--brand-color, #d4a017)' } : undefined}
  >
    <MoreHorizontal size={22} strokeWidth={2} />
    <span className="text-[10px] font-medium">More</span>
  </button>
</div>

{/* Desktop: all tabs in sidebar */}
<div className="hidden lg:flex lg:flex-col lg:justify-start lg:items-stretch lg:gap-2 lg:w-full">
  {bottomTabs.map((tab) => {
    // ... existing desktop tab rendering (unchanged)
  })}
</div>
```

**Import:** Add `MoreHorizontal` to the lucide-react import at line 4.

**Verify:** Mobile shows 4 tabs + More. Desktop shows all tabs unchanged.

---

### Task 4: Create the "More" bottom sheet

**Objective:** Add a slide-up bottom sheet that shows when "More" is tapped.

**File:** `src/components/AdminDashboard.tsx` — add after the nav div (before closing `</div>` of the main container)

**Step:** Add the More sheet component:

```typescript
{/* More Sheet (mobile only) */}
{showMoreSheet && (
  <>
    {/* Backdrop */}
    <div
      className="fixed inset-0 bg-black/40 z-[101] lg:hidden"
      onClick={() => setShowMoreSheet(false)}
    />
    {/* Sheet */}
    <div className="fixed bottom-[72px] left-0 right-0 bg-white rounded-t-2xl z-[102] lg:hidden shadow-[0_-8px_30px_rgba(0,0,0,0.12)] animate-slide-up">
      <div className="w-9 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-2" />
      <div className="px-4 pb-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">More Tools</h3>
        <div className="grid grid-cols-4 gap-3">
          {moreTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setShowMoreSheet(false);
                }}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-gray-50 transition-colors relative"
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                  isActive ? 'bg-[#fefce8]' : 'bg-gray-100'
                }`}>
                  <Icon size={20} style={isActive ? { color: 'var(--brand-color, #d4a017)' } : { color: '#666' }} />
                </div>
                <span className="text-[10px] font-semibold text-gray-700">{tab.label}</span>
                {tab.id === 'inbox' && unreadCount > 0 && (
                  <span className="absolute top-1 right-2 w-4 h-4 bg-red-500 rounded-full border-2 border-white text-[8px] font-bold text-white flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  </>
)}
```

**Verify:** Tapping "More" opens sheet. Tapping a tab navigates and closes sheet. Tapping backdrop closes sheet.

---

### Task 5: Remove duplicate Inbox/Settings from mobile header

**Objective:** Since Inbox and Settings are now in the "More" sheet, remove them from the mobile top header to reduce clutter.

**File:** `src/components/AdminDashboard.tsx:189-222`

**Decision:** Keep Settings gear icon in the mobile header (it's a universal pattern). Move Inbox into "More" sheet only. The header keeps: logo + "Harvest Admin" + Settings gear.

**Step:** Remove the Inbox button from the mobile header (lines 207-220). Keep Settings.

**Verify:** Mobile header shows logo + title + Settings gear. Inbox accessible via More sheet.

---

### Task 6: Close More sheet on tab change

**Objective:** Ensure the More sheet closes when any navigation happens.

**File:** `src/components/AdminDashboard.tsx` — the `setActiveTab` calls in primary tabs should also close the sheet.

**Step:** This is already handled in Task 4 (the moreTabs onClick calls `setShowMoreSheet(false)`). For primary tabs, add:

```typescript
onClick={() => { setActiveTab(tab.id); setShowMoreSheet(false); }}
```

**Verify:** Tapping any tab (primary or More) closes the sheet.

---

### Task 7: Bug analysis pass

**Objective:** Check for edge cases after implementation.

**What to check:**
- [ ] Permission filtering still works (users only see tabs they have access to)
- [ ] Badge counts (unread inbox, pending churches) show correctly
- [ ] Active tab highlighting works in both nav and More sheet
- [ ] More sheet doesn't show on desktop (lg:hidden)
- [ ] Tab fallback still works (if active tab becomes unauthorized)
- [ ] Settings and Inbox accessible from More sheet
- [ ] Backdrop tap closes sheet
- [ ] `animate-slide-up` class exists (check tailwind config or replace with inline style)

---

## Files Modified

| File | Change |
|------|--------|
| `src/components/AdminDashboard.tsx` | Split tabs, add More button, add More sheet, refactor mobile nav |

## Files NOT Modified

- All admin content components (AdminBlog, AdminPosts, AdminCourses, etc.)
- AdminSettings.tsx
- AnalyticsAndRoles.tsx
- Desktop sidebar layout
- Permission logic

## Risks

| Risk | Mitigation |
|------|-----------|
| `animate-slide-up` class might not exist | Use `transition-transform duration-300 translate-y-0` instead |
| More sheet overlaps bottom nav | Sheet positioned at `bottom-[72px]` (nav height) |
| Desktop shows More button | `lg:hidden` on mobile nav, `hidden lg:flex` on desktop |

## Success Criteria

1. Mobile bottom nav shows exactly 4 tabs + "More"
2. "More" opens a bottom sheet with remaining features
3. Desktop sidebar is completely unchanged
4. All permissions and badges still work
5. Sheet closes on backdrop tap or tab selection
