"use client";
import React from 'react';
import AdminIframeIntegration from './AdminIframeIntegration';

const CraterIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
    <rect width="24" height="24" rx="6" fill="#1a56db" />
    <path d="M6 17l3-8 3 5 2-3 2 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="18" cy="7" r="1.5" fill="#f59e0b" />
  </svg>
);

const AdminAccounting: React.FC = () => (
  <AdminIframeIntegration
    integrationKey="crater"
    displayName="Crater"
    description="Invoicing, expenses, and accounting tools for your ministry"
    icon={<CraterIcon />}
    urlPlaceholder="https://invoice.yourministry.org"
    urlHelp="Enter the URL of your Crater instance. Crater is an open-source invoicing and accounting app. Make sure iframe embedding is allowed in your Crater configuration."
  />
);

export default AdminAccounting;
