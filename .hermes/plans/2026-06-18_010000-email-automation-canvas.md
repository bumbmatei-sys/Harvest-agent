# Email Automation + Canvas — Final Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Two major features: (1) AI-powered email automation — Instagram → AI → Mailchimp newsletter, (2) Real-time collaborative freehand whiteboard canvas for admin teams.

**Architecture:**
- **Email:** Each tenant connects their own Instagram + Mailchimp via Composio. Admin triggers generation → MiMo AI writes newsletter from last 30 days of posts → Preview/edit → Send to Mailchimp audience.
- **Canvas:** Excalidraw React → Firestore real-time sync (onSnapshot) → 7-day auto-cleanup. All admins see all canvases, multiple can edit simultaneously.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind, Composio REST API (key: `ak_...`), Excalidraw React, Firestore onSnapshot, MiMo AI

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Instagram connection | Per-tenant (each church their own) | Churches have independent Instagram accounts |
| Mailchimp connection | Per-tenant (one per ministry) | Each ministry manages their own audience |
| Canvas sync | Firestore onSnapshot | Fits existing stack, no new infra |
| Canvas conflict resolution | Last-write-wins (element-level) | Excalidraw elements are independent strokes |
| Newsletter generation | Manual trigger (admin clicks button) | Admin controls when newsletters go out |
| Newsletter preview | Editable before send | Admin must approve AI-generated content |

---

## PHASE 1: Composio Infrastructure

### Task 1: Create Composio API client

**Objective:** Server-side Composio client for all integrations.

**Files:**
- Create: `src/lib/composio-client.ts`

**Implementation:**
```typescript
const COMPOSIO_BASE = 'https://backend.composio.dev/api/v2';
const API_KEY = process.env.COMPOSIO_API_KEY; // ak_... from env

export async function composioRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: Record<string, unknown>
) {
  const res = await fetch(`${COMPOSIO_BASE}${endpoint}`, {
    method,
    headers: {
      'x-api-key': API_KEY!,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Composio ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function executeComposioAction(
  action: string,
  input: Record<string, unknown>,
  connectedAccountId: string
) {
  return composioRequest('POST', '/actions/execute', {
    appName: action.split('_')[0].toLowerCase(),
    input,
    connectedAccountId,
  });
}
```

**Verify:** Compiles, `COMPOSIO_API_KEY` accessible.

---

### Task 2: Instagram connection API (per-tenant)

**Objective:** Each tenant admin connects their church's Instagram via Composio OAuth.

**Files:**
- Create: `src/app/api/composio/instagram/connect/route.ts`
- Create: `src/app/api/composio/instagram/callback/route.ts`
- Create: `src/app/api/composio/instagram/status/route.ts`
- Create: `src/app/api/composio/instagram/disconnect/route.ts`

**Flow:**
1. Admin clicks "Connect Instagram" in settings
2. Frontend calls `POST /api/composio/instagram/connect`
3. Server calls Composio to initiate Instagram OAuth for this tenant
4. Returns redirect URL → admin authorizes on Instagram/Facebook
5. Composio stores connection, returns `connectedAccountId`
6. Store on tenant doc: `/tenants/{tenantId}/integrations/instagram`

**Firestore:**
```
/tenants/{tenantId}/integrations/instagram
  - connectedAccountId: string (Composio)
  - username: string (e.g., @gracechurch)
  - userId: string (Instagram Business Account ID)
  - connectedAt: timestamp
  - status: 'connected' | 'disconnected'
```

**Verify:** OAuth flow works, connection stored per-tenant.

---

### Task 3: Mailchimp connection API (per-tenant)

**Objective:** Each tenant connects their own Mailchimp account.

**Files:**
- Create: `src/app/api/composio/mailchimp/connect/route.ts`
- Create: `src/app/api/composio/mailchimp/callback/route.ts`
- Create: `src/app/api/composio/mailchimp/status/route.ts`
- Create: `src/app/api/composio/mailchimp/audiences/route.ts`

**Same flow as Instagram.** After connection, fetch and store the audience list.

**Firestore:**
```
/tenants/{tenantId}/integrations/mailchimp
  - connectedAccountId: string (Composio)
  - email: string (Mailchimp account email)
  - audiences: [{ id, name, memberCount }]
  - selectedAudienceId: string
  - connectedAt: timestamp
  - status: 'connected' | 'disconnected'
```

**Verify:** OAuth flow works, audiences fetched and stored.

