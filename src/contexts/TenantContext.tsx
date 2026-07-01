'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { TenantPlan, TenantConfig } from '../types/tenant.types';
import { getPlanFeatures, PlanFeatures } from '../utils/plan-features';
import { hasPlatformOverride } from '../utils/tenant-scope';

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
  /** Whether we are still resolving the tenant doc */
  isLoading: boolean;
  /** Error message if tenant validation failed (e.g. tenant not found) */
  error: string | null;
  /** Convenience: resolved plan features for the current plan */
  planFeatures: PlanFeatures | null;
  /** Update the tenant plan locally (e.g. after a plan change) */
  setTenantPlan: (plan: TenantPlan) => void;
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
 * Only *.theharvest.app subdomains are treated as tenant slugs.
 * Preview/staging URLs (*.vercel.app, apex domain, localhost, etc.) fall through
 * to the cookie fallback so they render the global/platform view.
 */
export function resolveTenantIdFromHostname(hostname: string, cookieTenantId: string | null): string | null {
  const parts = hostname.split('.');
  if (parts.length >= 3 && hostname.endsWith('.theharvest.app')) {
    return parts[0];
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
  const [branding, setBranding] = useState<TenantConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdminDomain, setIsAdminDomain] = useState(false);
  const planInitialized = useRef(false);

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

  // Platform-context super admins (apex domain) get all features.
  // On a tenant subdomain, EVERYONE — including super admins — is gated by the
  // tenant's actual plan.
  const platformOverride = hasPlatformOverride();
  const planFeatures = platformOverride
    ? getPlanFeatures('ultra')
    : (tenantPlan ? getPlanFeatures(tenantPlan) : null);

  return (
    <TenantContext.Provider
      value={{
        tenantId,
        tenantName,
        tenantPlan,
        branding,
        isLoading,
        error,
        planFeatures,
        setTenantPlan,
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
