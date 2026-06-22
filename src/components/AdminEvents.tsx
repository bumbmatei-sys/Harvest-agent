"use client";
import React from 'react';
import AdminIframeIntegration from './AdminIframeIntegration';

const PretixIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
    <rect width="24" height="24" rx="6" fill="#3b86c8" />
    <rect x="5" y="9" width="14" height="9" rx="1.5" stroke="white" strokeWidth="1.5" />
    <path d="M8 9V7a4 4 0 018 0v2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="12" cy="13.5" r="1.5" fill="white" />
  </svg>
);

const AdminEvents: React.FC = () => (
  <AdminIframeIntegration
    integrationKey="pretix"
    displayName="Pretix"
    description="Event registration, ticketing, and attendee management"
    icon={<PretixIcon />}
    urlPlaceholder="https://events.yourministry.org"
    urlHelp="Enter the URL of your Pretix instance (self-hosted or pretix.eu cloud). The organiser dashboard will be embedded here."
  />
);

export default AdminEvents;
