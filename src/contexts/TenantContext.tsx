'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { TenantPlan, TenantAddons, TenantConfig, TenantStatus } from '../types/tenant.types';
import {
  EffectiveFeatures,
  NO_ADDONS,
  getEffectiveFeatures,
  readTenantAddons,
  TOP_PLAN,
} from '../utils/plan-features';
import {
  tenantCapabilities,
  TENANT_STATUS_ACTIVE,
  type TenantCapability,
} from '../lib/tenant-lifecycle';
import { hasPlatformOverride } from '../utils/tenant-scope';
import { isNonTenantSubdomain } from '../utils/non-tenant-subdomains';

/** What the context exposes to consumers */
export interface TenantContextValue {
  /** Current tenant ID (null = global platform / super admin) */
  tenantId: string | null;
  /** The tenant's display name (e.g. church name) */
  tenantName: string | null;
  /** The tenant's subscription plan (undefined until loaded) */
  tenantPlan: TenantPlan | undefined;
  /** Branding config from the tenant document */
  branding: TenantConfig;
  /**
   * The add-ons the tenant OWNS, beyond whatever its tier includes (REP-5b).
   *
   * In MEANINGS, never in Dodo ids — the same `TenantAddons` the webhook writes
   * to `tenants/{id}`, read straight off that document by the fetch below.
   *
   * 🔴 READ `planFeatures`, NOT THIS, TO ANSWER A CAP QUESTION. This is the raw
   * purchase record; `planFeatures` is the tier with it already layered on. A
   * component that adds `tenantAddons.adminSeats` to a tier cap by hand is a
   * second implementation of `getEffectiveFeatures`, and the two will disagree.
   * This is here so a billing surface can show what was BOUGHT.
   *
   * Defaults to `NO_ADDONS` — owning nothing — which is also what every tenant
   * created before REP-5a genuinely owns.
   */
  tenantAddons: TenantAddons;
  /** Whether we are still resolving the tenant doc */
  isLoading: boolean;
  /** Error message if tenant validation failed (e.g. tenant not found) */
  error: string | null;
  /**
   * The tenant's ACTUAL entitlements: its tier's features with its add-ons
   * layered on (`getEffectiveFeatures`), or null until the plan has loaded.
   *
   * 🔴 NOT `getPlanFeatures`. That function answers "what does this TIER
   * include" and has roughly forty callers that need exactly that — the pricing
   * matrix, /api/plans, the comparison table. This answers "what does this
   * TENANT have", which is the only correct question for a cap check on a real
   * church: one that bought five extra admin seats has `maxAdmins` five higher
   * here and unchanged there. `getPlanFeatures` is deliberately untouched
   * (REP-5a) and a no-regression test pins it.
   *
   * Widened from `PlanFeatures` to `EffectiveFeatures`, which extends it — every
   * existing reader keeps compiling, and gains the `unlimitedContacts` flag.
   */
  planFeatures: EffectiveFeatures | null;
  /**
   * The tenant's LIFECYCLE state, straight off the tenant doc.
   *
   * The plan says which tier they bought; this says whether the subscription is
   * still live. Undefined until the tenant doc has loaded.
   */
  tenantStatus: TenantStatus | undefined;
  /**
   * What the lifecycle still permits — derived from `tenantStatus` alone.
   *
   * 🔴 Read this through `useTenantCapability`, never by comparing
   * `tenantStatus` at a call site. One field, one derivation, one place a state
   * can be mapped to what it allows — a hand-rolled `status !== 'archived'` in a
   * component is exactly the second source of truth this shape exists to avoid.
   */
  capabilities: Readonly<Record<TenantCapability, boolean>>;
  /** Update the tenant plan locally (e.g. after a plan change) */
  setTenantPlan: (plan: TenantPlan) => void;
  /**
   * Update the add-on set locally — `setTenantPlan`'s counterpart (REP-5b).
   *
   * 🔴 NEEDED BECAUSE THE READ IS A ONE-SHOT LATCH. `addonsInitialized` mirrors
   * `planInitialized`: the tenant doc is read once and the value is never
   * re-derived, so without a setter a church that BOUGHT an add-on would keep
   * seeing its old caps until a full page reload. A purchase is precisely the
   * moment this has to move.
   */
  setTenantAddons: (addons: TenantAddons) => void;
  /**
   * Re-read the add-on set from Firestore and apply it — how a purchase surface
   * refreshes without a page reload.
   *
   * 🔴 RE-READS RATHER THAN ASSUMING. The `subscription.plan_changed` webhook is
   * the single writer of the add-on set, and `on_payment_failure:
   * 'prevent_change'` means Dodo decides whether a change took AFTER the payment
   * — so the purchase route cannot know what the church ended up owning, and a
   * client that optimistically applied what it asked for would be claiming an
   * entitlement nobody has confirmed. What this shows always came from the
   * writer. It may briefly show the pre-purchase set if it wins the race with
   * the webhook, which is why the confirmation copy says the change may take a
   * moment to appear.
   */
  refreshTenantAddons: () => Promise<void>;
  /** Re-fetch the tenant's branding from Firestore and apply it immediately */
  refreshBranding: () => Promise<void>;
  /** Whether this is the admin subdomain */
  isAdminDomain: boolean;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

/** Read a cookie by name (client-side only) */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split(';').find(c => c.trim().startsWith(`${name}=`));
  return match ? match.split('=')[1].trim() : null;
}

