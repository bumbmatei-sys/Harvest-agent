import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireOwner } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { resolveDodoSubscriptionContext } from '@/lib/dodo/billing-context';
import {
  dodoTrialEndsAt,
  describeOfferableAddons,
  isAddonChangeRefusal,
  isDodoAddonMeaning,
  resolveDesiredAddons,
  MAX_ADDON_QUANTITY,
  type DodoAddonChange,
} from '@/lib/dodo/addon-purchase';
import {
  describeDodoAddons,
  executeDodoPlanChange,
  isDodoSubscriptionInTrial,
  previewDodoPlanChange,
  readHeldDodoAddons,
  retrieveDodoAddon,
  retrieveDodoSubscription,
  type DodoNamedAddon,
  type DodoSubscriptionLike,
} from '@/lib/dodo/dodo-provider';

/**
 * `/api/dodo/addons` — buying, re-quantifying and dropping an add-on (REP-5b).
 *
 * REP-5a made an add-on MEAN something: the webhook writes a set of meanings to
 * `tenants/{id}` and `getEffectiveFeatures` layers them over the tier. Nothing
 * could BUY one. This is the route that can.
 *
 * ─── Why a sibling route and not an extension of `change-plan` ───────────────
 *
 * `/api/dodo/change-plan` already computes an add-on carry-over internally, so
 * teaching it to accept a selection looks like the smaller change. It is not,
 * and the deciding reasons are both about refusals rather than about plumbing:
 *
 *  1. 🔴 `change-plan` refuses `plan === current.plan` with a 400 ("already on
 *     this plan"), and that refusal is CORRECT for a tier change — it is how a
 *     no-op upgrade is caught. But buying an add-on without moving tier is
 *     definitionally a same-plan call. Extending the route would mean making
 *     that 400 conditional on whether an optional field happened to be present,
 *     which turns a flat guard on a money path into a branch.
 *  2. 🔴 THE TRIAL POLICY DIFFERS, deliberately (see below). Two different
 *     answers to "may this run during the trial", selected by the shape of the
 *     request body, inside one handler, is precisely the kind of conditional
 *     that gets mis-edited later — and the cost of getting it wrong is charging
 *     a church early with no refund available.
 *
 * Nothing is duplicated to get that separation. The owner gate, the ownership
 * check, the failed-renewal guard and the current-product resolution are ONE
 * implementation shared with `change-plan` (`@/lib/dodo/billing-context`), and
 * the Dodo calls are the same `previewDodoPlanChange` / `executeDodoPlanChange`
 * pair. What is separate is only what genuinely differs.
 *
 * ─── Two-phase: preview, then confirm ────────────────────────────────────────
 *
 * Without `confirm: true` this route only PREVIEWS: it returns what Dodo would
 * charge now, and nothing is billed. With `confirm: true` it performs the
 * change. 🔴 The `addons` array is computed ONCE, above the branch, and handed
 * to both calls — add-ons are inside Dodo's proration calculation, so a set that
 * differed between the two would make the quoted amount and the charged amount
 * different numbers.
 *
 * ─── 🔴 THE SAME PRODUCT, THE TENANT'S OWN PERIOD ────────────────────────────
 *
 * Adding an add-on is a `changePlan` call with the product the tenant is ALREADY
 * on and a modified `addons` array. The plan and the period both come from
 * `resolveDodoSubscriptionContext` — read from the tenant's recorded product —
 * and never from the request body. A body-supplied period could name the other
 * period's product, which is a different Dodo product: the church would be
 * switched from monthly to annual billing as a side effect of buying a $10 seat.
 * `change-plan` refuses a cross-period request (THE-88); this route cannot form
 * one.
 *
 * ─── What this route deliberately does NOT do ────────────────────────────────
 *
 *  • It writes NOTHING to Firestore. `subscription.plan_changed` is the single
 *    writer of `plan` and of the add-on set — and it is Dodo's add-on-change
 *    event too, so an add-on bought here arrives there. #319 already taught its
 *    already-applied short-circuit to compare the add-on set, so a purchase with
 *    no tier change is no longer swallowed as a duplicate.
 *  • It never gates on tier. Which add-ons a plan may hold is enforced by Dodo,
 *    on the product (THE-133) — "Contacts +500" is not attached to the
 *    Individual products and "Unlimited Contacts" only to Ministry. That
 *    restriction lives in the payment processor precisely so a Harvest bug
 *    cannot sell Unlimited Contacts to a $49 plan, so this route sends what was
 *    asked for and lets Dodo refuse it.
 *  • It never accepts or emits a Dodo add-on id. The wire vocabulary is the five
 *    MEANINGS; see `@/lib/dodo/addon-purchase`.
 */