---

## PHASE 2: Newsletter Generation

### Task 4: Newsletter generation API

**Objective:** Fetch Instagram posts, generate newsletter with MiMo AI.

**Files:**
- Create: `src/app/api/newsletter/generate/route.ts`

**Flow:**
1. `POST /api/newsletter/generate`
2. Verify auth + tenant + `newsletterAutomation` feature
3. Get tenant's Instagram `connectedAccountId` from Firestore
4. Fetch posts from last 30 days: `INSTAGRAM_GET_IG_USER_MEDIA` via Composio
5. Send post data to MiMo AI:
   ```
   You are a newsletter writer for a church/ministry called {tenantName}.
   Based on these Instagram posts from the past month, create an engaging 
   newsletter in HTML format. Include:
   - Warm greeting from the church
   - Top 3-5 post highlights with descriptions
   - Key themes and messages from the month
   - Upcoming events (if mentioned in posts)
   - Closing encouragement
   
   Posts: {captions, engagement metrics, dates}
   ```
6. Return: `{ subject, htmlContent, plainText, postsUsed }`
7. Save as draft in Firestore

**Firestore:**
```
/tenants/{tenantId}/newsletters/{newsletterId}
  - subject: string
  - htmlContent: string (AI-generated, editable)
  - plainText: string
  - status: 'draft' | 'sent' | 'scheduled'
  - generatedAt: timestamp
  - sentAt: timestamp
  - mailchimpCampaignId: string
  - postsUsed: number
  - createdBy: string (admin UID)
  - createdByName: string
```

**Verify:** Generates newsletter from real Instagram posts.

---

### Task 5: Newsletter send API

**Objective:** Create and send Mailchimp campaign from newsletter draft.

**Files:**
- Create: `src/app/api/newsletter/send/route.ts`

**Flow:**
1. `POST /api/newsletter/send` with `{ newsletterId, schedule?: ISO string }`
2. Verify auth + tenant + plan
3. Get Mailchimp `connectedAccountId` and `selectedAudienceId`
4. Create campaign: `MAILCHIMP_ADD_CAMPAIGN` (type: regular)
5. Set content: `MAILCHIMP_SET_CAMPAIGN_CONTENT` (HTML from newsletter)
6. Update settings: `MAILCHIMP_UPDATE_CAMPAIGN_SETTINGS` (subject, from, reply-to)
7. Check readiness: `MAILCHIMP_GET_CAMPAIGN_SEND_CHECKLIST`
8. Send or schedule: `MAILCHIMP_SEND_CAMPAIGN` or `MAILCHIMP_SCHEDULE_CAMPAIGN`
9. Update Firestore: status → 'sent', store `mailchimpCampaignId`

**Verify:** Campaign appears in Mailchimp, email delivered.

---

### Task 6: Mailchimp campaigns list API

**Objective:** Fetch all Mailchimp campaigns for display in the app.

**Files:**
- Create: `src/app/api/newsletter/campaigns/route.ts`

**Implementation:**
```typescript
// GET /api/newsletter/campaigns
// Returns all campaigns from Mailchimp via Composio
const campaigns = await executeComposioAction(
  'MAILCHIMP_LIST_CAMPAIGNS',
  { count: 100, sort_dir: 'DESC', sort_field: 'create_time' },
  connectedAccountId
);
```

**Verify:** Returns real campaigns with open/click rates.

---

### Task 7: Newsletter UI — Generate + Preview + Edit

**Objective:** Admin UI for the full newsletter workflow.

**Files:**
- Create: `src/components/NewsletterEditor.tsx`

**UI Layout:**
1. **Generate section:**
   - "Generate Newsletter from Instagram" button
   - Shows loading spinner during AI generation
   - Shows which Instagram account is connected

2. **Preview/Edit section (after generation):**
   - Subject line input (editable)
   - TipTap rich text editor for HTML content
   - Side-by-side: edit left, preview right (desktop) / stacked (mobile)

3. **Send section:**
   - Audience selector (from Mailchimp audiences)
   - "Send Now" button
   - "Schedule" button with date/time picker
   - Confirmation modal before sending

4. **Drafts list:**
   - Previous drafts with status badges
   - Click to resume editing

**Verify:** Full generate → edit → send flow works.

---

### Task 8: Newsletter campaigns list UI

**Objective:** Show all Mailchimp campaigns in the admin dashboard.

**Files:**
- Create: `src/components/NewsletterCampaigns.tsx`

