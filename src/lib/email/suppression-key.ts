import 'server-only';
import { createHash } from 'node:crypto';
import { normalizeEmail } from '@/lib/donation-history';

/** The key is scoped by its parent tenants/{tenantId}/emailSuppressions path.
 * Keep the historical SHA-256 IDs so old opt-outs survive the hash-only format.
 */
export const communitySuppressionId = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex');
