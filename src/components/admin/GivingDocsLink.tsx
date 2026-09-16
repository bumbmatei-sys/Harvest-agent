"use client";
import React from 'react';
import { BookOpen } from 'lucide-react';

import { CONTROL_DENSITY } from '../layout/form-layout';

/**
 * THE-368 — the ONE way an admin screen links the giving documentation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A COMPONENT AND NOT AN ANCHOR WRITTEN OUT PER SCREEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THE-340 FOUND ELEVEN INLINED COPIES of a Resend send, none of them a
 * function, and the cost was not duplication — it was that the eleven had
 * DRIFTED, so "how does this app send mail" had eleven answers. Seven screens
 * link the giving docs here. Written out seven times, the seventh would differ
 * from the first the moment anybody touched one, and "one treatment" would be a
 * claim a guard has to police across seven files rather than a fact.
 *
 * 🔴 AND THE PAGE IS CHOSEN FROM A CLOSED SET, NOT PASSED AS A URL. A surface
 * names a `page`; the href is looked up here. A screen therefore CANNOT point
 * at a typo, at a page that does not exist, or at a fourth page — the union
 * type refuses it at compile time. That is the difference between a guard that
 * checks every URL is well-formed and a design in which a malformed one cannot
 * be written.
 *
 * ── The three pages, and who each is for ────────────────────────────────────
 *
 * They are NOT interchangeable, and a link to the wrong one is worse than no
 * link: it teaches people the docs are noise. Each answers the question a
 * person actually has ON THE SCREEN that carries it.
 *
 *   · `howGivingWorks`  — Harvest never touches the money; the church collects
 *                         it. For somebody meeting giving for the first time.
 *   · `theMoneyFlow`    — both routes in, and what each one updates. For
 *                         somebody reconciling, or wondering why a figure looks
 *                         wrong.
 *   · `recordingAGift`  — the exact steps, and the email-match caveat. For
 *                         whoever does the weekly entry.
 *
 * ── The label is DERIVED, never passed ──────────────────────────────────────
 *
 * ⚠️ A `label` prop would be a second axis of drift: two screens linking the
 * same page under different names read as two different destinations. The label
 * is the docs page's own title, held beside its href, so the link says where it
 * goes and every screen says it identically.
 *
 * ── The treatment ───────────────────────────────────────────────────────────
 *
 * 🔴 IT MUST NOT COMPETE WITH THE SCREEN'S OWN CONTENT. A church opens these
 * screens to do a job; this is a reference somebody reaches for when a figure
 * surprises them. So it is a quiet text link with an icon — `text-muted`
 * resolving to `text-body` on hover — and deliberately NOT a `Button`, NOT a
 * card and NOT a banner. #502 put a `BookOpen` Documentation row in the account
 * menu and this matches it: same icon, same weight of voice, same `<a>`.
 *
 * 🔴 AN <a>, WITH target="_blank" AND rel="noopener". This leaves the app for
 * another origin: the admin's place in the app survives, and the opened page
 * gets no `window.opener` handle back on it. Because the navigation is the
 * anchor's own rather than a click handler's, it still works middle-clicked and
 * opened from the keyboard, which a button with an `onClick` would not.
 *
 * 🔴 BOTH HEIGHT FLOORS, AND NEITHER IS A NEW NUMBER. `min-h-11` is 44px, the
 * tappable floor below `sm` (#500); `sm:min-h-0` releases it and
 * `CONTROL_DENSITY.control` fixes the box at Rule 4's 38px above. `Button`'s
 * intrinsic sizes are 24/28/32/36px — every one below BOTH floors — which is
 * the other reason this is not a `Button`. The density token is IMPORTED rather
 * than respelled, so this control cannot drift from the rule it obeys.
 *
 * ⚠️ NO COLOUR IS HARDCODED: `text-muted` and `text-body` are palette tokens
 * that resolve per theme. A hex here would paint the same in all four palettes.
 */

/**
 * The three pages, each with the title the docs site gives it.
 *
 * 🔴 THE HREF AND THE LABEL LIVE TOGETHER. Splitting them into two maps is how
 * a link ends up pointing at one page under another page's name.
 *
 * 🔴 EACH URL IS WRITTEN OUT IN FULL, AND THAT IS NOT AN OVERSIGHT. The obvious
 * spelling is an origin constant plus a template literal per page, and it was
 * written that way first. It is worse twice over: a reader auditing where a
 * link goes has to assemble the answer in their head, and — measured — the
 * sweep that proves these URLs exist in exactly ONE module found NOTHING,
 * because no file contained the string it was looking for. A URL split across
 * a template is a URL a grep cannot see, so a hand-written copy elsewhere in
 * the tree would have gone unnoticed by the guard written to catch it.
 */
export const GIVING_DOCS = {
  howGivingWorks: {
    href: 'https://docs.theharvest.site/giving/how-giving-works',
    label: 'How giving works',
  },
  theMoneyFlow: {
    href: 'https://docs.theharvest.site/giving/the-money-flow',
    label: 'The money flow',
  },
  recordingAGift: {
    href: 'https://docs.theharvest.site/giving/recording-a-gift',
    label: 'Recording a gift',
  },
} as const;

/** The closed set of pages an admin surface may link. */
export type GivingDocsPage = keyof typeof GIVING_DOCS;

/**
 * The one treatment, used on every surface that links the giving docs.
 *
 * `className` is for POSITION ONLY — the margin that seats the link in its
 * host — and never for restyling it. The appearance is this component's.
 */
export const GivingDocsLink: React.FC<{
  page: GivingDocsPage;
  className?: string;
}> = ({ page, className = '' }) => {
  const { href, label } = GIVING_DOCS[page];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      data-giving-docs-link={page}
      className={`inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 ${CONTROL_DENSITY.control} text-sm text-muted hover:text-body transition-colors ${className}`}
    >
      <BookOpen size={14} className="shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </a>
  );
};

export default GivingDocsLink;
