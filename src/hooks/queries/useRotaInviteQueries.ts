/**
 * THE-324 — how the admin screen reaches a collection the browser cannot read.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THIS IS THE ONLY HOOK IN THE FEATURE, AND IT MAKES NO FIRESTORE CALL.
 *
 * `tenants/{t}/rotaInvitations` has NO rule in `firestore.rules`, deliberately.
 * `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE, CI runs no emulator
 * tests, and THE-313's ONE-LINE addition turned 49 test files red — so the
 * collection is server-only and every access goes through `/api/rota/*` on the
 * Admin SDK. See `src/lib/rota-invite.ts` for the whole argument, and for the
 * rule that WOULD be needed if a later ticket ever read this from a browser.
 * 🔴 `firestore.rules` is byte-identical after this ticket.
 *
 * ⚠️ SO THE READ COST IS ONE HTTP CALL, AND THE FIRESTORE COST BEHIND IT IS ONE
 * QUERY: the whole collection with `limit(N + 1)`. No `where`, no `orderBy`, and
 * therefore no composite index — which matters because `firestore.indexes.json`
 * does NOT deploy on merge, so an index added there is inert and the query that
 * needed it throws `failed-precondition` in production.
 *
 * ⚠️ AND IT DOES NOT GROW WITH THE HORIZON. Part 2 established that shape for
 * the rota — three queries whatever the number of weeks — and this adds a
 * fourth read to the screen, not one per service.
 *
 * 🔴 NOT SWALLOWED ON FAILURE. A rejected read must NOT come back as an empty
 * list: "no unfilled slots" when the read failed is indistinguishable from an
 * answer, and it is the `Form submissions 0` class this ticket names. The query
 * throws, `isError` reaches `slotVerdict`, and the panel renders the reason.
 */
import { useQuery } from '@tanstack/react-query';

import { auth } from '../../firebase';
import type { InvitationChannels, InvitationStatus, RotaInvitation } from '../../components/events/rota-invitations';

/** The wire row. 🔴 Epoch MILLISECONDS — never an ISO string, on the wire or in
 * a document. This feature has ONE date representation. */
export interface WireInvitation {
  id: string;
  planId: string;
  itemId: string;
  eventId: string;
  personId: string;
  personName: string;
  eventTitle: string;
  itemTitle: string;
  startsAtMs: number;
  status: InvitationStatus;
  invitedAtMs: number | null;
  remindedAtMs: number | null;
  respondedAtMs: number | null;
  reminderCount: number;
  channels: InvitationChannels;
}

export interface RotaInvitationsRead {
  invitations: RotaInvitation[];
  /** 🔴 True when the collection holds more than one read returns. */
  truncated: boolean;
  /** Ministry-only (THE-314), resolved SERVER-side. A read, never a write. */
  smsAvailable: boolean;
}

const hydrate = (w: WireInvitation, tenantId: string): RotaInvitation => ({
  id: w.id,
  tenantId,
  planId: w.planId,
  itemId: w.itemId,
  eventId: w.eventId,
  personId: w.personId,
  personName: w.personName,
  eventTitle: w.eventTitle,
  itemTitle: w.itemTitle,
  startsAt: new Date(w.startsAtMs),
  status: w.status,
  invitedAt: w.invitedAtMs === null ? null : new Date(w.invitedAtMs),
  remindedAt: w.remindedAtMs === null ? null : new Date(w.remindedAtMs),
  respondedAt: w.respondedAtMs === null ? null : new Date(w.respondedAtMs),
  reminderCount: w.reminderCount,
  channels: w.channels,
});

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await auth.currentUser?.getIdToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const rotaInviteKeys = {
  invitations: (tenantId: string | null) => ['rotaInvitations', tenantId] as const,
};

export const useRotaInvitations = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: rotaInviteKeys.invitations(tenantId ?? null),
    queryFn: async (): Promise<RotaInvitationsRead> => {
      if (!tenantId) return { invitations: [], truncated: false, smsAvailable: false };
      const res = await fetch('/api/rota/invitations', { headers: await authHeaders() });
      if (!res.ok) {
        // 🔴 THROWN, NOT CAUGHT INTO `[]`. See the header.
        throw new Error('The invitations could not be read.');
      }
      const body = (await res.json()) as {
        invitations?: WireInvitation[];
        truncated?: boolean;
        smsAvailable?: boolean;
      };
      return {
        invitations: (body.invitations ?? []).map((w) => hydrate(w, tenantId)),
        truncated: body.truncated === true,
        smsAvailable: body.smsAvailable === true,
      };
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  });

/** What one press of Invite or Remind did. Reported back so the panel can say it. */
export interface SendOutcome {
  attempted: number;
  delivered: number;
  /** 🔴 Segments Harvest was actually billed for. The provider's own count. */
  smsSegments: number;
}

/** The one write this screen makes, and it is an HTTP call to this feature's route. */
export async function sendRotaInvitations(
  body: { action: 'invite'; planId: string } | { action: 'remind' },
): Promise<SendOutcome> {
  const res = await fetch('/api/rota/invitations', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as Partial<SendOutcome> & { error?: string };
  if (!res.ok) throw new Error(parsed.error || 'The invitations could not be sent.');
  return {
    attempted: parsed.attempted ?? 0,
    delivered: parsed.delivered ?? 0,
    smsSegments: parsed.smsSegments ?? 0,
  };
}
