"use client";
/**
 * THE-299 — "Retention cohorts": the grid THE-283 deferred.
 *
 * ─── 🔴 Provenance: this was INSTALLED, not written ──────────────────────────
 *
 * `npx shadcn add https://ui.spectrumhq.in/r/cohort-chart.json` — the spectrum
 * registry's `cohort-chart`, the widget by name. It declared no npm dependency
 * and no registry dependency, and it kept that promise: the CLI wrote two files
 * and touched nothing else — not package.json, not package-lock.json, not
 * components.json, not globals.css, not tailwind.config.ts.
 *
 *   src/components/spectrumui/charts/cohort-chart.tsx
 *     sha256 8a8f14033a1cfdb8fd3de3a8400dc26ee89bd10574e5baa8fa07b1c79919b3b0
 *   src/components/spectrumui/charts/chart-engine.tsx
 *     sha256 7b3263158f40b58a432aa1cc5d2f100c2681b5d5a5f619ed115567c5b56a27e4
 *
 * ⚠️ WHAT THE SOURCE ACTUALLY IMPORTS, checked before it was accepted, because
 * spectrum was rejected as a registry on card 86bbr6rz6 for dragging in
 * `@react-three/fiber`, `@react-three/rapier` and `meshline`. Both files import
 * exactly two things: `react`, and `cn` from `@/lib/utils`. There is no
 * `@radix-ui/*`, no `@react-three/*`, no `meshline`, no `framer-motion`, no
 * chart library and no `date-fns`. No `asChild` anywhere, so there is no
 * new-york-era API to convert to Base UI's render prop either — the GAIA
 * problem does not arise. It is pure composition over primitives, exactly as
 * the empty dependency list suggested.
 *
 * ─── 🔴 What was rewritten, and why it was not optional ─────────────────────
 *
 * The rendering could not ship as installed, and this was measured rather than
 * argued: with both files in the tree, `src/__tests__/theming-gaps.test.ts` —
 * a guard that predates this ticket and walks all of `src` — fails with THIRTY-
 * SIX offenders. Every one is a `fill-`/`text-`/`bg-` utility on Tailwind's
 * cool default neutral ramp (twelve distinct steps between them), which is
 * off-palette in light and does not move in dark; four palettes ship and
 * Classic is the default since #409, so each of those is the same colour in all
 * four and therefore wrong in at least three. Alongside them the engine
 * hardcodes twenty hex literals and the pair carries thirteen `style={{ … }}`
 * blocks, against a dashboard whose inline-style count is zero and stays zero.
 *
 * ⚠️ This file may not SPELL those class names even in prose: that guard scans
 * raw source and does not strip comments, which is correct — a class name in a
 * comment is still a class name to Tailwind's own scanner.
 *
 * So what was kept is the SUBSTANCE and what was replaced is the PAINT:
 *
 *   KEPT — the grid geometry and its constants (label gutter, size gutter,
 *     header band, row height, gap, `cellX`), the row-per-cohort / column-per-
 *     period SVG layout, the pooled summary row beneath it, the `role="img"`
 *     plus spoken `aria-label`, and `ChartDataTable`'s screen-reader table
 *     carrying every number the grid draws.
 *   REPLACED — `intensityColor`, which mixes `--spectrum-series-1` (declared by
 *     the engine as a literal blue hex) at 14–100%, and `onFillClass`, which
 *     flips the ink between white and near-black at 55%. Both are rewritten as
 *     {@link BAND_FILL}: six static classes mixing `--chart-2` into `--muted`,
 *     capped at 60%, with ONE ink for the whole scale. See the contrast note.
 *   DROPPED — `chart-engine.tsx` in its entirety, and it is not in this PR.
 *     1,036 lines of a general chart library (bars, lines, arcs, cards, six
 *     skeleton variants, a seeded RNG) of which this widget uses nine helpers,
 *     and every colour in it is a literal. `ChartState`'s loading/empty/error
 *     states are already {@link WidgetFrame}'s job here and would have been a
 *     second, differently-worded answer to the question that frame exists to
 *     answer once.
 *   DROPPED — `generateCohorts` / `COHORTS`, the seeded demo data upstream uses
 *     as the `data` prop's DEFAULT. 🔴 A widget on this dashboard that renders
 *     invented numbers when it is handed none is the exact failure this whole
 *     feature exists to refuse. There is no default here; the data is required.
 *   DROPPED — the hover crosshair, `useElementWidth` and `usePrefersReducedMotion`.
 *     The first two need client state and a `ResizeObserver`, and upstream
 *     renders NOTHING until a width has been measured (`{!ready ? null : …}`).
 *     This app's layout guards measure `renderToStaticMarkup` output in real
 *     Chromium without hydrating, so a width-measuring grid would have been
 *     measured as an empty box and would have passed. The geometry is fixed
 *     instead: the same result server-side and client-side, and a scroller that
 *     genuinely overflows at 380px.
 *
 * ─── 🔴 Colour, and the number that has to survive it ───────────────────────
 *
 * `--chart-1` … `--chart-5` are five CATEGORICAL series slots, and a heatmap
 * needs a SCALE. `--chart-4` and `--chart-5` measure 1.50:1 and 1.77:1 on a
 * light ground, so a ramp built across the five would be unreadable at one end
 * before any ink was put on it. The scale is therefore ONE hue at six
 * strengths: `color-mix(in srgb, var(--chart-2) N%, var(--muted))` for N in
 * 0, 12, 24, 36, 48, 60. `--chart-2` is the same series colour the member
 * growth trend directly above already plots, which is coherent — both charts
 * are about people.
 *
 * 🔴 THE CAP AT 60% IS THE CONTRAST BUDGET, NOT A TASTE DECISION. Every cell
 * carries its number, and that number is `--text-strong` — one ink for the
 * whole ramp, with no flip to white at the dark end, because a flip is a second
 * thing to get wrong at exactly the value where it matters. On dark grounds
 * `--text-strong` is near-white and `--chart-2` is `--sky-400`, so contrast
 * FALLS as the mix rises: it clears 4.5:1 at 60% (4.94:1 in Classic dark,
 * 5.31:1 in Harvest dark) and fails at 65%. On light grounds it rises instead
 * and the whole ramp is comfortable. The worst pair in any of the four palettes
 * is 4.94:1. Every one of the twenty-four is recomputed from globals.css and
 * asserted in `src/__tests__/the-299-retention-guards.test.ts`.
 *
 * ⚠️ COLOUR CARRIES NOTHING ON ITS OWN. Every drawn cell has its percentage
 * written in it, the legend states what each band means in words, and the
 * screen-reader table repeats every count and share as text. A reader who sees
 * no colour at all loses no information.
 *
 * ─── 🔴 A cohort is a count. Never a person ─────────────────────────────────
 *
 * Every row heading is a MONTH — `retention-data`'s `monthLabel` derives it
 * from an integer and there is no branch that could produce anything else — and
 * {@link RetentionGrid} has no field that could hold a name, an email or an id.
 * There is no expander, no tooltip listing members and no drill-down. The
 * privacy property is a property of the type, exactly as THE-283 made it one.
 *
 * ─── 380px ──────────────────────────────────────────────────────────────────
 *
 * Twelve periods plus two gutters is 644px and does not fit a phone. It scrolls
 * INSIDE its own container and the PAGE BODY does not move — the pattern #422
 * established, which #429 made non-vacuous by asserting the scroller genuinely
 * overflows. Measured in Chromium at 380 / 768 / 1024 / 1280 / 1440 in
 * `the-299-retention-layout.test.tsx`, because width is not monotonic here.
 * 🔴 The grid is NOT narrowed on mobile: dropping periods below `lg` would make
 * the phone and the desktop answer the same question differently.
 */