export const dynamic = 'force-dynamic';

/**
 * 🔴 REFUSED DURING THE 14-DAY TRIAL — the decision, and why it is not simply
 * inherited from `change-plan`.
 *
 * The tempting answer is to allow it. A church setting up during its trial is
 * exactly when it adds an admin seat, and refusing a $10 purchase for two weeks
 * reads as obstruction. That reasoning is what this comment exists to answer.
 *
 * ⚠️ AN ADD-ON PURCHASE DURING A TRIAL IS NOT A $10 EVENT. Every Dodo proration
 * mode ends a trial, and this build's mode is `prorated_immediately`, so
 * confirming a $10 admin seat on day 3 of 14 would:
 *
 *   • end the free trial there and then,
 *   • charge the FULL plan price immediately (the $49–$199 tier, prorated from
 *     that moment) plus the add-on, not the $10 the button said, and
 *   • forfeit the remaining eleven days the church was promised.
 *
 * So the thing being consented to is five to twenty times the price of the item
 * clicked, plus the loss of service already promised. Harvest issues NO REFUNDS,
 * which makes that unrecoverable. The refusal is entirely recoverable: the same
 * purchase is one click away the day the trial ends, at the price advertised,
 * with nothing lost.
 *
 * The brief for this route required that an add-on purchase must not SILENTLY
 * end a trial. Not ending it is the strongest form of that guarantee — and it
 * avoids resting an irreversible charge on whether someone read a dialog.
 *
 * ⚠️ REMOVAL IS REFUSED TOO, by the same guard. Dropping an add-on is also a
 * `changePlan` call and also ends the trial, so allowing it would charge a
 * church for its whole plan as a consequence of trying to spend less. Nothing is
 * being billed during the trial anyway, so waiting costs them nothing.
 *
 * The refusal names the DAY they can come back whenever that day is knowable —
 * see `dodoTrialEndsAt` for when it is not.
 */
const TRIAL_REFUSAL_CODE = 'addon-change-unavailable-during-trial';

/** The changes a request is asking for, or the 400 that says why it is not readable. */
function readChanges(raw: unknown): DodoAddonChange[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'Missing required field: addons (a non-empty list of add-on changes).';
  }
  const changes: DodoAddonChange[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const meaning = (entry as { addon?: unknown })?.addon;
    const quantity = (entry as { quantity?: unknown })?.quantity;
    if (!isDodoAddonMeaning(meaning)) {
      return `Unknown add-on: ${String(meaning)}`;
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
      return `Invalid quantity for ${meaning}.`;
    }
    // One meaning twice in one request has no single answer — the second entry
    // would silently win. Refused rather than resolved.
    if (seen.has(meaning)) return `${meaning} was listed more than once.`;
    seen.add(meaning);
    changes.push({ meaning, quantity });
  }
  return changes;
}

