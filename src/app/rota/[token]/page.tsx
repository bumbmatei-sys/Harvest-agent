import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { getTenantFromHost } from '@/lib/server-tenant';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import RotaRespondPanel from '@/components/events/RotaRespondPanel';
import { findByToken, listInvitations } from '@/lib/rota-invite';
import { isRotaToken, myAssignments } from '@/components/events/rota-invitations';

/**
 * THE-324 — 🔴 THE PUBLIC ACCEPT PAGE. Where the link in the text message lands.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 IT LANDS POST-HOP, AND THAT IS THE WHOLE REASON IT IS A ROUTE AT ALL.
 *
 * ⚠️ THE-138: `theharvest.app` → `<tenant>.theharvest.app` ENDS the Firebase
 * session, and THE-289 established that anything before that hop is a step the
 * member never finishes. So this page exists ONLY under a tenant subdomain: the
 * tenant is resolved from the HOST header, and `buildRotaAcceptUrl` cannot
 * produce an apex link because it refuses any host that is not a single label in
 * front of `theharvest.app`. A volunteer arriving here has already made the hop
 * and has nothing further to do. 🔴 Stop condition 3 is answered by construction
 * rather than by care.
 *
 * ⚠️ AND IT CARRIES ITS OWN TOKEN BESIDES, so there is no session to have lost.
 * Both halves of the ticket's requirement hold, not one.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NO `firestore.rules` CHANGE, AND NONE IS NEEDED.
 *
 * Both reads below go through the ADMIN SDK, server-side, exactly as `/giving`,
 * `/pledge/[campaignId]`, `/campaign/[campaignId]`, `/event/[eventId]` and
 * `/checkin/[sessionId]` read theirs. The Admin SDK bypasses rules entirely, so
 * no rule is consulted and none is added. The browser makes NO Firestore call on
 * this page at all. `firestore.rules` is byte-identical after this ticket.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT IT EXPOSES, AND THE BOUND ON IT.
 *
 * ONE invitation, addressed by a 256-bit token, plus THIS SAME PERSON'S other
 * upcoming assignments. Nothing else. `myAssignments` filters on `personId`, so
 * no other member is named and no roster is listed — a bearer token reveals no
 * more than the person holding it already knows about themself.
 *
 * ⚠️ AND NO PLACE, ANYWHERE. THE-283: never a member alongside a location.
 * `RotaInvitation` carries no place field, so there is nothing here to render
 * even carelessly — the same property part 2 gave `RotaEvent`. A rota names
 * people by necessity; it must not become a directory.
 *
 * ⚠️ `notFound()` FOR EVERY MISS — an unresolvable host, a malformed token, a
 * token that addresses nothing. The same answer every other public route gives,
 * and for the same reason: an anonymous visitor is not told whether a subdomain,
 * or a token, exists.
 *
 * 🔴 `noindex`. This URL is a capability. A search engine that crawled one out of
 * a pasted message would put a volunteer's name and their church's service times
 * into an index, and every accept link would be one query away.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your rota',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RotaRespondPage({ params }: PageProps) {
  const { token } = await params;
  // ⚠️ The SHAPE first, before any read. A public route must not spend a
  // Firestore query on junk, and the check costs nothing.
  if (!isRotaToken(token)) notFound();

  const headersList = await headers();
  const tenant = await getTenantFromHost(headersList.get('host') || '');
  if (!tenant) notFound();

  const current = await findByToken(tenant.id, token);
  if (!current) notFound();

  // ⚠️ ONE MORE READ, BOUNDED BY `INVITATION_READ_LIMIT`, filtered to this
  // person in memory. A `where('personId','==',…)` would be one field and so
  // need no composite index either — but this page already has to be correct
  // when the list is truncated, and `listInvitations` is the one read that
  // reports truncation. Missing a row here is a row absent from "what else you
  // are on for", which is a smaller and visible failure than a wrong answer.
  const all = await listInvitations(tenant.id).catch(() => ({ invitations: [], truncated: false }));
  const mine = myAssignments(current, all.invitations, new Date());

  const row = (i: (typeof mine.upcoming)[number]) => ({
    id: i.id,
    eventTitle: i.eventTitle,
    itemTitle: i.itemTitle,
    startsAtMs: i.startsAt.getTime(),
    status: i.status,
  });

  return (
    <>
      <PublicRouteAnalytics route="/rota/[token]" />
      <RotaRespondPanel
        churchName={tenant.name}
        personName={current.personName}
        token={token}
        current={row(current)}
        upcoming={mine.upcoming.map(row)}
      />
    </>
  );
}