import React from 'react';
import { Grid3x3 } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON } from './growth-data';
import { RETENTION_MONTHS, type RetentionGrid } from './retention-data';

/* ── Geometry. Upstream's constants, fixed rather than measured ───────────── */

const LABEL_W = 88;
const SIZE_W = 52;
const HEAD_H = 24;
const ROW_H = 28;
const COL_W = 42;
const GAP = 2;

const cellX = (col: number): number => LABEL_W + SIZE_W + col * COL_W;
const GRID_W = LABEL_W + SIZE_W + RETENTION_MONTHS * COL_W;

/**
 * The six steps of the scale, weakest first.
 *
 * ⚠️ STATIC STRINGS, not built by interpolation. Tailwind scans source text, so
 * a class assembled at runtime produces no rule and paints nothing — the exact
 * "token invented by use" failure THE-294's guard was written to catch. Spelled
 * out, each one compiles, and the guard asks Tailwind whether it did rather
 * than assuming: the first spelling of this table was checked that way and the
 * check is what proved it. (⚠️ `ds-primitives.audit`'s extractor reads
 * `className` and `cn()` positions, so it never sees a table like this one at
 * all. The guard queries the compiled stylesheet for these six by name.)
 *
 * 🔴 The cap is 60% of `--chart-2`. See this file's header: above it the number
 * stops clearing AA against its own cell on the two dark palettes.
 *
 * 🔴 THE MIX IS WRITTEN TRACK-FIRST, AND THAT IS LOAD-BEARING. Tailwind wraps
 * a `color-mix()` arbitrary value in `@supports (color: color-mix(in lab, red,
 * red))` and emits the mix's FIRST colour as the unguarded fallback. Written
 * `--chart-2`-first, a browser without `color-mix` would paint every cell at
 * full strength — 2.27:1 against its own number in Classic dark, i.e. the one
 * outcome the cap exists to prevent. Written `--muted`-first it degrades to a
 * flat, uncoloured grid whose numbers are all still at 13–18:1. The heatmap
 * loses its shading and loses nothing else, which is exactly the claim the
 * legend and the cell numbers already make.
 */
