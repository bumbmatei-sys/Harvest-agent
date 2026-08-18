"use client";
import React, { useState, useCallback, ReactNode, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import SectionHeading from './SectionHeading';

interface SettingsSection {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  hidden?: boolean;
  /** Render the row in the danger tone (e.g. Cancel Subscription). */
  danger?: boolean;
  /**
   * THE-183 — the named region this row sits under. A heading is drawn once,
   * above the first VISIBLE row carrying a given label, so a group whose rows
   * are all plan-gated away leaves no orphan heading behind.
   *
   * Grouping is expressed here rather than by splitting the screen into one
   * accordion per region deliberately: `expanded` is a single piece of state,
   * so exactly one row is open at a time across the whole screen, and
   * `forceOpen` (the Stripe Connect return) can still reach any row by id.
   * Five accordions would have been five independent open-states and five
   * places for forceOpen to miss — a behaviour change, and this PR changes no
   * behaviour.
   *
   * Consecutive rows sharing a label form one region, so the region order IS
   * the array order. Nothing here reorders anything.
   */
  group?: string;
}

interface SettingsAccordionProps {
  sections: SettingsSection[];
  defaultOpen?: string;
  /** Controlled: external section to expand (e.g. from Stripe return URL) */
  forceOpen?: string | null;
}

/**
 * Regions, and why the nesting is shaped the way it is.
 *
 * Below `sm` the rendering has to be byte-identical to the flat list it
 * replaces, and the flat list was one `space-y-2.5` container with a 10px gap
 * between every row. The obvious nesting — heading and rows together inside one
 * `space-y-2.5` region wrapper — does NOT preserve that: `space-y` keys off
 * `:not([hidden]) ~ :not([hidden])`, which counts a `.hidden` (display:none)
 * heading as a sibling, so the first row of every region would pick up a second
 * 10px margin on a phone and each group would sit 20px below the last.
 *
 * So the heading sits OUTSIDE the row list: region wrapper → [heading, rows
 * container]. On a phone the heading has no box, the wrapper carries no
 * spacing of its own, and the two `space-y-2.5` levels compose to the same
 * uniform 10px the flat list had. From `sm` up the outer container switches to
 * Rule 4's section gap and the headings appear.
 */
const SettingsAccordion: React.FC<SettingsAccordionProps> = ({ sections, defaultOpen, forceOpen }) => {
  const [expanded, setExpanded] = useState<string | null>(defaultOpen || null);

  // Allow external control (e.g. Stripe return URL opens a specific section)
  useEffect(() => {
    if (forceOpen) setExpanded(forceOpen);
  }, [forceOpen]);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  // Consecutive visible rows with the same `group` label become one region.
  // Rows with no label keep the flat behaviour and are appended to whatever
  // region is open, so an ungrouped screen renders exactly as it did before.
  const visible = sections.filter(s => !s.hidden);
  const regions: Array<{ label?: string; danger: boolean; rows: SettingsSection[] }> = [];
  for (const section of visible) {
    const last = regions[regions.length - 1];
    if (!last || (section.group !== undefined && section.group !== last.label)) {
      regions.push({ label: section.group, danger: !!section.danger, rows: [section] });
    } else {
      last.rows.push(section);
    }
  }

  const row = (section: SettingsSection) => (
    <div
      key={section.id}
      // Lets a test find a ROW by its id and see whether it is expanded,
      // without reaching through the section content's own markup.
      data-settings-row={section.id}
      className="bg-surface-raised rounded-brand border border-line shadow-[var(--ds-sh-sm)] overflow-hidden"
    >
      <button
        onClick={() => toggle(section.id)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors text-left"
      >
        <span className={`flex items-center shrink-0 ${section.danger ? 'text-danger' : 'text-gold'}`}>{section.icon}</span>
        <span className={`flex-1 text-sm font-semibold ${section.danger ? 'text-danger' : 'text-strong'}`}>{section.label}</span>
        <ChevronDown
          size={16}
          className={`text-faint transition-transform ${expanded === section.id ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded === section.id && (
        <div className="px-5 py-4 border-t border-line">
          {section.content}
        </div>
      )}
    </div>
  );

  return (
    // `sm:space-y-[28px]` is Rule 4's sectionGap, verbatim from form-layout.ts —
    // the gap BETWEEN regions. Within a region the rows keep their own 10px.
    <div className="space-y-2.5 sm:space-y-[28px]">
      {regions.map((region, i) => (
        <div
          key={region.label ?? `ungrouped-${i}`}
          className={
            // The destructive region is cordoned off, not merely placed last:
            // a hairline rule plus a full section gap of padding above it, on
            // top of the section gap the container already puts between
            // regions. 28px is Rule 4's sectionGap number and nothing new —
            // "the danger separator uses the settled section gap" pins it
            // against DENSITY_PX.sectionGap.
            region.danger ? 'sm:border-t sm:border-line sm:pt-[28px]' : undefined
          }
          data-settings-region={region.label ?? 'ungrouped'}
        >
          {region.label !== undefined && (
            <SectionHeading tone={region.danger ? 'danger' : 'default'} className="sm:mb-2.5">
              {region.label}
            </SectionHeading>
          )}
          <div className="space-y-2.5">{region.rows.map(row)}</div>
        </div>
      ))}
    </div>
  );
};

export default SettingsAccordion;
