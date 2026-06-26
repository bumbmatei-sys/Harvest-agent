import { create } from 'zustand';
import type { User } from 'firebase/auth';
import type { TenantPlan } from '../types/tenant.types';

interface AppStore {
  // Auth
  currentUser: User | null;
  isAuthReady: boolean;
  setCurrentUser: (user: User | null) => void;
  setIsAuthReady: (ready: boolean) => void;

  // Tenant
  currentTenant: { id: string; name: string } | null;
  currentTenantId: string | null;
  setCurrentTenant: (tenant: { id: string; name: string } | null, id: string | null) => void;

  // Plan
  tenantPlan: TenantPlan | null;
  isSuperAdmin: boolean;
  setTenantPlan: (plan: TenantPlan | null) => void;
  setIsSuperAdmin: (value: boolean) => void;

  // UI
  isNavCustomizerOpen: boolean;
  setNavCustomizerOpen: (open: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentUser: null,
  isAuthReady: false,
  setCurrentUser: (user) => set({ currentUser: user }),
  setIsAuthReady: (ready) => set({ isAuthReady: ready }),

  currentTenant: null,
  currentTenantId: null,
  setCurrentTenant: (tenant, id) => set({ currentTenant: tenant, currentTenantId: id }),

  tenantPlan: null,
  isSuperAdmin: false,
  setTenantPlan: (plan) => set({ tenantPlan: plan }),
  setIsSuperAdmin: (value) => set({ isSuperAdmin: value }),

  isNavCustomizerOpen: false,
  setNavCustomizerOpen: (open) => set({ isNavCustomizerOpen: open }),
}));
