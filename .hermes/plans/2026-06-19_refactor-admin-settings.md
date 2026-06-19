# AdminSettings Refactor — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Break AdminSettings.tsx (1980 lines, ~80 useState hooks) into focused sub-components while preserving all existing functionality and the accordion-based settings UI.

**Architecture:** Extract each accordion section into its own component under `src/components/settings/`. Each sub-component receives its data via props (lifted state stays in AdminSettings). A shared `SettingsAccordion` wrapper handles expand/collapse. AdminSettings becomes a thin orchestrator (~300 lines).

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Firebase Firestore, Stripe

---

## Current Structure (1980 lines)

| Section | Lines | What it does |
|---------|-------|-------------|
| State + handlers | 1–615 | ~80 useState, 15+ handlers (checkout, branding, domain, payment, AI assistant, integrations, onboarding) |
| `renderUpgrade()` | 616–806 | Plan carousel, billing toggle, feature comparison table |
| `renderBranding()` | 808–935 | Logo, brand color, background image |
| `renderDomain()` | 937–1070 | Subdomain (read-only), custom domain + DNS instructions |
| `renderPayment()` | 1072–1200 | Stripe Connect onboarding/status |
| `renderOnboarding()` | 1200–1450 | Custom onboarding questions (CRUD, reorder) |
| `renderAIAssistant()` | 1450–1600 | AI Assistant add-on status, subscribe/cancel |
| `renderIntegrations()` | 1600–1750 | Instagram + Mailchimp via Composio |
| `renderCancel()` | 1750–1900 | Cancel subscription flow |
| Main return JSX | 1900–1980 | Accordion layout, back button, section routing |

---

## Exclusions (separate projects)

- ❌ Full test suite
- ❌ Rate limiting middleware (needs Redis/Upstash)
- ❌ Stale custom claims fix (Firebase limitation)
- ❌ picsum.photos replacement (needs real images)

---

## Step-by-Step Plan

### Task 1: Create `settings/SettingsAccordion.tsx`

**Objective:** Reusable accordion wrapper that handles expand/collapse, icons, labels.

**Files:**
- Create: `src/components/settings/SettingsAccordion.tsx`

```tsx
"use client";
import React, { useState, useCallback, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface SettingsSection {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  /** If true, section is hidden (e.g. plan-gated features) */
  hidden?: boolean;
}

interface SettingsAccordionProps {
  sections: SettingsSection[];
  defaultOpen?: string;
}

const SettingsAccordion: React.FC<SettingsAccordionProps> = ({ sections, defaultOpen }) => {
  const [expanded, setExpanded] = useState<string | null>(defaultOpen || null);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="space-y-3">
      {sections.filter(s => !s.hidden).map(section => (
        <div key={section.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => toggle(section.id)}
            className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              {section.icon}
              <span className="font-semibold text-gray-900">{section.label}</span>
            </div>
            <ChevronDown
              size={20}
              className={`text-gray-400 transition-transform ${expanded === section.id ? 'rotate-180' : ''}`}
            />
          </button>
          {expanded === section.id && (
            <div className="px-5 pb-5 border-t border-gray-100 pt-4">
              {section.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default SettingsAccordion;
```

**Verify:** File compiles with no TypeScript errors.

---

### Task 2: Extract `PlanUpgradeSection.tsx`

**Objective:** Move `renderUpgrade()` + its state into a standalone component.

**Files:**
- Create: `src/components/settings/PlanUpgradeSection.tsx`
- Modify: `src/components/AdminSettings.tsx` (remove renderUpgrade, import new component)

**Props interface:**
```tsx
interface PlanUpgradeSectionProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
}
```

**Internal state to move:**
- `billingPeriod` / `setBillingPeriod`
- `checkoutLoading` / `setCheckoutLoading`
- `activePlanIndex` / `setActivePlanIndex`
- `planScrollRef`
- `handlePlanScroll`
- `enterpriseModalOpen` / `setEnterpriseModalOpen`

**Internal handlers to move:**
- `handleStripeCheckout()`
- `handleManageSubscription()`

**Constants to move:**
- `PLANS` array
- `FEATURE_COMPARISON` array

**Verify:** Plan upgrade section renders identically. Checkout still redirects to Stripe.

---

### Task 3: Extract `BrandingSection.tsx`

**Objective:** Move `renderBranding()` + its state into a standalone component.

**Files:**
- Create: `src/components/settings/BrandingSection.tsx`
- Modify: `src/components/AdminSettings.tsx`

**Props interface:**
```tsx
interface BrandingSectionProps {
  currentFeatures?: PlanFeatures;
}
```

