"use client";
import { useEffect } from 'react';

interface StripeReturnOptions {
  onSuccess?: (addon?: string) => void;
  onCancel?: () => void;
  onConnectReturn?: (status: string) => void;
}

export function useStripeReturn({ onSuccess, onCancel, onConnectReturn }: StripeReturnOptions) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripe = params.get('stripe');
    const stripeConnect = params.get('stripe_connect');
    const addon = params.get('addon');

    if (stripe === 'success') {
      onSuccess?.(addon || undefined);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripe === 'cancel') {
      onCancel?.();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripeConnect) {
      onConnectReturn?.(stripeConnect);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
}