**UI:**
- Campaign cards: subject, status (draft/sent/scheduled), date, open rate, click rate
- "Create New Newsletter" button at top
- Click card → view full campaign details
- Filter: All, Drafts, Sent, Scheduled

**Verify:** Shows real Mailchimp campaigns with stats.

---

## PHASE 3: Canvas (Real-Time Collaborative)

### Task 9: Install Excalidraw

**Objective:** Add Excalidraw dependency.

**Steps:**
```bash
cd /root/harvest/Harvest-agent && npm install @excalidraw/excalidraw
```

**Verify:** Package installs, no peer dep warnings.

---

### Task 10: Canvas CRUD API

**Objective:** API routes for canvas management.

**Files:**
- Create: `src/app/api/canvas/route.ts` (GET list, POST create)
- Create: `src/app/api/canvas/[id]/route.ts` (GET one, PUT update, DELETE)

**Endpoints:**
- `GET /api/canvas` — List all canvases for tenant (sorted by updatedAt desc)
- `POST /api/canvas` — Create canvas `{ name }`, returns `{ id, name, ... }`
- `GET /api/canvas/[id]` — Get canvas with elements
- `PUT /api/canvas/[id]` — Update canvas `{ elements, appState }`
- `DELETE /api/canvas/[id]` — Delete canvas

**Firestore:**
```
/tenants/{tenantId}/canvases/{canvasId}
  - name: string
  - elements: array (Excalidraw elements JSON)
  - appState: object (zoom, scroll position)
  - createdBy: string (admin UID)
  - createdByName: string
  - createdAt: timestamp
  - updatedAt: timestamp
  - expiresAt: timestamp (createdAt + 7 days)
```

**Verify:** CRUD operations work.

---

### Task 11: Canvas list page

**Objective:** Admin page showing all canvas files.

**Files:**
- Create: `src/components/CanvasList.tsx`

**UI:**
- Grid of canvas cards: name, created by, last updated, preview thumbnail
- "New Canvas" button with name input modal
- Delete with confirmation
- Click → opens canvas editor (full-screen)
- Empty state with illustration

**Verify:** Create, rename, delete canvases.

---

### Task 12: Canvas editor with real-time sync

**Objective:** Full-screen Excalidraw editor with Firestore real-time sync.

**Files:**
- Create: `src/components/CanvasEditor.tsx`

**Real-time sync architecture:**
```typescript
import { Excalidraw } from '@excalidraw/excalidraw';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

// Listen for remote changes
useEffect(() => {
  const unsub = onSnapshot(doc(db, 'tenants', tenantId, 'canvases', canvasId), 
    (snapshot) => {
      const data = snapshot.data();
      if (data && !isLocalChange.current) {
        // Merge remote elements into local state
        setElements(data.elements);
      }
    }
  );
  return () => unsub();
}, [canvasId]);

// Push local changes (debounced)
const handleChange = (elements, appState) => {
  isLocalChange.current = true;
  clearTimeout(saveTimer.current);
  saveTimer.current = setTimeout(async () => {
    await updateDoc(docRef, {
      elements,
      appState: { zoom: appState.zoom },
      updatedAt: serverTimestamp(),
    });
    isLocalChange.current = false;
  }, 1000); // 1s debounce for real-time feel
};
```

**Conflict resolution:** Last-write-wins at element level. Since Excalidraw elements are independent strokes/shapes, concurrent edits rarely conflict. If two admins edit the same element, last save wins.

