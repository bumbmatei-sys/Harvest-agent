"use client";

import * as React from "react";
import {
  AlertTriangle,
  Building2,
  CreditCard,
  Palette,
  User,
} from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { isUnpricedTier } from "../../utils/plan-features";
import type { TenantPlan } from "../../types/tenant.types";
import AppearanceRow from "./AppearanceRow";
import BrandingSection from "./BrandingSection";
import CancelPlanBlock from "./CancelPlanBlock";
import GivingStatementsSection from "./GivingStatementsSection";
import OnboardingSection from "./OnboardingSection";
import PlanBillingSection from "./PlanBillingSection";
import ProfileSection from "./ProfileSection";
import {
  SETTINGS_NAV,
  settingsSectionFromLocation,
  type SettingsNavId,
} from "./settings-nav";

const NAV_ICONS: Record<SettingsNavId, React.ComponentType<{ className?: string }>> = {
  profile: User,
  campus: Palette,
  billing: CreditCard,
  setup: Building2,
  danger: AlertTriangle,
};

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
  initialSection?: SettingsNavId;
  onManageSubscription?: () => void;
}

/**
 * Official shadcn sidebar-13 block: a Dialog with a Sidebar nav on the left
 * and the section on the right. Harvest navy and gold arrive through theme
 * tokens on the installed primitives (`bg-card`, `text-sidebar-foreground`,
 * `text-gold`). The card is the Dialog primitive — rounded, thin ring, soft
 * shadow — matching the Eden popup.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  currentPlan,
  tenantId,
  email,
  initialSection,
  onManageSubscription,
}: SettingsDialogProps) {
  const [section, setSection] = React.useState<SettingsNavId>(
    initialSection ?? 'profile',
  );

  React.useEffect(() => {
    if (!open) return;
    setSection(initialSection ?? settingsSectionFromLocation());
  }, [open, initialSection]);

  const active = SETTINGS_NAV.find((item) => item.id === section) ?? SETTINGS_NAV[0];
  const hasSubscription = currentPlan !== undefined && !isUnpricedTier(currentPlan);
  const nav = hasSubscription ? SETTINGS_NAV : SETTINGS_NAV.filter((item) => item.id !== 'danger');

  const handleManage = React.useCallback(async () => {
    if (onManageSubscription) {
      onManageSubscription();
      return;
    }
    const { auth, db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const { authFetch } = await import('../../utils/auth-fetch');
    let tid = tenantId;
    if (!tid && auth.currentUser) {
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (userDoc.exists()) tid = userDoc.data().tenantId || null;
    }
    if (!tid) { alert('Unable to find your organization.'); return; }
    try {
      const resp = await authFetch('/api/stripe/portal', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await resp.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Failed to open billing portal');
    } catch (e) {
      console.error('Portal error:', e);
      alert('Failed to open billing portal. Please try again.');
    }
  }, [onManageSubscription, tenantId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-settings-popup
        showCloseButton
        className="overflow-hidden p-0 sm:max-w-[700px] md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px] shadow-[var(--ds-sh-lg)] bg-card"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your settings here.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {nav.map((item) => {
                      const Icon = NAV_ICONS[item.id];
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={item.id === active.id}
                            onClick={() => setSection(item.id)}
                            data-settings-nav={item.id}
                            className="min-h-11 sm:min-h-0"
                          >
                            <Icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[480px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink render={<span />}>Settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{active.label}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
              {open && active.id === 'profile' && <ProfileSection />}
              {open && active.id === 'campus' && (
                <div className="space-y-6" data-settings-section="campus">
                  <BrandingSection />
                  <AppearanceRow />
                </div>
              )}
              {open && active.id === 'billing' && (
                <PlanBillingSection
                  currentPlan={currentPlan}
                  tenantId={tenantId}
                  email={email}
                />
              )}
              {open && active.id === 'setup' && (
                <div className="space-y-6" data-settings-section="setup">
                  <OnboardingSection />
                  <GivingStatementsSection />
                </div>
              )}
              {open && active.id === 'danger' && hasSubscription && (
                <CancelPlanBlock onConfirm={handleManage} />
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
