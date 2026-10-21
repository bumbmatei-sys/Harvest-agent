"use client";

import React, { useState, useEffect } from 'react';
import { Crown, DollarSign, Check, AlertTriangle, X } from 'lucide-react';
import { TenantPlan } from '../../types/tenant.types';
import { getPlanFeatures, PLAN_DISPLAY_NAMES, PLAN_ORDER, formatPlanPrice, isUnpricedTier } from '../../utils/plan-features';
import PlanUpgradeSection from './PlanUpgradeSection';
import { summarizePlanFeatures } from '../AdminSettings';
import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { ACTION_BUTTON, CONTROL_DENSITY } from '../layout/form-layout';

const TOUCH_FLOOR = 'min-h-11 sm:min-h-0';

interface PlanBillingSectionProps {
  currentPlan?: TenantPlan;
  tenantId?: string;
  email?: string;
}

interface PlanDisplayRow {
  id: TenantPlan;
  name: string;
  monthlyPrice: string;
}

const PLANS_DISPLAY: PlanDisplayRow[] = PLAN_ORDER.map((id) => ({
  id,
  name: PLAN_DISPLAY_NAMES[id],
  monthlyPrice: formatPlanPrice(id, 'monthly'),
}));

/**
 * Plan card + PlanUpgradeSection + billing portal. Same pieces Billing and
 * AdminSettings already own; composed here for the desktop popup pane.
 */
export default function PlanBillingSection({
  currentPlan,
  tenantId,
  email,
}: PlanBillingSectionProps) {
  const [stripeStatus, setStripeStatus] = useState<string | null>(null);
  const hasSubscription = currentPlan !== undefined && !isUnpricedTier(currentPlan);
  const currentPlanData = currentPlan ? PLANS_DISPLAY.find((p) => p.id === currentPlan) : null;
  const currentFeatures = currentPlan ? getPlanFeatures(currentPlan) : null;
  const planSummary = currentFeatures ? summarizePlanFeatures(currentFeatures) : '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripe = params.get('stripe');
    if (stripe === 'success') {
      setStripeStatus('success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripe === 'cancel') {
      setStripeStatus('cancel');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleManageSubscription = async () => {
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
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to open billing portal');
      }
    } catch (e) {
      console.error('Portal error:', e);
      alert('Failed to open billing portal. Please try again.');
    }
  };

  return (
    <div className="space-y-6" data-settings-section="billing">
      {stripeStatus === 'success' && (
        <Alert>
          <Check size={20} />
          <AlertTitle>Payment successful!</AlertTitle>
          <AlertDescription>Your plan has been updated. It may take a moment to reflect.</AlertDescription>
          <AlertAction>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss"
              onClick={() => setStripeStatus(null)}
              className={TOUCH_FLOOR}
            >
              <X size={16} />
            </Button>
          </AlertAction>
        </Alert>
      )}
      {stripeStatus === 'cancel' && (
        <Alert>
          <AlertTriangle size={20} />
          <AlertTitle>Checkout cancelled</AlertTitle>
          <AlertDescription>No charges were made. You can try again anytime.</AlertDescription>
          <AlertAction>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss"
              onClick={() => setStripeStatus(null)}
              className={TOUCH_FLOOR}
            >
              <X size={16} />
            </Button>
          </AlertAction>
        </Alert>
      )}

      {currentPlan ? (
        <Item variant="outline" className="gap-4 px-4 py-4">
          <ItemMedia variant="icon" className="w-11 h-11 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)]">
            <DollarSign size={20} className="text-gold" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="text-sm font-semibold text-strong">
              {currentPlanData?.name || 'Current'} plan
              {hasSubscription && currentPlanData && (
                <Badge variant="secondary">{currentPlanData.monthlyPrice}</Badge>
              )}
            </ItemTitle>
            <ItemDescription className="text-xs text-muted">{planSummary}</ItemDescription>
          </ItemContent>
          {hasSubscription && (
            <ItemActions>
              <Button
                data-testid="settings-manage-action"
                variant="outline"
                onClick={handleManageSubscription}
                className={`shrink-0 rounded-brand text-[13px] font-semibold ${TOUCH_FLOOR} ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
              >
                Manage
              </Button>
            </ItemActions>
          )}
        </Item>
      ) : (
        <Item variant="outline" className="gap-4 px-4 py-4">
          <ItemMedia variant="icon" className="w-11 h-11 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)]">
            <Crown size={20} className="text-gold" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="text-sm font-semibold text-strong">Super Admin</ItemTitle>
            <ItemDescription className="text-xs text-muted">Platform-wide access — manage all tenants</ItemDescription>
          </ItemContent>
        </Item>
      )}

      <PlanUpgradeSection
        currentPlan={currentPlan}
        tenantId={tenantId}
        email={email}
        hideUpgrade={currentPlan === 'max'}
      />
    </div>
  );
}