export const BAND_FILL = [
  'fill-[color-mix(in_srgb,var(--muted)_100%,var(--chart-2))]',
  'fill-[color-mix(in_srgb,var(--muted)_88%,var(--chart-2))]',
  'fill-[color-mix(in_srgb,var(--muted)_76%,var(--chart-2))]',
  'fill-[color-mix(in_srgb,var(--muted)_64%,var(--chart-2))]',
  'fill-[color-mix(in_srgb,var(--muted)_52%,var(--chart-2))]',
  'fill-[color-mix(in_srgb,var(--muted)_40%,var(--chart-2))]',
] as const;

/**
 * The percentage of `--chart-2` in each band — the complement of the number
 * spelled in {@link BAND_FILL}. Read by the contrast guard, which recomputes
 * every cell colour from globals.css rather than trusting a hand-typed hex.
 */
export const BAND_MIX = [0, 12, 24, 36, 48, 60] as const;

/** What each band means, in words, for the legend. Colour is never the only carrier. */
export const BAND_LABEL = [
  'none',
  '1–20%',
  '21–40%',
  '41–60%',
  '61–80%',
  '81–100%',
] as const;

/** Which band a share falls in. `0` is its own band: none active is not "few". */
export function bandOf(share: number): number {
  if (share <= 0) return 0;
  if (share <= 20) return 1;
  if (share <= 40) return 2;
  if (share <= 60) return 3;
  if (share <= 80) return 4;
  return 5;
}

const pct = (share: number): string => `${Math.round(share)}%`;
const count = (n: number): string => n.toLocaleString();

