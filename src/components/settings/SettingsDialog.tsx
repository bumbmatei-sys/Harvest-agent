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
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { hasPlatformOverride } from "../../utils/tenant-scope";
import { getPlanFeatures, isUnpricedTier } from "../../utils/plan-features";
import type { TenantPlan } from "../../types/tenant.types";
import AppearanceRow from "./AppearanceRow";
import BrandingSection from "./BrandingSection";
import CancelPlanBlock from "./CancelPlanBlock";
import ChurchDataExportPanel from "./ChurchDataExportPanel";
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
  /** Plan cards are an owner action (the checkout and portal routes are owner-only). */
  canUpgrade?: boolean;
}

function PaneSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4" data-settings-pane-section={id}>
      <h3 id={id} className="font-display text-base font-semibold text-strong">
        {title}
      </h3>
      {children}
    </section>
  );
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
  canUpgrade = false,
}: SettingsDialogProps) {
  const [section, setSection] = React.useState<SettingsNavId>(
    initialSection ?? 'profile',
  );
  const mainRef = React.useRef<HTMLElement>(null);

  // Read on the open transition only. The Stripe/Dodo return params are
  // stripped from the URL by the billing pane after it mounts, so a later
  // dashboard re-render hands this a different `initialSection`; following it
  // would throw the admin off Plan & billing the moment the banner appears.
  const initialSectionRef = React.useRef(initialSection);
  initialSectionRef.current = initialSection;
  React.useEffect(() => {
    if (!open) return;
    setSection(initialSectionRef.current ?? settingsSectionFromLocation());
  }, [open]);

  const hasSubscription = currentPlan !== undefined && !isUnpricedTier(currentPlan);
  // Cancelling is an owner action (the cancel route is requireOwner), so a non-owner admin gets no Danger zone.
  const showDanger = hasSubscription && canUpgrade;
  const nav = showDanger ? SETTINGS_NAV : SETTINGS_NAV.filter((item) => item.id !== 'danger');
  const mainNav = nav.filter((item) => item.id !== 'danger');
  const dangerNav = nav.filter((item) => item.id === 'danger');
  const active = nav.find((item) => item.id === section) ?? nav[0];
  // Same gate the mobile Settings page puts on the Giving statements row.
  const showGivingStatements =
    hasPlatformOverride() ||
    (currentPlan !== undefined && !!getPlanFeatures(currentPlan).givingStatements);

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

  const renderNavItem = (item: (typeof SETTINGS_NAV)[number], destructive = false) => {
    const Icon = NAV_ICONS[item.id];
    return (
      <SidebarMenuItem key={item.id}>
        <SidebarMenuButton
          isActive={item.id === active.id}
          onClick={() => setSection(item.id)}
          data-settings-nav={item.id}
          className={`min-h-11 sm:min-h-0${destructive ? ' text-destructive hover:text-destructive active:text-destructive data-active:text-destructive' : ''}`}
        >
          <Icon />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-settings-popup
        showCloseButton
        initialFocus={mainRef}
        className="h-[500px] max-h-[calc(100svh-2rem)] grid-rows-1 overflow-hidden p-0 sm:max-w-[700px] md:max-w-[700px] lg:max-w-[800px] shadow-[var(--ds-sh-lg)] bg-card [--surface-sunken:var(--surface-tint)] [--muted:var(--surface-tint)]"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your settings here.
        </DialogDescription>
        <SidebarProvider className="h-full min-h-0 items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {mainNav.map((item) => renderNavItem(item))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            {dangerNav.length > 0 && (
              <SidebarFooter>
                <SidebarSeparator className="mx-0" />
                <SidebarMenu>
                  {dangerNav.map((item) => renderNavItem(item, true))}
                </SidebarMenu>
              </SidebarFooter>
            )}
          </Sidebar>
          <main
            ref={mainRef}
            tabIndex={-1}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-hidden"
          >
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
            <div
              key={active.id}
              className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0"
              data-settings-scroll
            >
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
                  canUpgrade={canUpgrade}
                />
              )}
              {open && active.id === 'setup' && (
                <div className="space-y-8" data-settings-section="setup">
                  <PaneSection id="settings-setup-onboarding" title="Onboarding questions">
                    <OnboardingSection embedded />
                  </PaneSection>
                  {showGivingStatements && (
                    <PaneSection id="settings-setup-giving" title="Giving statements">
                      <GivingStatementsSection embedded />
                    </PaneSection>
                  )}
                  <PaneSection id="settings-setup-export" title="Data export">
                    <ChurchDataExportPanel label="Export campus data" />
                  </PaneSection>
                </div>
              )}
              {open && active.id === 'danger' && showDanger && (
                <CancelPlanBlock onConfirm={handleManage} />
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
