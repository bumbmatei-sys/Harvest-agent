import React from 'react';
import {
  ACTION_HEIGHT as ONBOARDING_ACTION,
  CONTROL_HEIGHT as ONBOARDING_CONTROL,
  ICON_BUTTON,
} from '../../settings/OnboardingSection';
import { CONTROL_DENSITY } from '../../layout/form-layout';
import { NAV_CLEARANCE } from '../../settings/GivingStatementsSection';

/**
 * THE-296 — the panel states a server render cannot reach, for the layout suite.
 *
 * ─── 🔴 Why a fixture at all, and what stops it drifting ────────────────────
 *
 * `IntegrationsSection` is measured AS ITSELF: given `platformOverride`, its
 * first render already draws all three provider cards with their real buttons,
 * so the layout suite mounts the real component and no fixture is involved.
 *
 * `OnboardingSection` cannot be. Its question list arrives from Firestore in an
 * effect, and `renderToStaticMarkup` runs only the initial render — so the real
 * component server-renders to an intro paragraph and one button, and a suite
 * measuring THAT would pass while every row control on the screen was 26px.
 *
 * So the row and the editor are reconstructed here — but every dimension that
 * is actually MEASURED is IMPORTED from the section rather than retyped:
 * ONBOARDING_ACTION, ONBOARDING_CONTROL and ICON_BUTTON are the very strings the
 * shipped component spells. A height regression in the section therefore fails
 * the layout suite through this file; only non-measured scaffolding (the flex
 * wrappers, the labels) is local, and the section's own class strings are
 * pinned against these imports by the guard in the behaviour suite.
 */

/** One question row, in the state that carries the most controls: armed for
 *  delete, so the confirm pair is on screen with the reorder and edit controls. */
export const OnboardingPanelFixture: React.FC = () => (
  <div className={`${CONTROL_DENSITY.sectionGap} space-y-6 ${NAV_CLEARANCE}`}>
    <p className="text-body">
      These are the questions new members see when signing up. Changes save on their own.
    </p>

    <button className={`inline-flex items-center gap-2 px-4 bg-gold text-white rounded-brand text-sm font-medium ${ONBOARDING_ACTION}`}>
      Add Question
    </button>

    <div data-question="q_a" className="bg-surface-sunken rounded-brand border border-line-subtle p-4 flex items-start gap-3">
      <div className="flex flex-col shrink-0">
        <button aria-label="Move First up" className={`text-faint ${ICON_BUTTON}`}>^</button>
        <button aria-label="Move First down" className={`text-faint ${ICON_BUTTON}`}>v</button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-strong">First</span>
          <span className="text-xs bg-surface-chip text-muted px-2 py-0.5 rounded-full">text</span>
        </div>
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-danger-strong">Delete this question?</span>
          <button data-confirm-delete="q_a" className={`px-4 bg-danger text-white rounded-brand text-xs font-semibold ${ONBOARDING_ACTION}`}>Delete</button>
          <button className={`px-4 text-body rounded-brand text-xs font-semibold ${ONBOARDING_ACTION}`}>Cancel</button>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
        <button className={`px-4 text-xs font-semibold text-gold bg-surface-chip rounded-brand ${ONBOARDING_ACTION}`}>Edit</button>
        <button aria-label="Delete First" className={`inline-flex items-center justify-center gap-1 px-4 text-xs font-semibold text-danger-strong bg-danger-tint rounded-brand ${ONBOARDING_ACTION}`}>Delete</button>
      </div>
    </div>

    {/* The editor's own fields, measured in place rather than inside the
        overlay — the overlay's z-order is test 12's question, its controls'
        heights are test 10's, and stacking them would hide these from the
        panel query. */}
    <div className="space-y-4">
      <input id="oq-label" className={`w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm ${ONBOARDING_CONTROL}`} defaultValue="First" />
      <select id="oq-type" className={`w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm ${ONBOARDING_CONTROL}`}>
        <option>Text Input</option>
      </select>
      <button id="oq-required" role="switch" aria-checked="false" className={`${ICON_BUTTON} px-2`}>
        <span className="block w-10 h-6 rounded-full relative bg-surface-chip" />
      </button>
    </div>
  </div>
);

/**
 * The real section, given the one prop that makes all three provider cards
 * render on the first pass. Nothing about it is reconstructed.
 */
export { default as IntegrationsPanelFixture } from './the-296-integrations';
