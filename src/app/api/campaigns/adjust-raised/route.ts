import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requireTenantPermission } from '@/lib/api-auth';
import { tenantFeatures } from '@/lib/tenant-features';
import {
  isGivingProviderId,
  getGivingProvider,
  type GivingProviderId,
} from '@/components/donations/giving-providers';

/**
 * THE-251 — record a gift that Harvest never saw, against a campaign's `raised`.
 *
 * ─── 🔴 WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
 *
 * THE-246 gave a church its own payment links — PayPal, Cash App, Venmo, Zelle.
 * Nothing in that flow touches Harvest: the member opens the church's own
 * account and the money moves there. So a campaign's `raised` — the number
 * behind the progress bar on /campaign/[id], in the news feed widget and on the
 * admin's own list — counts Stripe gifts and NOTHING else.
 *
 * Before this route there was no way to correct that. `campaigns` docs carry
 * `goal` and `raised` (AdminFundraising's `empty`, :30-31), the editor has a
 * Goal ($) input (:631-633) and NO Raised input, and the only writer of
 * `raised` was the Stripe webhook. A church running a $50,000 roof appeal that
 * took $18,000 through PayPal had no way to say so. Naming that gap without
 * shipping the remedy is the trap THE-249 was told to avoid, so the remedy is
 * this route and the disclosure points at it.
 *
 * ─── 🔴 IT ADDS. IT NEVER SETS ───────────────────────────────────────────────
 *
 * `incrementCampaignRaised` (src/lib/donation-webhook.ts:217) credits a Stripe
 * gift with `FieldValue.increment`, per payment, forever. A "set the raised
 * total" field would therefore be a double-count with a fuse on it: an admin
 * reads $18,000 off their PayPal statement, types the campaign's whole total
 * including Stripe's share, and the next Stripe gift increments on top of a
 * figure that already contained it.
 *
 * So the contract is the CRM's Add Activity → Donation contract, which
 * increments `contacts.totalDonated` rather than replacing it (AdminCRM.tsx:902):
 * the caller sends the SIZE OF ONE GIFT and this adds it. There is no field
 * anywhere in this feature that accepts a total.
 *
 * ─── A CORRECTION IS A NEGATIVE ADJUSTMENT ───────────────────────────────────
 *
 * An admin who meant $50 and typed $500 sends -450 and the ledger reconciles:
 * both rows survive in `adjustments`, so the total is explained by its history
 * rather than quietly patched. That is why negatives are ACCEPTED and not
 * refused — refusing them would leave a mistyped figure permanently
 * uncorrectable, which is the very complaint this ticket opens with.
 *
 * The one thing a negative may not do is drive the total below zero, so the
 * floor is checked against the CURRENT value inside the transaction. A campaign
 * cannot have raised minus four hundred dollars, and a number that goes
 * negative on a public progress bar is a number no church can explain.
 *
 * ─── 🔴 NO INVOICE. EVER ─────────────────────────────────────────────────────
 *
 * Giving statements are built from `tenants/{id}/invoices` where
 * `type === 'donation_receipt'` (see AdminGivingStatements), and the ONLY
 * writer of those is the Stripe donation webhook. This route writes `campaigns`
 * and one `adjustments` doc — it does not touch `invoices`, and it must never
 * start. A manual entry is a church's own bookkeeping about money Harvest never
 * processed and never receipted; putting it on a charitable-contribution
 * statement would be Harvest attesting, over a member's name and for their tax
 * return, to a gift it has no record of. THE-249 established this for the CRM's
 * Add Activity → Donation; the same holds here, for the same reason.
 *
 * ─── WHY A ROUTE AND NOT A CLIENT WRITE ──────────────────────────────────────
 *
 * `match /campaigns/{campaignId}` in firestore.rules carries no subcollection
 * match, so a client write to `campaigns/{id}/adjustments` is denied by default
 * — and firestore.rules auto-deploys to production and is out of scope here.
 * The Admin SDK writes past rules, so the audit row and the increment can land
 * in ONE atomic transaction with no rules change at all. It also puts the free-
 * tier refusal and the cross-tenant guard on the server, where a money mutation
 * belongs, rather than behind a hidden button.
 */

/** The largest single adjustment accepted, in dollars, in either direction. */
export const MAX_ADJUSTMENT_DOLLARS = 1_000_000;

/** The longest note stored on an adjustment row. */
export const MAX_ADJUSTMENT_NOTE_LENGTH = 280;

/**
 * The refusal a donor-facing surface would never see — every caller here is a
 * signed-in admin of the tenant, so these say what is actually wrong.
 */
const BAD_AMOUNT =
  `Enter an amount between $0.01 and $${MAX_ADJUSTMENT_DOLLARS.toLocaleString()}. ` +
  'Use a negative amount to correct a gift you entered by mistake.';

