"use client";
import React from 'react';
import AdminIframeIntegration from './AdminIframeIntegration';

const RocketChatIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.821.487 3.53 1.338 5L2.5 21.5l4.5-.838A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" fill="#f5455c" />
    <path d="M7 10.5h10M7 14h6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const AdminCommunity: React.FC = () => (
  <AdminIframeIntegration
    integrationKey="rocketchat"
    displayName="Rocket.Chat"
    description="Team messaging and community groups for your ministry"
    icon={<RocketChatIcon />}
    urlPlaceholder="https://chat.yourministry.org"
    urlHelp="Enter the URL of your self-hosted or cloud Rocket.Chat instance. The admin must enable iframe embedding in Rocket.Chat admin settings."
  />
);

export default AdminCommunity;
