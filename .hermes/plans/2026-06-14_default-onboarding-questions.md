# Default Onboarding Questions — Pre-populate Admin Editor

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** The 5 default signup questions (Full Name, Country, City, Phone, Accepted Jesus) should appear as editable items in the admin questionnaire editor. Admin can keep, edit, or delete them. No more "always shown" hardcoding.

**Architecture:** Seed defaults into `config.onboardingQuestions` on first load. Onboarding.tsx renders ONLY from that array. Zero hardcoded fields.

**Tech Stack:** React, Firebase Firestore, existing Onboarding.tsx + AdminSettings.tsx

---

## Current State

- **Onboarding.tsx** (lines 297–376): 5 hardcoded fields (Full Name, Country, City, Phone, Accepted Jesus) always rendered, then custom questions from `config.onboardingQuestions` appended after
- **AdminSettings.tsx** (line 952): Says "default fields are always shown" — custom questions only
- **Firestore:** `tenants/{tenantId}.config.onboardingQuestions` stores only custom questions, not the defaults

## What Changes

| File | Change |
|---|---|
| `src/components/AdminSettings.tsx` | Seed 5 defaults into state when `onboardingQuestions` is empty on load |
| `src/components/Onboarding.tsx` | Remove hardcoded fields; render everything from `customQuestions` array; add fallback if array is empty |
| `src/components/AdminSettings.tsx` | Update description text (remove "always shown" language) |

## What Does NOT Change

- Firestore schema (same `config.onboardingQuestions` array)
- Question type interface (`OnboardingQuestion`)
- Custom question editor modal
- Save/load logic
- Analytics export (already reads from same field)

---

## Implementation Steps

### Task 1: Seed defaults in AdminSettings

**File:** `src/components/AdminSettings.tsx` — `loadOnboardingQuestions` function (line ~261)

When `config.onboardingQuestions` is empty or missing, seed the 5 defaults:

```typescript
const DEFAULT_QUESTIONS = [
  { id: 'default_name', label: 'Full Name', type: 'text', required: true, order: 0 },
  { id: 'default_country', label: 'Country', type: 'select', required: true, order: 1, options: [] },
  { id: 'default_city', label: 'City', type: 'text', required: true, order: 2 },
  { id: 'default_phone', label: 'Phone Number', type: 'text', required: true, order: 3 },
  { id: 'default_accepted_jesus', label: 'Have you accepted Jesus?', type: 'radio', required: true, order: 4, options: ['Yes', 'No'] },
];
```

In `loadOnboardingQuestions`, after reading tenant doc:
- If questions exist → use them (already saved by admin)
- If empty/missing → set `onboardingQuestions` to `DEFAULT_QUESTIONS` (don't auto-save yet; admin clicks Save to persist)

**Verify:** Open Admin Settings → Onboarding section → should show 5 default questions

### Task 2: Update description text

**File:** `src/components/AdminSettings.tsx` — `renderOnboarding` (line ~951)

Change from:
> "The default fields (Name, Country, City, Phone, Accepted Jesus) are always shown. Custom questions appear after them."

To:
> "These are the questions new members see when signing up. Edit, reorder, or delete any question. Add your own custom questions below."

**Verify:** Description text updated in UI

### Task 3: Refactor Onboarding.tsx — render from array only

**File:** `src/components/Onboarding.tsx`

Remove the 5 hardcoded form fields (lines 297–376). Replace with a single loop over `customQuestions` that renders each question using the existing `renderCustomQuestion` function.

**Special handling for known question types:**
- `default_name` → pre-fill from `auth.currentUser.displayName`
- `default_country` → render as `CountrySelect` component (GPS auto-fill already works)
- `default_city` → text input (GPS auto-fill already works)
- `default_phone` → tel input
- `default_accepted_jesus` → radio Yes/No (already handled by `renderCustomQuestion` type 'radio')

**Fallback:** If `customQuestions` is empty (no config at all), fall back to the current hardcoded defaults so the app never breaks.

**Verify:** Signup form renders all questions from the admin-defined list

### Task 4: Wire GPS auto-fill to array-based fields

**File:** `src/components/Onboarding.tsx`

GPS auto-fill currently sets `country` and `city` state directly. With array-based rendering, update `customAnswers` for the `default_country` and `default_city` question IDs when GPS resolves.

**Verify:** GPS button fills Country and City in the array-based form

### Task 5: Update handleSubmit to use array-based answers

**File:** `src/components/Onboarding.tsx`

Currently `handleSubmit` reads from individual state vars (`name`, `country`, `city`, `phone`, `acceptedJesus`). Change to read from `customAnswers` using the default question IDs:

```typescript
const name = customAnswers['default_name'] || '';
const country = customAnswers['default_country'] || '';
// etc.
```

Keep the same Firestore write shape (`displayName`, `country`, `city`, `phone`, `acceptedJesus`, `onboardingAnswers`).

**Verify:** Form submission saves same data to Firestore as before

### Task 6: Commit, deploy, verify end-to-end

1. Commit both files
2. Push to `Harvest-agent` repo
3. Verify on staging: admin sees 5 defaults, can delete/edit/save, signup form reflects changes

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Existing tenants have no `config.onboardingQuestions` | AdminSettings seeds defaults on load; Onboarding.tsx has hardcoded fallback |
| Country field needs special `CountrySelect` component | Map `default_country` type to `CountrySelect` in render logic |
| GPS auto-fill breaks with array model | Update `customAnswers` instead of individual state |
| Analytics expects specific field names | No change — same Firestore fields (`displayName`, `country`, etc.) |

## Assumptions

1. Admin must click "Save" to persist the seeded defaults (not auto-save)
2. If admin deletes all questions and saves, Onboarding.tsx falls back to hardcoded defaults
3. Country field remains a special `CountrySelect` component, not a generic `select`
4. Existing user data in Firestore is unaffected
