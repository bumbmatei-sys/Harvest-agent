"use client";
/**
 * THE-324 — the accept page's data layer, and nothing else.
 *
 * ⚠️ EVERY LINE OF MARKUP LIVES IN `RotaRespondView.tsx`. The split is
 * `ServicePlanPanel` / `ServicePlanRow`'s and part 2's, for their reason: a view
 * with no network in it can be rendered by `renderToStaticMarkup` in the
 * Chromium layout suite, so that suite measures the SHIPPED component rather
 * than a replica it then has to pin against the original.
 *
 * 🔴 THE ONE CALL THIS FILE MAKES IS TO THIS FEATURE'S OWN ROUTE. There is no
 * Firestore call on this page — the collection has no `firestore.rules` entry
 * and therefore no client access, deliberately; see `src/lib/rota-invite.ts`.
 * A signed-out volunteer's browser talks to `/api/rota/respond` and to nothing
 * else, and that route is where the token is checked and the Admin SDK writes.
 */
import React, { useCallback } from 'react';

import RotaRespondView, { type RespondRow } from './RotaRespondView';
import type { InvitationStatus } from './rota-invitations';

export interface RotaRespondPanelProps {
  churchName: string;
  personName: string;
  token: string;
  current: RespondRow;
  upcoming: RespondRow[];
}

const RotaRespondPanel: React.FC<RotaRespondPanelProps> = ({
  churchName,
  personName,
  token,
  current,
  upcoming,
}) => {
  const onAnswer = useCallback(
    async (answer: 'accepted' | 'declined'): Promise<InvitationStatus> => {
      const res = await fetch('/api/rota/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answer }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok) {
        throw new Error(body.error || 'That could not be saved. Please try again.');
      }
      return body.status === 'declined' ? 'declined' : 'accepted';
    },
    [token],
  );

  return (
    <RotaRespondView
      churchName={churchName}
      personName={personName}
      current={current}
      upcoming={upcoming}
      onAnswer={onAnswer}
    />
  );
};

export default RotaRespondPanel;