**Internal state to move:**
- `brandingLogo`, `brandingColor`, `brandingBackgroundImage`
- `brandingSaving`, `brandingSaved`, `brandingLoaded`

**Internal functions to move:**
- `loadBranding()`
- Save handler (inline in renderBranding)

**Verify:** Branding save still writes to `tenants/{tenantId}.config.logo/primaryColor/backgroundImage`.

---

### Task 4: Extract `DomainSection.tsx`

**Objective:** Move `renderDomain()` + its state.

**Files:**
- Create: `src/components/settings/DomainSection.tsx`
- Modify: `src/components/AdminSettings.tsx`

**Props:**
```tsx
interface DomainSectionProps {
  hasCustomDomain: boolean;
}
```

**Internal state to move:**
- `subdomain`, `customDomain`
- `domainSaving`, `domainSaved`, `domainLoaded`

**Internal functions to move:**
- `loadDomain()`
- Domain save handler

**Verify:** Subdomain displays correctly, custom domain save works.

---

### Task 5: Extract `PaymentSection.tsx`

**Objective:** Move `renderPayment()` + Stripe Connect logic.

**Files:**
- Create: `src/components/settings/PaymentSection.tsx`
- Modify: `src/components/AdminSettings.tsx`

**Internal state to move:**
- `stripeConnectStatus`, `stripeConnectLoading`, `paymentLoaded`

**Internal functions to move:**
- `loadPayment()`
- `handleStripeConnect()`

**Verify:** Stripe Connect onboarding flow still works.

---

### Task 6: Extract `OnboardingSection.tsx`

**Objective:** Move `renderOnboarding()` + question CRUD.

**Files:**
- Create: `src/components/settings/OnboardingSection.tsx`
- Modify: `src/components/AdminSettings.tsx`

**Internal state to move:**
- `onboardingQuestions`, `onboardingLoaded`, `onboardingSaving`, `onboardingSaved`
- `editingQuestion`, `showQuestionModal`
- `DEFAULT_ONBOARDING_QUESTIONS`

**Internal functions to move:**
- `loadOnboardingQuestions()`
- Question add/edit/delete/reorder handlers

**Verify:** Questions CRUD saves to `tenants/{tenantId}.config.onboardingQuestions`.

---

### Task 7: Extract `AIAssistantSection.tsx`

**Objective:** Move `renderAIAssistant()` + subscription logic.

**Files:**
- Create: `src/components/settings/AIAssistantSection.tsx`
- Modify: `src/components/AdminSettings.tsx`

**Props:**
```tsx
interface AIAssistantSectionProps {
  currentPlan?: TenantPlan;
  email?: string;
}
```

**Internal state to move:**
- `aiAssistantSubscribed`, `aiAssistantCode`, `aiAssistantLoaded`
- `aiAssistantLoading`, `aiAssistantCancelLoading`

**Internal functions to move:**
- `loadAiAssistant()`
- `handleAiAssistantCheckout()`
- `handleAiAssistantCancel()`

**Verify:** AI Assistant subscribe/cancel flow still works.

---

### Task 8: Extract `IntegrationsSection.tsx`

**Objective:** Move `renderIntegrations()` + Composio connect/disconnect.

**Files:**
- Create: `src/components/settings/IntegrationsSection.tsx`
- Modify: `src/components/AdminSettings.tsx`

**Internal state to move:**
- `instagramStatus`, `instagramAccount`, `instagramLoading`
- `mailchimpStatus`, `mailchimpAccount`, `mailchimpLoading`
- `integrationsLoaded`
- `pollingTimersRef`

**Internal functions to move:**
- `loadIntegrations()`
- `handleInstagramConnect()`, `handleInstagramDisconnect()`
- `handleMailchimpConnect()`, `handleMailchimpDisconnect()`

**Verify:** Instagram/Mailchimp connect/disconnect flows work. Polling cleanup on unmount.

---

### Task 9: Extract `CancelSection.tsx`

**Objective:** Move `renderCancel()` + cancellation flow.

**Files:**
- Create: `src/components/settings/CancelSection.tsx`
- Modify: `src/components/AdminSettings.tsx`

**Internal state to move:**
- `showCancelConfirm`

**Verify:** Cancel flow still calls the correct API and shows confirmation.

---

### Task 10: Refactor AdminSettings into thin orchestrator

**Objective:** Replace all `renderX()` calls with extracted components. AdminSettings becomes the accordion shell.

**Files:**
- Modify: `src/components/AdminSettings.tsx` (target: ~300 lines)