**Features:**
- Full-screen canvas (hide bottom nav)
- Real-time cursor presence (show other admins' cursors)
- Auto-save every 1s after change
- Back button → return to canvas list
- Canvas name at top
- "Last saved" / "Saving..." indicator
- Online users count badge

**Verify:** Two browser tabs editing same canvas see each other's changes in real-time.

---

### Task 13: Canvas auto-cleanup cron

**Objective:** Delete canvases older than 7 days.

**Files:**
- Create: `src/app/api/canvas/cleanup/route.ts`
- Modify: `vercel.json`

**Implementation:**
```typescript
// GET /api/canvas/cleanup (called by Vercel Cron)
const expired = await adminDb.collectionGroup('canvases')
  .where('expiresAt', '<', Timestamp.now())
  .get();
await Promise.all(expired.docs.map(doc => doc.ref.delete()));
```

**Cron:** `0 3 * * *` (daily at 3am UTC)

**Verify:** Old canvases deleted, recent preserved.

---

## PHASE 4: Dashboard Integration

### Task 14: Add Newsletter + Canvas tabs to admin dashboard

**Objective:** Wire everything into the admin nav.

**Files:**
- Modify: `src/components/AdminDashboard.tsx`

**Changes:**
- Add `newsletterAutomation` tab (gated behind Pro+ plan feature)
- Add `canvas` tab (available to all plans)
- Newsletter tab: shows `NewsletterCampaigns` (list) or `NewsletterEditor` (editing)
- Canvas tab: shows `CanvasList` (list) or `CanvasEditor` (editing, full-screen)
- Icons: `Mail` for newsletter, `PenTool` for canvas

**Verify:** Tabs appear correctly per plan, full flow works.

---

### Task 15: Integration settings UI

**Objective:** Settings section for connecting Instagram + Mailchimp.

**Files:**
- Modify: `src/components/AdminSettings.tsx`

**Add new section: "Integrations"**
- Instagram card: connected status, connect/disconnect button, username
- Mailchimp card: connected status, connect/disconnect button, audience selector
- Both gated behind plan features

**Verify:** Connect/disconnect flows work for both.

---

## PHASE 5: Security & Polish

### Task 16: Rate limiting + input validation

**Objective:** Prevent abuse.

**Rules:**
- Newsletter generation: max 5/day per tenant
- Canvas name: max 100 chars, sanitized
- Canvas elements: validate JSON structure before Firestore write
- Newsletter HTML: sanitize before rendering (XSS prevention)

**Verify:** Rate limits enforced, XSS prevented.

---

### Task 17: Plan feature enforcement

**Objective:** Gate features behind plan tiers.

**Rules:**
- Newsletter: `newsletterAutomation: true` (Pro, Max, Ultra, Enterprise)
- Canvas: available to all plans
- Instagram/Mailchimp connection: requires newsletter feature
- Show upgrade prompt for Plus plan users

**Verify:** Plus plan sees upgrade prompt, Pro+ sees full features.

---

### Task 18: Bug analysis pass

**Objective:** Deep analysis of all new code.

**Checklist:**
- [ ] Composio API key never exposed to client bundle
- [ ] Instagram/Mailchimp connections properly scoped to tenant
- [ ] Newsletter HTML sanitized before rendering
- [ ] Canvas real-time sync handles disconnects gracefully
- [ ] Auto-save debounce prevents Firestore write spam
- [ ] 7-day cleanup cron runs successfully
- [ ] Rate limiting works per-tenant
- [ ] Error handling on all Composio API calls
- [ ] Loading states on all async operations
- [ ] Mobile responsive on all new UI

---

## Files Summary

### New files (15):
```
src/lib/composio-client.ts
src/app/api/composio/instagram/connect/route.ts
src/app/api/composio/instagram/callback/route.ts
src/app/api/composio/instagram/status/route.ts
src/app/api/composio/instagram/disconnect/route.ts
src/app/api/composio/mailchimp/connect/route.ts
src/app/api/composio/mailchimp/callback/route.ts
src/app/api/composio/mailchimp/status/route.ts
src/app/api/composio/mailchimp/audiences/route.ts
src/app/api/newsletter/generate/route.ts
src/app/api/newsletter/send/route.ts
src/app/api/newsletter/campaigns/route.ts
src/app/api/canvas/route.ts
src/app/api/canvas/[id]/route.ts
src/app/api/canvas/cleanup/route.ts
```

### New components (4):
```
src/components/NewsletterEditor.tsx
src/components/NewsletterCampaigns.tsx
src/components/CanvasList.tsx
src/components/CanvasEditor.tsx
```

### Modified files (2):
```
src/components/AdminDashboard.tsx (add 2 tabs)
src/components/AdminSettings.tsx (add integrations section)
vercel.json (add cleanup cron)
```

### Dependencies (1):
```
@excalidraw/excalidraw
```

---

## Implementation Order

| Phase | Tasks | Duration |
|-------|-------|----------|
| 1. Composio Infrastructure | 1-3 | 2-3 days |
| 2. Newsletter Generation | 4-8 | 3-4 days |
| 3. Canvas | 9-13 | 3-4 days |
| 4. Dashboard Integration | 14-15 | 1 day |
| 5. Security & Polish | 16-18 | 1-2 days |

**Total: ~2 weeks**

---

## Open Questions

None — all clarified by Matei. Ready to execute.
