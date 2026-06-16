'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { TenantPlan, TenantConfig } from '../types/tenant.types';
import { getPlanFeatures, PlanFeatures } from '../utils/plan-features';

/** What the context exposes to consumers */
export interface TenantContextValue {
  /** Current tenant ID (null = global platform / super admin) */
  tenantId: string | null;
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
  const [tenantPlan, setTenantPlanState] = useState<TenantPlan | undefined>(initialPlan);
  const [branding, setBranding] = useState<TenantConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdminDomain, setIsAdminDomain] = useState(false);

  // Detect admin subdomain
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isAdmin = getCookie('isAdmin') === 'true';
    setIsAdminDomain(isAdmin);
  }, []);

  // Resolve tenant ID from cookie if not provided
  useEffect(() => {
    if (initialTenantId !== undefined) {
      setTenantId(initialTenantId);
      return;
    }
    const cookieTenantId = getCookie('tenantId');
    setTenantId(cookieTenantId || null);
  }, [initialTenantId]);

  // Validate tenant exists in Firestore and load branding
  useEffect(() => {
    let cancelled = false;

    async function validateTenant() {
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
          setError(`Tenant "${tenantId}" not found. This organization may not exist or has been removed.`);
          setIsLoading(false);
          return;
        }

        const data = tenantDoc.data();
        if (!tenantPlan && data.plan) {
          setTenantPlanState(data.plan as TenantPlan);
        }
        if (data.config) {
          setBranding(data.config as TenantConfig);
          // Apply branding CSS custom property
          const color = data.config?.primaryColor;
          if (color) {
            document.documentElement.style.setProperty('--brand-color', color);
          }
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
  }, [tenantId, initialPlan, initialTenantId, tenantPlan]);

  const setTenantPlan = useCallback((plan: TenantPlan) => {
    setTenantPlanState(plan);
  }, []);

  const planFeatures = tenantPlan ? getPlanFeatures(tenantPlan) : null;

  return (
    <TenantContext.Provider
      value={{
        tenantId,
        tenantPlan,
        branding,
        isLoading,
        error,
        planFeatures,
        setTenantPlan,
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
