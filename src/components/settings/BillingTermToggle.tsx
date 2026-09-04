'use client';

import React from 'react';
import {
  ADVERTISED_DISCOUNT_PCT,
  BILLING_TERMS,
  discountClaim,
  type BillingTerm,
  type DiscountedTerm,
} from '../../utils/plan-features';


/** The label each term wears. Written once; both plan surfaces render these. */
const TERM_LABELS: Readonly<Record<BillingTerm, string>> = Object.freeze({
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
});

function isDiscounted(term: BillingTerm): term is DiscountedTerm {
  return term !== 'monthly';
}

/**
 * The term picker — Monthly / Quarterly / Yearly, one segment each.
 *
 * ─── 🔴 WHY THE BADGE IS INSIDE THE SEGMENT ──────────────────────────────────
 *
 * The two-term version of this control hung its discount badge off the segment
 * with `absolute -top-2 -right-2`. An absolutely-positioned child is outside its
 * parent's layout entirely: it contributes nothing to the track's width and
 * overhangs the rounded container on both axes. With two segments there was
 * slack to overhang into. With THREE there is not, and PR 361 already fixed one
 * clip on these cards at 1120px — reintroducing an overhanging child is how that
 * comes straight back.
 *
 * So the badge is a second LINE inside the button, in normal flow. It is
 * measured, it is inside the border, and it cannot overhang anything.
 *
 * ─── How three segments are made to fit ──────────────────────────────────────
 *
 * `grid-cols-3` over a full-width track, every column `minmax(0, 1fr)` via
 * `min-w-0`. There is no fixed segment width and no `whitespace-nowrap` on a
 * label that could force one, so the track is exactly as wide as its container
 * at every viewport and the three columns split it evenly. The narrowest case
 * measured is 380px, where each segment is ~110px against a ~58px label — the
 * control has slack rather than fitting exactly, which is what stops the next
 * font-size change from clipping it.
 *
 * Nothing here drops below 11px: labels are 12px, badges 11px.
 */
export function BillingTermToggle({
  value,
  onChange,
}: {
  value: BillingTerm;
  onChange: (term: BillingTerm) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        data-testid="billing-term-toggle"
        role="tablist"
        aria-label="Billing term"
        className="grid grid-cols-3 gap-1 w-full max-w-md mx-auto bg-surface-tint rounded-2xl p-1"
      >
        {BILLING_TERMS.map((term) => {
          const selected = term === value;
          return (
            <button
              key={term}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid="billing-term-segment"
              data-term={term}
              onClick={() => onChange(term)}
              /* `min-w-0` is load-bearing: a grid item's default `min-width:auto`
                 refuses to shrink below its content, which is exactly how a third
                 segment pushes a track wider than its container. */
              /* THE-300 — ⚠️ NO TOUCH FLOOR IS SPELLED HERE, AND THAT IS A
                 MEASURED RESULT, NOT AN OVERSIGHT.

                 A draft of this ticket added `min-h-[44px]` to this segment on
                 the reasoning that Monthly carries no discount badge and is
                 therefore the shortest of the three. Measured in Chromium at
                 380px, that is simply not true: the track is `grid-cols-3` and
                 a grid item's default `align-items: stretch` already sizes all
                 three to the tallest row content, so every segment renders
                 44.75px WITH the floor and 44.75px WITHOUT it. The floor was a
                 no-op, and the mutation that removed it changed nothing —
                 which is how it was caught.

                 So it is gone rather than kept as decoration. The property is
                 real and is asserted where it can actually be observed: the
                 layout suite measures all three segments at 380px. A class that
                 changes no pixel is a claim a reader will trust and a later
                 ticket will preserve for no reason.

                 ⚠️ `transition-colors`, not `transition-all`, IS a real change:
                 only the fill and the ink move on selection, and a transition
                 over `all` animates height and width too — which is what makes
                 an immediate post-resize measurement a lie (THE-295 read
                 1018px against a real 224px on exactly that). */
              className={`min-w-0 px-2 py-2 rounded-xl text-[12px] font-semibold leading-tight transition-colors ${
                selected ? 'bg-surface-raised text-strong shadow-xs' : 'text-muted hover:text-body'
              }`}
            >
              <span className="block">{TERM_LABELS[term]}</span>
              {isDiscounted(term) && (
                <span
                  data-testid="billing-term-badge"
                  data-term={term}
                  /* THE-300 — this badge and the claim line below it used a
                     NUMBERED Tailwind palette class: one fixed hue across all
                     four palettes, and Classic (the default since #409) is the
                     one it was never checked against. `text-gold` is the tenant
                     accent the rest of this control already speaks, and it is
                     what THE-296 reached for when it took the same numbered
                     class out of IntegrationsSection. */
                  /* ⚠️ The dimming is `opacity-80`, NOT an opacity modifier on
                     the colour itself. `--brand-color` is a plain custom
                     property rather than rgb channels, so a Tailwind slash
                     suffix on a variable-backed token produces an invalid
                     colour — `theming-gaps.test.ts` bans it everywhere for
                     exactly that reason, and it reads RAW source, so this note
                     must not spell the form it forbids either. Element opacity
                     dims the same span by the same amount and is not a colour
                     utility at all. */
                  className={`block text-[11px] font-bold text-gold ${selected ? '' : 'opacity-80'}`}
                >
                  {`−${ADVERTISED_DISCOUNT_PCT[term]}%`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* The claim, in words, for the selected term. `discountClaim` decides
          whether it may be stated flat or has to say "up to" — from the prices,
          so the sentence cannot outlive them. Monthly claims nothing. */}
      {isDiscounted(value) && (
        <p data-testid="billing-term-claim" className="text-center text-[12px] text-gold font-medium">
          {`${discountClaim(value)} against paying monthly.`}
        </p>
      )}
    </div>
  );
}
