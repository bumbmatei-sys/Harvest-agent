"use client";
import React from 'react';
import BrandingSection from './settings/BrandingSection';
import DomainSection from './settings/DomainSection';
import { PlanFeatures } from '../utils/plan-features';

interface AdminBrandingProps {
  currentFeatures: PlanFeatures | null;
  onBack: () => void;
  /** Navigate to the Upgrade page (used by DomainSection's "Upgrade to Unlock"). */
  onUpgrade?: () => void;
}

const AdminBranding: React.FC<AdminBrandingProps> = ({ currentFeatures, onUpgrade }) => {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold mb-1.5">Platform</p>
        <h2 className="font-display text-[1.75rem] lg:text-[2rem] leading-[1.1] font-light tracking-[-0.02em] text-earth">Branding</h2>
      </div>
      <BrandingSection
        currentFeatures={currentFeatures ?? undefined}
        afterName={<DomainSection hasCustomDomain={!!currentFeatures?.customDomain} onUpgrade={onUpgrade} />}
      />
    </div>
  );
};

export default AdminBranding;
