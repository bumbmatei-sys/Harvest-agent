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
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <BrandingSection currentFeatures={currentFeatures ?? undefined} />
      <DomainSection hasCustomDomain={!!currentFeatures?.customDomain} onUpgrade={onUpgrade} />
    </div>
  );
};

export default AdminBranding;