/** Dollars → integer cents, and back, so a float never accumulates in `raised`. */
const toCents = (dollars: number) => Math.round(dollars * 100);

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  if (!campaignId || !tenantId) {
    return NextResponse.json({ error: 'campaignId and tenantId are required' }, { status: 400 });
  }

  // ── Who is asking ─────────────────────────────────────────────────────────
  // Mirrors firestore.rules' own `hasPermission('manageFundraising', tenantId)`
  // on /campaigns — the same permission the campaign editor's writes already
  // require, so this route opens no door the editor did not already open.
  const authResult = await requireTenantPermission(request, tenantId, 'manageFundraising');
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  // ── 🔴 THE FREE TIER NEVER REACHES THIS ───────────────────────────────────
  //
  // `free.fundraising` is false, which is why /campaign/[id] 404s and
  // /api/stripe/donate 403s for a free tenant (THE-202, THE-213). A campaign
  // total is part of that same surface: a tier with no donate page must not
  // acquire a giving figure it can publish. Refused on the server for the
  // reason the donate route gives — a hidden button is not a gate.
  const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  if (!tenantFeatures(tenantSnap.data()).fundraising) {
    return NextResponse.json(
      { error: 'Fundraising is not available on this plan.' },
      { status: 403 },
    );
  }

  // ── The amount ────────────────────────────────────────────────────────────
  // `Number()` on a trimmed string so an admin's "1,200" style typo arrives as
  // NaN and is refused, rather than `parseFloat`'s "1" silently recording $1.
  const rawAmount = typeof body.amountDollars === 'number'
    ? body.amountDollars
    : typeof body.amountDollars === 'string'
      ? Number(body.amountDollars.trim())
      : NaN;

  if (!Number.isFinite(rawAmount)) {
    return NextResponse.json({ error: BAD_AMOUNT }, { status: 400 });
  }
  // Cents first: 0.004 is not a gift, and rounding after the zero-check would
  // let it through as a no-op write with an audit row attached to nothing.
  const amountCents = toCents(rawAmount);
  if (amountCents === 0) {
    return NextResponse.json({ error: BAD_AMOUNT }, { status: 400 });
  }
  if (Math.abs(amountCents) > toCents(MAX_ADJUSTMENT_DOLLARS)) {
    return NextResponse.json({ error: BAD_AMOUNT }, { status: 400 });
  }
  const amountDollars = amountCents / 100;

  // ── Which provider it came through, if the admin said ─────────────────────
  // Constrained to the THE-246 table so the trail names a provider this build
  // actually defines, and an arbitrary string never lands in a stored document.
  let provider: GivingProviderId | null = null;
  if (body.provider !== undefined && body.provider !== null && body.provider !== '') {
    if (!isGivingProviderId(body.provider)) {
      return NextResponse.json({ error: 'Unknown payment provider' }, { status: 400 });
    }
    provider = body.provider;
  }

  const note = typeof body.note === 'string'
    // Control characters and whitespace runs collapsed, exactly as
    // `sanitizeGivingHandle` does — this is rendered back as a one-line row.
    // eslint-disable-next-line no-control-regex
    ? body.note.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ADJUSTMENT_NOTE_LENGTH)
    : '';

  const campaignRef = adminDb.collection('campaigns').doc(campaignId);

  try {
    // ── 🔴 ONE TRANSACTION ──────────────────────────────────────────────────
    //
    // A transaction rather than the webhook's batch because this one has to READ
    // to decide: the zero floor is a function of the current total, and a batch
    // would evaluate it against a value another writer — a Stripe gift landing
    // mid-request, or a second admin — could already have moved. The write is
    // still `FieldValue.increment`, so it stays additive; the read exists only
    // for the floor.
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(campaignRef);
      if (!snap.exists) return { error: 'Campaign not found', status: 404 } as const;

      const data = snap.data() || {};
      // The same cross-tenant refusal `incrementCampaignRaised` makes: an id
      // from one church must never move another church's total.
      if (data.tenantId !== tenantId) {
        return { error: 'Campaign not found', status: 404 } as const;
      }

      const currentCents = toCents(Number(data.raised) || 0);
      const nextCents = currentCents + amountCents;
      if (nextCents < 0) {
        const current = (currentCents / 100).toFixed(2);
        return {
          error:
            `That would take this campaign below $0. It currently shows $${current} raised, ` +
            `so the most you can take off is $${current}.`,
          status: 400,
        } as const;
      }

      // The audit row and the increment land together or not at all. A total a
      // church cannot reconcile is the thing this feature exists to prevent, so
      // a `raised` that moved with no row explaining it is not an acceptable
      // failure mode — and neither is a row for money that never landed.
      const adjustmentRef = campaignRef.collection('adjustments').doc();
      tx.update(campaignRef, {
        raised: FieldValue.increment(amountDollars),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(adjustmentRef, {
        amountDollars,
        provider,
        providerLabel: provider ? getGivingProvider(provider).label : null,
        note: note || null,
        tenantId,
        campaignId,
        // WHO, and not only how much. A fundraising total is shown publicly and
        // a church that cannot say who moved it cannot answer for it.
        adjustedByUid: user.uid,
        adjustedByEmail: user.email || null,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, raised: nextCents / 100 } as const;
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    console.log(
      `📝 Campaign ${campaignId} manual adjustment ${amountDollars >= 0 ? '+' : ''}$${amountDollars.toFixed(2)} ` +
      `by ${user.email || user.uid} (tenant ${tenantId}, provider ${provider || 'unspecified'})`,
    );
    return NextResponse.json({ success: true, raised: result.raised });
  } catch (error) {
    console.error('Campaign adjustment failed:', error);
    return NextResponse.json({ error: 'Failed to record the gift. Please try again.' }, { status: 500 });
  }
}
