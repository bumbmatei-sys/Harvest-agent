import 'server-only';

import { firestoreEmailLedger } from '@/lib/email/firestore-confirm';
import { firestoreEmailStore } from '@/lib/email/firestore-store';
import { getEmailProvider } from '@/lib/email/provider';
import { createEmailService } from '@/lib/email/service';

/** The live service, wired to Firestore and the configured vendor. One place, so a route cannot forget a dependency. */
export function buildEmailService(appOrigin: string) {
  const fallbackFrom = process.env.EMAIL_FALLBACK_FROM?.trim() || null;
  return createEmailService({
    store: firestoreEmailStore,
    ledger: firestoreEmailLedger(),
    getProvider: getEmailProvider,
    appOrigin,
    fallbackFrom,
    reservedDomains: [fallbackFrom, process.env.NEXT_PUBLIC_ROOT_DOMAIN],
  });
}
