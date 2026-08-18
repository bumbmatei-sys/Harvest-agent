"use client";
import React from 'react';

/**
 * THE-183 — the heading over one region of admin Settings.
 *
 * Settings was a flat list: a plan card, then eight accordion rows in no
 * stated order, then a navigation row — with a destructive action (Cancel
 * Subscription) sitting in the same undifferentiated run as a colour
 * preference. These headings are the grouping, and the danger region's
 * separator rule below is what takes the destructive action out of that run.
 *
 * ── Why every one of them is `hidden sm:block` ───────────────────────────────
 * The founder's position is that the app is fine on a phone, and this PR's
 * entire mobile budget is spent on the one sanctioned exception (the two theme
 * controls moving side by side, matching what PR 347 did on the member
 * Profile). A heading is new, visible, in-flow DOM: rendering it below `sm`
 * would push every row under it down the page, which is exactly the change
 * that is not allowed. The grouping is a fix for a 1440px screen that spent a
 * 1164.5px content box on a 609px column — a desktop problem, so it gets a
 * desktop-gated fix. `AdminSettings.regroup.test.tsx` pins the sub-640px class
 * layer against the extracted baseline so an unprefixed class here fails loudly.
 *
 * ── Why the eyebrow, and not an <h3> from the type scale ─────────────────────
 * `text-[11px] uppercase tracking-[0.16em]` is the eyebrow AdminSettings
 * already draws above its own page title ("Platform"), so this introduces no
 * new font size — and 11px is exactly the floor the type-scale work set, so
 * there is no room below it and no reason to go above: these label a region,
 * they do not compete with the page's <h2>. `--text-faint` is documented in
 * globals.css as the eyebrow ink, and is defined for all four palettes.
 */

interface SectionHeadingProps {
  children: React.ReactNode;
  /** `danger` tones the label for the one destructive region. */
  tone?: 'default' | 'danger';
  /** Layout only — the caller owns the heading's spacing within its region. */
  className?: string;
}

const SectionHeading: React.FC<SectionHeadingProps> = ({
  children,
  tone = 'default',
  className = '',
}) => (
  <p
    // Enumerable by the tests that assert every region carries a heading,
    // without going through the label text (which is copy and may change).
    data-settings-heading={tone}
    className={`hidden sm:block text-[11px] font-semibold uppercase tracking-[0.16em] ${
      tone === 'danger' ? 'text-danger' : 'text-faint'
    } ${className}`}
  >
    {children}
  </p>
);

export default SectionHeading;