**New structure:**
```tsx
const AdminSettings: React.FC<AdminSettingsProps> = ({ onBack, currentPlan, onChangePlan, onCancelPlan, tenantId, email }) => {
  const currentFeatures = currentPlan ? getPlanFeatures(currentPlan) : null;
  const hasCustomDomain = currentFeatures?.customDomain;
  const hasBranding = currentFeatures?.customBackground;

  // Stripe return URL handling (keep here — affects multiple sections)
  React.useEffect(() => { /* existing stripe return logic */ }, []);

  const sections = [
    { id: 'upgrade', label: 'Plan & Billing', icon: <Crown size={20} />, content: <PlanUpgradeSection currentPlan={currentPlan} tenantId={tenantId} email={email} /> },
    { id: 'branding', label: 'Branding', icon: <Palette size={20} />, content: <BrandingSection currentFeatures={currentFeatures} />, hidden: !hasBranding },
    { id: 'domain', label: 'Domain', icon: <Globe size={20} />, content: <DomainSection hasCustomDomain={!!hasCustomDomain} /> },
    { id: 'payment', label: 'Payments', icon: <CreditCard size={20} />, content: <PaymentSection /> },
    { id: 'onboarding', label: 'Onboarding', icon: <Settings2 size={20} />, content: <OnboardingSection /> },
    { id: 'ai-assistant', label: 'AI Assistant', icon: <Bot size={20} />, content: <AIAssistantSection currentPlan={currentPlan} email={email} /> },
    { id: 'integrations', label: 'Integrations', icon: <Plug size={20} />, content: <IntegrationsSection /> },
    { id: 'cancel', label: 'Cancel Subscription', icon: <AlertTriangle size={20} />, content: <CancelSection currentPlan={currentPlan} onCancelPlan={onCancelPlan} /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button onClick={onBack}><ArrowLeft size={20} /></button>
        <h1 className="text-lg font-bold text-gray-900">Settings</h1>
      </div>
      {/* Accordion */}
      <div className="max-w-2xl mx-auto p-4">
        <SettingsAccordion sections={sections} defaultOpen="upgrade" />
      </div>
    </div>
  );
};
```

**Verify:** All sections render, expand/collapse works, all save/checkout flows function.

---

### Task 11: Extract shared hooks

**Objective:** Move `getTenantId()` helper and Stripe return URL handling into reusable hooks.

**Files:**
- Create: `src/components/settings/useTenantId.ts`
- Create: `src/components/settings/useStripeReturn.ts`

```tsx
// useTenantId.ts
export function useTenantId() {
  return async (): Promise<string | null> => {
    const { auth, db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    if (auth.currentUser) {
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (userDoc.exists()) return userDoc.data().tenantId || null;
    }
    return null;
  };
}
```

**Verify:** No duplicate `getTenantId()` implementations across sections.

---

## Files Changed Summary

| Action | File | Lines (est.) |
|--------|------|-------------|
| Create | `src/components/settings/SettingsAccordion.tsx` | ~50 |
| Create | `src/components/settings/PlanUpgradeSection.tsx` | ~250 |
| Create | `src/components/settings/BrandingSection.tsx` | ~160 |
| Create | `src/components/settings/DomainSection.tsx` | ~150 |
| Create | `src/components/settings/PaymentSection.tsx` | ~150 |
| Create | `src/components/settings/OnboardingSection.tsx` | ~280 |
| Create | `src/components/settings/AIAssistantSection.tsx` | ~180 |
| Create | `src/components/settings/IntegrationsSection.tsx` | ~200 |
| Create | `src/components/settings/CancelSection.tsx` | ~100 |
| Create | `src/components/settings/useTenantId.ts` | ~15 |
| Create | `src/components/settings/useStripeReturn.ts` | ~30 |
| Modify | `src/components/AdminSettings.tsx` | ~300 (from 1980) |

**Total: 11 new files, 1 modified file. AdminSettings goes from 1980 → ~300 lines.**

---

## Risks & Mitigations

1. **State lifting complexity:** Some sections share state (e.g. `tenantId` used everywhere). Mitigation: `getTenantId()` is a shared async helper, not state — each section calls it independently.

2. **Stripe return URL routing:** Currently one `useEffect` checks URL params and routes to the right section. Mitigation: keep this in AdminSettings orchestrator, pass `defaultOpen` to accordion.

3. **Accordion state lost on re-render:** If a section is unmounted (collapsed), its internal state resets. Mitigation: each section has its own `loaded` flag and re-fetches on expand (already the pattern).

4. **Import path depth:** Components in `settings/` need `../../firebase` imports. Mitigation: `useTenantId` hook centralizes the import.
