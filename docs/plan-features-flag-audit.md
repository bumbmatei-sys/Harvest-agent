# `PLAN_FEATURES` flag audit — which cells actually gate anything

**Report only. Nothing in this document was changed in code.**

Baseline: `0b9bf53cdacd51cfd316fc782fda4891643e6a4f` (`main`, after #286).
Scope of the sweep: all of `src/` and `functions/`, excluding
`src/utils/plan-features.ts` itself and every `__tests__/` directory.

This exists because `publicCalendar` was deleted for having zero consumers, and
`churchDirectory` then turned out to be a second one. Two is a pattern, so this
runs the check for **all 31 cells** rather than the one that prompted it.

---

## 1. What renders the church list, and what gates it

**The list of churches/campuses a tenant adds is `src/components/AdminChurches.tsx`.**
`churchDirectory` is not read there, or anywhere else. Three things gate it, none
of them that flag:

| Gate | Where | Effect |
| --- | --- | --- |
| `perms.modifyChurches` | `AdminDashboard.tsx:388` | Whether the "Church"/"Church List" nav entry appears at all — a **permission**, not a plan |
| `maxChurches` | `AdminChurches.tsx:40`, `:54` | The cap. `atLimit = churches.length >= maxChurches`, blocking the add button |
| `maxChurches === -1` | `AdminChurches.tsx:52` | `isMinistry` — whether per-church billing UI renders |

The nav label itself keys off `features.maxChurches === 1` (`AdminDashboard.tsx:388`),
rendering "Church" on a single-campus plan and "Church List" otherwise. So even
the *naming* of the feature is driven by `maxChurches`.

**The member-facing map is `src/components/ChurchMap.tsx`**, gated by the `map`
cell (`MainApp.tsx:156`) — Small Team and above. Not by `churchDirectory` either.

### ⚠️ One thing found on the way that is worth a separate decision

`ChurchMap.tsx:191-198` queries the top-level `churches` collection with a single
`status == 'active'` filter and applies the tenant filter **client-side**:

```ts
const tenantId = await getTenantScope();
const q = query(collection(db, 'churches'), where('status', '==', 'active'));
// …
if (tenantId && data.tenantId !== tenantId) return;
```

`firestore.rules:383` backs this with `allow read: if isAuthenticated()`. So every
active church document, for every tenant, is readable by any signed-in user on any
plan; the scoping is a cosmetic `if` in the client, and it is skipped entirely when
`getTenantScope()` resolves falsy.

This is reported, not touched — it is a rules question and out of this PR's scope.
It is relevant here only because it is the closest thing in the codebase to the
"global multi-church discovery directory" the marketing row describes, and it is
currently ungated by plan in both the UI and the rules.

---

## 2. Is `churchDirectory` redundant with `maxChurches`?

**No — they are different questions, and neither one is currently being asked.**

- `maxChurches` = *how many campuses may this tenant own?* Currently `1` on every
  tier, by deliberate decision (additional campuses are a paid add-on, per the
  comment on the `max` block in `plan-features.ts`).
- `churchDirectory` = *may this tenant browse other tenants' churches?* — a
  discovery/read-across-tenants capability. That is not a cap on your own
  campuses, so it is not the same cell.

So `churchDirectory` was not redundant *by design*. It is dead for a different
reason: **the cross-tenant discovery surface it was written to gate does not exist
as a plan-gated feature.** What exists is `ChurchMap`, which is gated by `map`
(pro+) and, as noted above, is not actually tenant-restricted at the rules layer
at all.

That makes the marketing site's *"Church directory — Ministry only"* row
unenforced in the strongest sense: not merely that Individual and Small Team reach
the same screens, but that there is no code path anywhere that consults the flag.

**Three options, for the founder — not taken here:**

1. **Delete the flag** (the `publicCalendar` precedent). Correct if the row comes
   off the pricing page too. Changes nothing a customer can reach today.
2. **Wire it** to `ChurchMap`'s cross-tenant behaviour. This is the only option
   that makes the pricing row true, and it is *not* a one-line change — it needs
   the `churches` read rule scoped by tenant first, or the gate is decorative.
3. **Keep it inert** and drop the marketing row. Cheapest, and honest.

Option 2 is the only one that requires a `firestore.rules` change.

---

## 3. Every flag with zero consumers 🔴

**This is the answer to the question that matters.** All 31 cells of
`PlanFeatures`, checked for reads via member access (`features.X`,
`getPlanFeatures(…).X`, `ctx?.planFeatures?.X`), string lookup
(`hasFeature(plan, 'X')`, `getMinPlanForFeatureCell('X')`, `FEATURE_MAP` values,
`FEATURE_COMPARISON` keys) and the `/api/plans` catalog.

### Dead — no reference of any kind, anywhere

| Flag | Value | Notes |
| --- | --- | --- |
| **`churchDirectory`** | `max` only | Zero references. Not gated, not in the in-app comparison table, not published by `/api/plans`. The only mentions outside `plan-features.ts` and its tests are two prose lines in `AGENTS.md` (169, 217) that describe it as the gate — which it is not. |
| **`textToGive`** | `true` everywhere | **Second fully dead flag, and a new finding.** Zero references. The *feature* is fully built — `AdminSms.tsx:442-476` configures it, `app/api/sms/incoming/route.ts` serves it — but access is decided solely by whether the tenant has connected their own Twilio credentials (`src/lib/twilio.ts`). Same shape as `smsAutomation`, which carries an explicit comment saying a plan cell gating a capability the plan does not supply gates nothing; `textToGive` is that situation without the comment. |

### Display-only — read, but gates nothing

| Flag | Value | Only consumer |
| --- | --- | --- |
| **`pwaApp`** | `true` everywhere | `PlanUpgradeSection.tsx:72` comparison row. Nothing gates the PWA; being `true` on every tier, it could not gate anything even if read. |
| **`aiAssistant`** | `0/0/1` | `PlanUpgradeSection.tsx:81` + `/api/plans:61`, both already behind `AI_TELEGRAM_ASSISTANT_ENABLED = false`. **Intentional and documented** — the flag is deliberately kept so the feature can be switched back on. Listed for completeness, not as a defect. |

### `smsAutomation` — a third case, already documented

Read at `AdminDashboard.tsx:435`, so it is not dead, but it is `true` on every
tier and its own comment says so explicitly: *"A plan cell gating a capability the
plan does not supply gates nothing."* No action — it is already labelled.

### Everything else has a real gate

| Flag | Gated at |
| --- | --- |
| `blog` | `MainApp.tsx` tab, `AdminDashboard.tsx:389-390` (courses + blog nav) |
| `aiChat` | `MainApp.tsx:155` |
| `aiKnowledge` | `AdminDashboard.tsx:391` |
| `map` | `MainApp.tsx:156` |
| `maxChurches` | `AdminChurches.tsx:40,54` |
| `maxContacts` | `AdminCRM.tsx:251` via `utils/contact-capacity.ts` |
| `maxCourses` | `AdminCourses.tsx:100`, **server** `api/courses/adopt/route.ts:114` |
| `maxAdmins` | `AnalyticsAndRoles.tsx:613` via `utils/admin-seats.ts` |
| `customDomain` | **server** `api/domains/provision/route.ts:81`, `settings/DomainSection.tsx` |
| `customBranding` | `hasBrandingAccess()` → `AdminDashboard.tsx` |
| `newsletterAutomation` | **server** `api/newsletter/send/route.ts:96` |
| `automatedNewsletter` | **server** `api/newsletter/generate/route.ts:44`, `AdminDashboard.tsx:823` |
| `fundraising` | `AdminDashboard.tsx:397,842`, `hooks/queries/useCampaignQueries.ts` |
| `eventRegistration` | `AdminDashboard.tsx:401,850` |
| `docs` | `AdminDashboard.tsx:405,846` |
| `crm` | `AdminDashboard.tsx:411,854` |
| `accountingTools` | `AdminAccounting.tsx:102,108` |
| `taxReceipt` | `AdminAccounting.tsx:101` |
| `communityGroups` | `AdminDashboard.tsx:439,878` |
| `customForms` | `AdminDashboard.tsx:421,862` |
| `checkInSystem` | `AdminCheckin.tsx:64`, `AdminDashboard.tsx:427` |
| `livestream` | `AdminDashboard.tsx:431`, `AdminLivestream.tsx`, `LivestreamView.tsx`, `hooks/useLiveNow.ts` |
| `sermonNotes` | `AdminDocs.tsx:372` |
| `automatedBlog` | **server** `api/blog/auto-generate/route.ts:68`, `api/blog/generate/route.ts:270` |
| `givingStatements` | `AdminAccounting.tsx:109`, **server** `api/giving-statements/generate/route.ts` |
| `pledgeCampaigns` | `AdminFundraising.tsx:82` |

### No flag is gated through a lookup the compiler cannot see

Every string-literal entry point was enumerated and checked:

- `hasFeature(plan, '…')` — 5 call sites: `automatedBlog` ×2, `customDomain`,
  `automatedNewsletter`, `newsletterAutomation`.
- `getMinPlanForFeatureCell('…')` — 2 call sites: `customDomain`, `automatedBlog`.
- `FEATURE_MAP` values — `fundraising`, `eventRegistration`, `docs`, `crm`,
  `accountingTools`, `communityGroups`, `taxReceipt`.
- `FEATURE_COMPARISON` keys — display only; neither `churchDirectory` nor
  `textToGive` appears.
- `/api/plans` published cells — `churchDirectory` and `textToGive` are both absent.

None of them reaches `churchDirectory` or `textToGive`. The STOP condition for a
hidden string lookup does **not** apply.

---

## 4. Two stale comments found in passing

Not fixed, because both sit inside `plan-features.ts` and item 3 is report-only.

1. **`maxContacts` is described as unenforced and is now enforced.** Its doc
   comment reads *"VALUES ONLY — nothing enforces this yet. No contact cap exists
   anywhere in the app today"*. It does now: `AdminCRM.tsx:251` applies it through
   `utils/contact-capacity.ts`, with the same client-side-only caveat as
   `maxCourses`. The comment's forward-looking paragraph ("When enforcement lands
   it mirrors the `maxCourses` shape") describes what already shipped.
2. **`AGENTS.md:217` names `churchDirectory` as the gate** for global multi-church
   discovery. It gates nothing. If the flag is deleted, that line goes with it.

---

## Cross-reference: the account-deletion finding

Separate from this audit, and reported here because it is also rules-governed —
see the commit *"Make every Delete Account outcome visible, and re-auth in place"*:

`firestore.rules:187` gives `users/{userId}` `allow delete: if isSuperAdmin()`. A
member cannot delete their own profile document, so `PersonalInformationModal`'s
`deleteDoc` is denied every time while `deleteUser` still succeeds — **the sign-in
is destroyed and the profile document survives**. No member-facing route cleans it
up. Fixing it needs a rules change or a Cloud Function; both deploy to production
on merge, so neither was attempted.