/**
 * Resolve a tenant ID from a hostname and cookie fallback.
 * Only *.theharvest.app subdomains are treated as tenant slugs, and only when the
 * first label is not a NON_TENANT_SUBDOMAIN (www/app/admin/affiliate) — those, like
 * preview/staging URLs (*.vercel.app), the apex domain, and localhost, fall through
 * to the cookie fallback so they render the global/platform view.
 *
 * Keep the non-tenant exclusion in sync with getTenantIdFromHost() in
 * tenant-scope.ts — both read the shared NON_TENANT_SUBDOMAINS set, so the server
 * and client can never disagree about which subdomains are tenants.
 */
export function resolveTenantIdFromHostname(hostname: string, cookieTenantId: string | null): string | null {
  const parts = hostname.split('.');
  if (parts.length >= 3 && hostname.endsWith('.theharvest.app')) {
    const sub = parts[0];
    if (!isNonTenantSubdomain(sub)) return sub;
  }
  return cookieTenantId;
}

export interface TenantProviderProps {
  children: ReactNode;
  /**
   * Optional override: if a parent already knows the tenantId (e.g. from user doc),
   * pass it here so the provider doesn't re-resolve from the cookie.
   */
  initialTenantId?: string | null;
  /**
   * Optional override: if a parent already fetched the plan, pass it here.
   */
  initialPlan?: TenantPlan;
}

