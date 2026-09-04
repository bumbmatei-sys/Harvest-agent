"use client";
/**
 * THE-294 — the Content tab: slice 5 of 6, and the shortest tab on the
 * dashboard by a wide margin.
 *
 * ═══ 🔴 FOUNDER DECISION, 2026-09-04: DELETE WHAT CANNOT EXIST ══════════════
 *
 * "Then let's remake and delete what's useless."
 *
 * The design package puts four widgets here. THREE OF THEM ARE DELETED — not
 * deferred, not rendered empty, not approximated. They are gone from the widget
 * list entirely, and {@link DELETED_CONTENT_WIDGETS} below records WHY so that
 * a later agent reading the design package does not put them back.
 *
 * ⚠️ THE DISTINCTION THAT DECIDES IT, and it is the whole of this file's
 * reasoning:
 *
 *   · `deferred` PROMISES the thing is coming. The Growth tab's retention
 *     heatmap and geo map are deferred correctly: the data exists
 *     (`contactActivities`, `users.country`) and only the component or the
 *     dependency is missing, so somebody will build them. 🔴 THIS SLICE DOES
 *     NOT TOUCH EITHER — both still render their `deferred` frame on Growth.
 *   · `empty` SAYS THERE IS NOTHING YET, which implies there could be
 *     something later, from the same read, once the ministry does more.
 *   · 🔴 NEITHER IS HONEST ABOUT SOMETHING THAT CANNOT EXIST. A card headed
 *     "Reach" showing "no data yet" tells a founder to wait for a number that
 *     will never arrive, and sends them looking for a setting to switch on.
 *     Deleting it is the truthful option; substituting a proxy metric and
 *     calling it reach is the dishonest one.
 *
 * ─── So the tab holds ONE widget ────────────────────────────────────────────
 *
 * Course completion, as a COUNT. It is real, it is exact over a complete read,
 * and the count is all this data can support — see `CourseCompletion` and
 * `content-data` for why the series the design asked for cannot be built.
 *
 * ⚠️ ONE WIDGET IS THE RIGHT ANSWER RATHER THAN AN EMBARRASSMENT. A tab with
 * one true figure and no filler says more about this product's content
 * analytics than four cards would, three of which would be lying about being
 * temporarily empty.
 */
import React from 'react';

import { CourseCompletion } from './CourseCompletion';
import type { ContentData } from './useContentData';

/**
 * 🔴 THE WIDGETS THAT WERE DELETED, AND WHY. NOT A RENDER LIST.
 *
 * ⚠️ NOTHING BELOW IS RENDERED, and nothing may be. This table exists so the
 * decision is written down at the place a future reader would otherwise re-add
 * these from the design package, and so a test can assert their titles appear
 * NOWHERE in this tab's output — not as a card, not as a deferred frame, not as
 * a placeholder. A guard test also asserts this file mounts exactly one widget.
 *
 * 🔴 THE DESIGN'S WIDGET LIST IS NOT THE AUTHORITY. THE DATA MODEL IS. Each
 * entry below was checked against the code that writes the documents, not
 * against what a dashboard would look nice showing.
 */
export const DELETED_CONTENT_WIDGETS = Object.freeze([
  {
    id: 'reach',
    title: 'Reach and impressions',
    why:
      'Nothing anywhere records it. No Firestore document carries an impression, ' +
      'a view or a reach figure for an article, a sermon or a page — and the ' +
      'product analytics do not either: they record route PATTERNS rather than ' +
      'which article was opened, so they cannot attribute a view to a piece of ' +
      'content. This is not a read that has not been written yet; it is a ' +
      'tracking system that does not exist. No amount of later work makes it ' +
      'readable without building one.',
  },
  {
    id: 'blog-views',
    title: 'Blog view counts',
    why:
      'A blog_posts document has no view, read or impression field, and no ' +
      'write path anywhere increments one. A count here could only be invented.',
  },
  {
    id: 'completions-over-time',
    title: 'Course completions over time',
    why:
      'Completion is derived, not recorded: verifyCourseCompletion asks whether ' +
      'every lesson id of a course is in the member’s completedLessons, and ' +
      'completedLessons records WHAT is finished and never WHEN. There is no ' +
      'completedAt field, no completions collection and no event. The CURRENT ' +
      'COUNT is buildable and ships as the one widget on this tab; the series ' +
      'cannot exist without a new timestamp being written from now on, and it ' +
      'would still say nothing about the past.',
  },
] as const);

export function ContentTab({ content }: { readonly content: ContentData }) {
  return (
    <div className="space-y-4" data-content-tab>
      {/*
        🔴 THE ONLY WIDGET. Do not add a card for anything in
        DELETED_CONTENT_WIDGETS — read the table above first; each entry names
        the field that does not exist, and an empty card for one of them is a
        promise this product cannot keep.
      */}
      <CourseCompletion
        summary={content.completion}
        reason={content.loading ? null : content.completionReason}
      />
    </div>
  );
}