export function RetentionHeatmap({ grid, reason }: {
  readonly grid: RetentionGrid | null;
  readonly reason: string | null;
}) {
  /*
   * ⚠️ `== null`, not `=== null`, and the difference is load-bearing. The prop
   * type says `RetentionGrid | null`, but every fixture in this repo builds a
   * `GrowthData` through `as unknown as GrowthData`, so a caller that simply
   * omits the field passes `undefined` and TypeScript never sees it. Under
   * `=== null` that lands in `ready` with no grid — a widget in its READY state
   * rendering nothing at all, which is the empty-card failure this whole
   * feature exists to refuse. Under `== null` it lands in `loading`, which is
   * what "nobody has told me anything yet" actually means.
   */
  const state: WidgetState = grid == null && reason == null
    ? { kind: 'loading' }
    : grid == null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  const rows = grid?.rows ?? [];
  const height = HEAD_H + (rows.length + 1) * ROW_H + 6;
  const summaryY = HEAD_H + rows.length * ROW_H;

  return (
    <WidgetFrame
      title="Retention cohorts"
      description="Of the members who joined in a month, the share with a recorded CRM activity in each later month. Activity means a check-in, form, registration, gift or logged note — this app records nothing else about a member's presence."
      icon={Grid3x3}
      state={state}
      skeletonClassName="h-72 w-full"
    >
      <div className="space-y-3" data-retention-heatmap>
        {/*
          🔴 The scroller. `overflow-x-auto` here and nowhere above it is what
          keeps a 644px grid off a 380px page body — #422's pattern, and #429's
          point that the assertion is only worth making if the child genuinely
          overflows the parent, which at 380px it does by 264px.
        */}
        <div className="overflow-x-auto" data-retention-scroller>
          {grid && rows.length > 0 && (
            <svg
              width={GRID_W}
              height={height}
              viewBox={`0 0 ${GRID_W} ${height}`}
              className="block text-strong select-none"
              role="img"
              aria-label={`Retention by join month. ${rows.length} cohorts over ${grid.periods} months. Every figure is repeated in the table below.`}
              data-retention-grid
            >
              <g className="fill-current text-muted-foreground" fontSize={9}>
                <text x={0} y={HEAD_H - 9}>Joined</text>
                <text x={LABEL_W} y={HEAD_H - 9}>Members</text>
                {Array.from({ length: grid.periods }, (_, col) => (
                  <text key={col} x={cellX(col) + COL_W / 2} y={HEAD_H - 9} textAnchor="middle">
                    {`M${col}`}
                  </text>
                ))}
              </g>

              {rows.map((row, index) => {
                const y = HEAD_H + index * ROW_H;
                return (
                  <g key={row.key} data-retention-row={row.key}>
                    <text
                      x={0}
                      y={y + ROW_H / 2}
                      dominantBaseline="middle"
                      fontSize={11}
                      className="fill-current tabular-nums"
                    >
                      {row.label}
                    </text>
                    <text
                      x={LABEL_W}
                      y={y + ROW_H / 2}
                      dominantBaseline="middle"
                      fontSize={11}
                      className="fill-current text-muted-foreground tabular-nums"
                    >
                      {count(row.members)}
                    </text>

                    {row.retained.map((share, col) =>
                      /*
                        🔴 A period that has not finished draws NOTHING — no
                        rect and no number. An empty cell and a `0%` cell are
                        different claims, and only one of them is about a month
                        that has happened.
                      */
                      share === null ? null : (
                        <g key={col} data-retention-cell={`${row.key}:${col}`}>
                          <rect
                            x={cellX(col) + GAP / 2}
                            y={y + GAP / 2}
                            width={COL_W - GAP}
                            height={ROW_H - GAP}
                            rx={4}
                            className={BAND_FILL[bandOf(share)]}
                          />
                          <text
                            x={cellX(col) + COL_W / 2}
                            y={y + ROW_H / 2}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={10}
                            className="fill-current tabular-nums"
                          >
                            {pct(share)}
                          </text>
                        </g>
                      ),
                    )}
                  </g>
                );
              })}

              {/*
                The pooled row. Upstream averaged the column's percentages;
                this sums the counts and divides by the sizes, because cohorts
                differ in size by a lot and a mean of rates lets a three-member
                month weigh as much as a three-hundred-member one.
              */}
              <g data-retention-summary>
                <line
                  x1={0}
                  x2={GRID_W}
                  y1={summaryY + 1}
                  y2={summaryY + 1}
                  className="stroke-border"
                  shapeRendering="crispEdges"
                />
                <text
                  x={0}
                  y={summaryY + ROW_H / 2 + 3}
                  dominantBaseline="middle"
                  fontSize={11}
                  className="fill-current text-strong tabular-nums"
                >
                  All cohorts
                </text>
                {grid.overall.map((share, col) =>
                  share === null ? null : (
                    <text
                      key={col}
                      x={cellX(col) + COL_W / 2}
                      y={summaryY + ROW_H / 2 + 3}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={10}
                      className="fill-current text-strong tabular-nums"
                      data-retention-overall={col}
                    >
                      {pct(share)}
                    </text>
                  ),
                )}
              </g>
            </svg>
          )}
        </div>

        {/*
          🔴 The legend states what a colour means IN WORDS. Nothing on this
          widget is carried by hue alone: the swatch is the third copy of a fact
          the cell's own number and the table below already give.
        */}
        {grid && rows.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-retention-legend>
            {BAND_LABEL.map((label, band) => (
              <li key={label} className="flex items-center gap-1.5" data-retention-band={label}>
                <svg width={10} height={10} aria-hidden className="shrink-0">
                  <rect width={10} height={10} rx={2} className={BAND_FILL[band]} />
                </svg>
                <span>{label}</span>
              </li>
            ))}
            <li>Blank: that month has not finished.</li>
          </ul>
        )}

        {/*
          🔴 The parts of the answer that are missing, as figures of the same
          standing as the grid. Rendered whenever the read succeeded, including
          when every term is zero — where it is the reassurance that the grid is
          the whole membership rather than most of it.
        */}
        {grid && (
          <p className="text-xs text-muted-foreground" data-retention-coverage>
            {`${count(grid.membersInWindow)} of ${count(grid.membersTotal)} members joined inside this ${RETENTION_MONTHS}-month window and are in the grid. `}
            {`${count(grid.membersBeforeWindow)} joined earlier, ${count(grid.membersAfterWindow)} joined during the month still in progress, and ${count(grid.membersUndated)} carry no readable join date; all are counted here and placed in no row. `}
            {`Of ${count(grid.activitiesRead)} activities read, ${count(grid.activitiesAttributed)} belong to a member, ${count(grid.activitiesNotAMember)} to a contact who is not one, and ${count(grid.activitiesUnresolved + grid.activitiesUndated)} could not be placed.`}
          </p>
        )}

        {/*
          Upstream's `ChartDataTable`, kept. It is the same numbers as text, and
          it is what makes the grid readable to somebody who is never going to
          see a colour. `sr-only` rather than a toggle: it is not a second
          widget, it is the same one.
        */}
        {grid && rows.length > 0 && (
          <div className="sr-only">
          {/*
            🔴 `sr-only` ON THE WRAPPER, NOT ON THE TABLE — and this was
            MEASURED, not styled by taste. Upstream puts the class on the
            `<table>` itself; `sr-only` clips with `overflow: hidden` on a 1px
            box, and `overflow` does not clip a `display: table` element the way
            it clips a block. A fourteen-column table of month headings and
            "812 of 1,240, 66%" cells therefore rendered at its full intrinsic
            width, invisible, and pushed `documentElement.scrollWidth` to 1,474
            at 380px and 1,663 at 1,440px — horizontal page scroll at EVERY
            viewport, from an element nobody could see. The layout test caught
            it; nothing else would have.

            🔴 THE-319 composed this table from the `table` PRIMITIVE and the
            wrapper is untouched by that — it is why the adoption is safe rather
            than a risk to it. `Table` renders its own container `div` around the
            `<table>`, so the `display: table` element is no longer this
            wrapper's direct child at all and the clipping above never depends
            on the exception that broke it. The visible grid below is NOT a
            table and did not move: it is a matrix of coloured cells whose
            colour is a scale rather than a value in a column, and `chart` is
            recharts, which has no heatmap and renders nothing under happy-dom.
          */}
          <Table data-retention-table>
            <TableCaption>Retention by join month, as counts and shares.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Joined</TableHead>
                <TableHead scope="col">Members</TableHead>
                {Array.from({ length: grid.periods }, (_, col) => (
                  <TableHead key={col} scope="col">{`Month ${col}`}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableHead scope="row">{row.label}</TableHead>
                  <TableCell>{count(row.members)}</TableCell>
                  {row.retained.map((share, col) => (
                    <TableCell key={col}>
                      {share === null
                        ? 'not yet observed'
                        : `${count(row.active[col] ?? 0)} of ${count(row.members)}, ${pct(share)}`}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}