export const TenantProvider: React.FC<TenantProviderProps> = ({
  children,
  initialTenantId,
  initialPlan,
}) => {
  const [tenantId, setTenantId] = useState<string | null>(initialTenantId ?? null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantPlan, setTenantPlanState] = useState<TenantPlan | undefined>(initialPlan);
  const [tenantAddons, setTenantAddonsState] = useState<TenantAddons>(NO_ADDONS);
  const [tenantStatus, setTenantStatus] = useState<TenantStatus | undefined>(undefined);
  const [branding, setBranding] = useState<TenantConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdminDomain, setIsAdminDomain] = useState(false);
  const planInitialized = useRef(false);
  /**
   * The add-on set's one-shot latch — the same decision as `planInitialized`,
   * for the same reason, with one deliberate difference.
   *
   * 🔴 THE LATCH APPLIES. Both fields are the client's single copy of something a
   * PURCHASE changes, and both have a local setter for that. Without a latch the
   * validation effect below could re-run and overwrite a freshly-refreshed set
   * with the value it read the first time — which is the bug the plan latch
   * already exists to prevent, and it is worse for add-ons because a stale
   * add-on set silently removes capacity a church has just paid for.
   *
   * ⚠️ THE DIFFERENCE: it latches on the READ, not on the field being present.
   * The plan latch guards on `data.plan` because a tenant doc without a plan has
   * nothing to say. An ABSENT `addons` field is not silence — it is a real
   * answer, "owns nothing", which is what every tenant created before REP-5a
   * genuinely owns. Guarding on presence would leave those tenants permanently
   * unlatched, so the latch would protect exactly the tenants who need it least.
   */
  const addonsInitialized = useRef(false);

  const applyBranding = useCallback((config: TenantConfig) => {
    setBranding(config);
    const color = (config as any).primaryColor;
    if (color) {
      document.documentElement.style.setProperty('--brand-color', color);
    }
  }, []);

  const refreshBranding = useCallback(async () => {
    if (!tenantId) return;
    try {
      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
      if (tenantDoc.exists()) {
        const data = tenantDoc.data();
        if (data.config) {
          applyBranding(data.config as TenantConfig);
        }
      }
    } catch (e) {
      console.error('Failed to refresh branding:', e);
    }
  }, [tenantId, applyBranding]);

  // Detect admin subdomain
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isAdmin = getCookie('isAdmin') === 'true';
    setIsAdminDomain(isAdmin);
  }, []);

  // Resolve tenant ID from hostname (not spoofable) — cookie is fallback for custom domains
  useEffect(() => {
    if (initialTenantId !== undefined) {
      setTenantId(initialTenantId);
      return;
    }
    const hostname = window.location.hostname;
    const cookieTenantId = getCookie('tenantId');
    setTenantId(resolveTenantIdFromHostname(hostname, cookieTenantId));
  }, [initialTenantId]);

  // Validate tenant exists in Firestore and load branding
  useEffect(() => {
    let cancelled = false;

    async function validateTenant() {
      // Check if user is arriving to sign up for a new plan — skip tenant-not-found error
      const isSignupFlow = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).has('signup')
        : false;

      // No tenant = global platform (super admin browsing root domain)
      if (!tenantId) {
        setIsLoading(false);
        return;
      }

      // If we already have an initial plan and tenantId, skip the fetch
      if (initialPlan && initialTenantId === tenantId) {
        setIsLoading(false);
        return;
      }

      try {
        const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));

        if (cancelled) return;

        if (!tenantDoc.exists()) {
          // When user is signing up via ?signup param, there's no tenant yet — skip error
          if (!isSignupFlow) {
            setError(`Tenant "${tenantId}" not found. This organization may not exist or has been removed.`);
          }
          setIsLoading(false);
          return;
        }

        const data = tenantDoc.data();
        if (!planInitialized.current && data.plan) {
          planInitialized.current = true;
          setTenantPlanState(data.plan as TenantPlan);
        }
        // The add-on set, from THE SAME fetch that already supplies the plan —
        // `tenants/{id}` carries both, so this costs no additional read and no
        // new endpoint. `readTenantAddons` coerces an untrusted document field
        // and fails closed to "owns nothing", so a corrupt or absent value can
        // only ever under-report capacity, never invent it.
        if (!addonsInitialized.current) {
          addonsInitialized.current = true;
          setTenantAddonsState(readTenantAddons(data.addons));
        }
        // Lifecycle state. Unconditional (unlike the plan's one-shot
        // `planInitialized` latch) because it is re-read on every validation
        // pass and a stale 'active' is the one value that must not stick.
        setTenantStatus(data.status as TenantStatus | undefined);
        if (data.name) {
          setTenantName(data.name as string);
          // White-label: reflect the ministry name in the browser tab title.
          const platformId = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';
          if (typeof document !== 'undefined' && tenantId && tenantId !== platformId) {
            document.title = data.name as string;
          }
        }
        if (data.config) {
          applyBranding(data.config as TenantConfig);
        }
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.error('Failed to validate tenant:', e);
          setError('Failed to load organization data. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    validateTenant();
    return () => { cancelled = true; };
  }, [tenantId, initialPlan, initialTenantId, applyBranding]);

  const setTenantPlan = useCallback((plan: TenantPlan) => {
    setTenantPlanState(plan);
  }, []);

  const setTenantAddons = useCallback((addons: TenantAddons) => {
    setTenantAddonsState(addons);
  }, []);

  const refreshTenantAddons = useCallback(async () => {
    if (!tenantId) return;
    try {
      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
      if (tenantDoc.exists()) {
        setTenantAddonsState(readTenantAddons(tenantDoc.data().addons));
      }
    } catch (e) {
      // Same posture as `refreshBranding`: a failed refresh leaves the last
      // known set in place. Falling back to NO_ADDONS on a network error would
      // strip capacity a church pays for on the strength of a dropped request.
      console.error('Failed to refresh tenant add-ons:', e);
    }
  }, [tenantId]);

  // Platform-context super admins (apex domain) get all features.
  // On a tenant subdomain, EVERYONE — including super admins — is gated by the
  // tenant's actual plan.
  const platformOverride = hasPlatformOverride();

  /**
   * 🔴 WHAT ADD-ONS RESOLVE TO FOR A PLATFORM SUPER ADMIN: `NO_ADDONS`. The top
   * TIER, unmodified.
   *
   * The override exists so the apex-domain super admin is not gated by a tier
   * they never bought, and the honest completion of that is the top tier's
   * PUBLISHED allowance. An add-on is not a tier capability — it is a specific
   * purchase by a specific tenant — and in platform context there is no tenant
   * to have made one: `tenantId` is null there, by construction.
   *
   * 🔴 AND NULL IS NOT "ALL TENANTS". That is the `getTenantScope` trap, which
   * this project has now been bitten by ten times: a null tenant means "unscoped"
   * on a READ and is simply wrong on anything tenant-scoped. Add-ons are as
   * tenant-scoped as a fact gets, so there is no union to take and no set to
   * inherit — resolving them against a null tenant could only mean inventing
   * capacity nobody bought. `NO_ADDONS` is the one answer that is true.
   *
   * On a tenant subdomain `platformOverride` is false and a super admin gets
   * that tenant's real plan AND its real add-ons, exactly like everyone else —
   * which is the existing rule, unchanged.
   */
  const effectiveAddons = platformOverride ? NO_ADDONS : tenantAddons;
  const planFeatures = platformOverride
    ? getEffectiveFeatures(TOP_PLAN, NO_ADDONS)
    : (tenantPlan ? getEffectiveFeatures(tenantPlan, tenantAddons) : null);

  // A platform-context super admin is not inside any tenant's lifecycle, so they
  // are resolved against 'active' — the same override the plan gate applies, for
  // the same reason. On a tenant subdomain everyone, super admins included, gets
  // that tenant's real state.
  //
  // An UNLOADED status (undefined) resolves to full capability, matching the
  // module's fail-open rule: a church's donate button must not blink off while
  // the tenant doc is in flight, and the server gate on /api/stripe/donate is
  // what actually stops the money either way.
  const capabilities = tenantCapabilities(
    platformOverride ? TENANT_STATUS_ACTIVE : tenantStatus,
  );

  return (
    <TenantContext.Provider
      value={{
        tenantId,
        tenantName,
        tenantPlan,
        tenantAddons: effectiveAddons,
        branding,
        isLoading,
        error,
        planFeatures,
        tenantStatus,
        capabilities,
        setTenantPlan,
        setTenantAddons,
        refreshTenantAddons,
        refreshBranding,
        isAdminDomain,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

/**
 * Hook to access tenant context.
 * Throws if used outside a TenantProvider.
 */
export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (ctx === undefined) {
    throw new Error('useTenant must be used within a <TenantProvider>');
  }
  return ctx;
}

/**
 * Hook to access tenant context safely (returns undefined if outside provider).
 * Useful for optional consumer patterns.
 */
export function useTenantOptional(): TenantContextValue | undefined {
  return useContext(TenantContext);
}
