"use client";
import React from 'react';

/**
 * ModalContentContainer — the one content column the full-screen modals share.
 *
 * Contact, FAQ and Privacy & Terms are not dialogs. They are route-like
 * overlays: `fixed inset-0` + `bg-surface`, sliding up over the whole viewport
 * with their own back-arrow header. That shape was drawn for a phone, where the
 * viewport IS the measure, so their scroll body carried nothing but `p-4` and
 * the content took whatever width it was given. On a desktop monitor that is
 * the founder's report — body copy and accordion rows running the full width of
 * the screen with no container and no border.
 *
 * A dialog would be fixed by putting its max-width back. An overlay has no
 * max-width to restore, so the constraint has to come from inside: this
 * component. It is deliberately closed — no `className`, no `width` prop, no
 * variants. The defect began with one surface looking different from its
 * siblings, and a knob here is how that comes back. Every modal gets the same
 * column or the guard in `modal-content-surface.test.tsx` fails.
 *
 * Mobile is preserved exactly rather than merely "checked". Below `sm` the
 * gutter is `px-4 pt-4 pb-12` — the same box the three modals already had — and
 * the surface element contributes nothing: no padding, no border, no
 * background. At 380px the content measures 348px, which is what it measured
 * before this component existed. The card only appears from 640px up, where
 * there is room for it.
 *
 * The two elements are separate on purpose. Merging them would put the page
 * gutter and the card's own padding on one box, so the card would run edge to
 * edge at exactly 640px — the narrowest width at which it is visible.
 */
const ModalContentContainer = ({ children }: { children: React.ReactNode }) => (
  <div
    data-modal-container="gutter"
    className="mx-auto w-full max-w-2xl px-4 pt-4 pb-12 sm:px-6 sm:pt-6 sm:pb-16"
  >
    <div
      data-modal-container="surface"
      className="sm:rounded-brand-xl sm:border sm:border-line sm:bg-surface-raised sm:p-6 sm:shadow-sm"
    >
      {children}
    </div>
  </div>
);

export default ModalContentContainer;