/**
 * GET — the add-ons this build can sell, named and priced by Dodo.
 *
 * 🔴 THE LIST IS DERIVED FROM THE ACTIVE ADD-ON TABLE, never written out. An
 * add-on with no id in the running environment is absent from this response, so
 * it cannot be rendered and cannot be bought. Live Campus is that case today:
 * its two ids were never recorded, and until they are, Campus is simply not on
 * this list. Filling them in `catalogue.ts` makes it appear with no other edit.
 *
 * Prices come from Dodo on every request and are never stored in this repo.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = new URL(request.url).searchParams.get('tenantId') || '';
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    // The same three identities `change-plan` admits, via the same helper: what
    // an organisation is offered to buy is owner-visible information.
    const ownerOrErr = await requireOwner(request, { tenantId });
    if (ownerOrErr instanceof NextResponse) return ownerOrErr;

    const context = await resolveDodoSubscriptionContext({
      tenantId: ownerOrErr.tenantId,
      action: 'viewing your add-ons',
      step: 'dodo-addons-unknown-current-product',
      blockedPhrase: 'your add-ons cannot be changed',
      retryPhrase: 'change your add-ons',
    });
    if (context instanceof NextResponse) return context;

    const offerable = await describeOfferableAddons(context.period, retrieveDodoAddon);
    return NextResponse.json({
      billing: context.period,
      plan: context.plan,
      addons: offerable,
    });
  } catch (error: any) {
    console.error('Dodo add-on catalogue error:', error?.message || error);
    captureMoneyPathError(error, { step: 'dodo-addons-catalogue', level: 'error' });
    return NextResponse.json(
      { error: 'We could not load the available add-ons just now. Please try again in a few minutes.' },
      { status: 503 },
    );
  }
}

/**
 * POST — preview an add-on change, then perform it on `confirm: true`.
 *
 * Body: `{ tenantId, addons: [{ addon: <meaning>, quantity: n }], confirm? }`
 * where `quantity` is the DESIRED total for that meaning and `0` removes it.
 * Removal is the same exchange as a purchase, previewed the same way.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, addons: rawAddons, confirm } = body ?? {};

    if (!tenantId || typeof tenantId !== 'string') {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    // 🔴 THE GATE, from THE-80 and unchanged here: the owner, the roster admin,
    // and the super admin. Buying something on an organisation's subscription is
    // an owner act, exactly as changing its tier is; an ordinary tenant admin
    // gets 403 here for the same reason they do on `change-plan`.
    const ownerOrErr = await requireOwner(request, { tenantId });
    if (ownerOrErr instanceof NextResponse) return ownerOrErr;

    const changes = readChanges(rawAddons);
    if (typeof changes === 'string') {
      return NextResponse.json({ error: changes }, { status: 400 });
    }

    const context = await resolveDodoSubscriptionContext({
      tenantId: ownerOrErr.tenantId,
      action: 'changing your add-ons',
      step: 'dodo-addons-unknown-current-product',
      blockedPhrase: 'your add-ons cannot be changed',
      retryPhrase: 'change your add-ons',
    });
    if (context instanceof NextResponse) return context;

    // ── 🔴 NO ADD-ON CHANGES DURING THE TRIAL. See TRIAL_REFUSAL_CODE above. ──
    // Checked on the preview AND on the confirm — the confirm is the one that
    // charges, and a preview that quoted a price for a change that cannot happen
    // would be its own small lie. A failure to determine trial status refuses
    // too: uncertainty about whether a church will be charged early is resolved
    // by not charging.
    let subscription: DodoSubscriptionLike;
    let inTrial: boolean;
    try {
      // Retrieved ONCE and used three times: the trial check reads its dates,
      // the refusal copy reads its trial end, and the fold below reads what it
      // holds. The confirm path grows no extra subscription read.
      subscription = await retrieveDodoSubscription(context.subscriptionId);
      inTrial = await isDodoSubscriptionInTrial(context.subscriptionId, subscription);
    } catch (trialErr) {
      captureMoneyPathError(trialErr, {
        step: 'dodo-addons-trial-check',
        level: 'error',
        tenantId: ownerOrErr.tenantId,
        ids: { subscriptionId: context.subscriptionId },
      });
      return NextResponse.json(
        { error: 'We could not verify your billing status just now. Please try again in a few minutes.' },
        { status: 503 },
      );
    }

    if (inTrial) {
      const endsAt = dodoTrialEndsAt(subscription);
      const when = endsAt
        ? `on ${new Date(endsAt).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          })}`
        : 'as soon as your free trial ends';
      return NextResponse.json(
        {
          error:
            `Your free trial is still running. Adding or removing an add-on now would end the trial early and charge you for your whole plan today, not just the add-on — so add-on changes are disabled until the trial ends. You can make this change ${when}.`,
          code: TRIAL_REFUSAL_CODE,
          ...(endsAt ? { trialEndsAt: endsAt } : {}),
        },
        { status: 409 },
      );
    }

    // ── The set to send, computed ONCE for the preview and the confirm. ──────
    //
    // 🔴 A FAILURE TO READ WHAT IS HELD REFUSES. "No add-ons" and "could not
    // determine the add-ons" are different facts, and folding a change over `[]`
    // for the second would delete everything a church pays for on the strength
    // of a network error. `readHeldDodoAddons` throws rather than guessing.
    let resolved;
    try {
      resolved = resolveDesiredAddons(readHeldDodoAddons(subscription), changes, context.period);
    } catch (readErr) {
      captureMoneyPathError(readErr, {
        step: 'dodo-addons-read-held',
        level: 'error',
        tenantId: ownerOrErr.tenantId,
        ids: { subscriptionId: context.subscriptionId },
      });
      return NextResponse.json(
        { error: 'We could not check the add-ons on your subscription just now, so nothing was changed. Please try again in a few minutes.' },
        { status: 503 },
      );
    }

    if (isAddonChangeRefusal(resolved)) {
      if (resolved.reason === 'quantity-too-large') {
        return NextResponse.json(
          {
            error: `You can buy at most ${MAX_ADDON_QUANTITY} of one add-on here. Please contact support if you need more.`,
            code: 'addon-quantity-too-large',
          },
          { status: 400 },
        );
      }
      // 🔴 NOT OFFERABLE IN THIS ENVIRONMENT — the live Campus guard. The church
      // is told plainly rather than charged for something this build could not
      // grant them afterwards. Reported, because an offer surface that produced
      // this request has drifted from the catalogue it is supposed to be driven
      // by, and that is worth knowing about.
      captureMoneyPathError(
        new Error(
          `[dodo] add-on "${resolved.meaning}" was requested but has no id in the active environment; ` +
            'it is not offerable and the request was refused before any charge.',
        ),
        {
          step: 'dodo-addons-unmapped-requested',
          level: 'warning',
          tenantId: ownerOrErr.tenantId,
          ids: { subscriptionId: context.subscriptionId, meaning: resolved.meaning },
        },
      );
      return NextResponse.json(
        {
          error: 'That add-on is not available for purchase yet. Please contact support and we will set it up for you.',
          code: 'addon-not-available',
        },
        { status: 400 },
      );
    }

    if (confirm !== true) {
      // Names cost a call each and are only ever shown, so they are fetched on
      // the preview and never on the confirm. By NAME, always:
      // `adn_0NlKtwD3VfBLgx2LTw69O` is not a thing a church can weigh a decision
      // against; "Unlimited Contacts" is.
      let addOnsAfter: DodoNamedAddon[] = [];
      let addOnsRemoved: DodoNamedAddon[] = [];
      try {
        [addOnsAfter, addOnsRemoved] = await Promise.all([
          describeDodoAddons(resolved.changed),
          describeDodoAddons(resolved.removed),
        ]);
      } catch (nameErr) {
        captureMoneyPathError(nameErr, {
          step: 'dodo-addons-describe',
          level: 'error',
          tenantId: ownerOrErr.tenantId,
          ids: { subscriptionId: context.subscriptionId },
        });
        return NextResponse.json(
          { error: 'We could not describe those add-ons just now, so nothing was changed. Please try again in a few minutes.' },
          { status: 503 },
        );
      }

      // Preview only. Nothing has been charged and nothing has changed.
      const preview = await previewDodoPlanChange(
        context.subscriptionId,
        context.plan,
        context.period,
        resolved.desired,
      );
      return NextResponse.json({
        preview: {
          amountDueNow: preview.amountDueNow,
          creditMovement: preview.creditMovement,
          currency: preview.currency,
          billing: context.period,
          addOnsAfter,
          addOnsRemoved,
        },
      });
    }

    // The real thing. `on_payment_failure: 'prevent_change'` is set inside — a
    // failed payment leaves the church exactly where it was. The tenant's
    // `addons` set is NOT written here: the `subscription.plan_changed` webhook
    // is the single writer, and it fires only when the change actually took.
    await executeDodoPlanChange(
      context.subscriptionId,
      context.plan,
      context.period,
      resolved.desired,
    );

    return NextResponse.json({
      ok: true,
      message: 'Your add-on change is confirmed. It may take a moment to appear.',
    });
  } catch (error: any) {
    console.error('Dodo add-on change error:', error?.message || error);
    captureMoneyPathError(error, { step: 'dodo-addons-change', level: 'error' });
    return NextResponse.json(
      { error: error?.message || 'Failed to change add-ons' },
      { status: 500 },
    );
  }
}
