"use client";
import React from 'react';
import { SubscribeBlock } from './email/SubscribeBlock';

/**
 * The page a ministry shares so people can join its newsletter. No session, no
 * shell: the church's name, its logo and the sign-up form, and nothing from its
 * data beyond those two public fields.
 */
export interface PublicSubscribeProps {
  tenantName: string;
  logo: string | null;
}

const PublicSubscribe: React.FC<PublicSubscribeProps> = ({ tenantName, logo }) => (
  <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
    <div className="flex flex-col items-center gap-3 text-center">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={tenantName} className="logo-plate h-14 mx-auto object-contain" />
      ) : null}
      <h1 className="font-display text-3xl font-semibold tracking-tight text-strong">{tenantName}</h1>
    </div>
    <SubscribeBlock
      heading="Subscribe to our newsletter"
      description={`Get updates from ${tenantName} by email. We will send you a link to confirm your address first.`}
    />
  </main>
);

export default PublicSubscribe;
