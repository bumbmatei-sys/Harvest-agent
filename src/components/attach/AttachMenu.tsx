'use client';

/**
 * THE-331 · The attach picker.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * The paperclip used to open a hand-rolled sheet: `fixed inset-0 z-[300] flex
 * items-end` with NO `sm:` override, so a surface designed for a phone slammed
 * across the bottom of a 1920px desktop, edge to edge. Inside it were a
 * hand-rolled tab strip, a hand-rolled search input, a hand-rolled spinner, a
 * hand-rolled empty state and four EMOJI standing in for icons.
 *
 * 🔴 It is a menu now, not a sheet, so there is no full-width surface left to
 * mis-place. The founder's reference was a menu: section rows, a `>` submenu
 * arrow, two or three recents behind it, then "Browse…".
 *
 * ── The layer, and why ──────────────────────────────────────────────────────
 *
 * ⚠️ `ui/dropdown-menu` and the cascader both default to `z-50`, and the
 * member/admin bottom nav is `fixed bottom-0 … z-[100]`. Left alone the menu
 * would open UNDERNEATH the nav on every phone. Both surfaces are lifted here:
 * the menu to `z-[110]` and the browse dialog to `z-[130]`/`z-[131]`, so the
 * dialog also clears the menu rather than relying on the menu having closed
 * first. Nothing is raised to the old `z-[300]`: clearing the nav is what was
 * needed, and 300 sat above the settings dialog for no reason anyone recorded.
 *
 * ── Why a cascader for "Browse…" ────────────────────────────────────────────
 *
 * 🔴 `searchScope="deep"` is set EXPLICITLY. The prop defaults to `"level"`,
 * which filters only the level you are standing on and never jumps — one
 * search field that cannot find a contact while you are looking at Forms is
 * the opposite of the point. `deep` searches all four categories at once and
 * annotates each hit with its path, which is what tells a "Testing" doc from a
 * "Testing" form.
 *
 * ⚠️ `mode` is left at its default `"drill"`: one level at a time, which fits a
 * 380px phone and matches the founder's reference. `"columns"` needs desktop
 * width; `"tree"` would SILENTLY DISABLE deep search — the cascader itself
 * warns that a tree query already matches at any depth, so `searchScope`
 * becomes a no-op there.
 *
 * ── 🔴 Virtualization is OFF, deliberately and explicitly ──────────────────
 *
 * ⚠️ THE CASCADER'S WINDOWING IS OPT-IN, NOT AUTOMATIC — and reading the
 * `virtualize` prop's doc comment alone gives the opposite impression. What is
 * automatic is only the internal `virtualized` FLAG, which flips at
 * `virtualizeThreshold` (100). The renderer that actually windows rows lives in
 * `cascader-virtual.tsx` and must be mounted by hand as `<CascaderVirtualItems />`;
 * `cascader.tsx` never imports it, precisely "so the primitive's own install
 * never pulls `@tanstack/react-virtual` in".
 *
 * 🔴 LEAVING IT AUTOMATIC IS THEREFORE A BUG, not a default. `CascaderItems`
 * renders rows with NO `index`, and `CascaderItem` only forwards one while
 * `virtualized` is true — so past 100 rows the flag flips, the rows still carry
 * no index, and Base UI falls back to an O(n) `findItemIndex` that returns -1 on
 * the frame a level swap renders empty, dangling `aria-activedescendant`. A
 * 2,000-contact church would get BROKEN KEYBOARD NAVIGATION and no windowing.
 *
 * `virtualize={false}` pins the flag off, so every row renders plainly and
 * correctly. The cost is real and accepted: drilling into a 2,000-contact
 * category renders 2,000 rows. The alternative was mounting the windowing
 * renderer, which needs `@tanstack/react-virtual` — and THE-274 pins the
 * lockfile to an exact entry count with no append point, so that dependency
 * cannot be added without amending a prior ticket's deliberate guard. Deep
 * search, which is how a person actually finds one contact among two thousand,
 * caps its own result set at 200 and is unaffected.
 *
 * ── Reading the category off a selection ────────────────────────────────────
 *
 * 🔴 Ids are NOT unique across the four collections. `onValueChange`'s SECOND
 * argument carries the resolved node, and each node carries its `AttachRecord`
 * as `data` — so the commit reads `details.node.data`, a whole record with its
 * own `category`, and never parses the bare id string. `details.path[0]` is
 * the category root and is asserted against it.
 *
 * ⚠️ `value` is controlled here and stays controlled for the component's whole
 * life. The cascader's API warns that a prop switched between controlled and
 * uncontrolled mid-life reads from whichever source changed first.
 */

import * as React from 'react';
import {
  ClipboardListIcon,
  FileTextIcon,
  HeartHandshakeIcon,
  PaperclipIcon,
  UserIcon,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';

import {
  Cascader,
  CascaderEmpty,
  CascaderList,
  CascaderPanel,
  CascaderStatus,
} from '@/components/reui/cascader/cascader';
import { CascaderItems } from '@/components/reui/cascader/cascader-item';
import { CascaderBreadcrumb, CascaderInput, CascaderNav } from '@/components/reui/cascader/cascader-nav';
import type {
  CascaderChangeDetails,
  CascaderNode,
} from '@/components/reui/cascader/cascader-types';

import {
  ATTACH_CATEGORY_IDS,
  ATTACH_CATEGORY_LABELS,
  loadAllAttachCategories,
  recentsOf,
  type AttachCategoryId,
  type AttachLoadsByCategory,
  type AttachRecord,
} from '@/lib/attach-records';

/**
 * One icon per category. Lucide, never emoji: an emoji is a font-dependent
 * colour glyph that ignores every palette and reads differently on each OS.
 * No `size-*` class — the menu and cascader row styles size a bare `svg`
 * through `[&_svg:not([class*='size-'])]`, and that guard stops matching the
 * moment a size class is present.
 */
const CATEGORY_ICONS: Readonly<Record<AttachCategoryId, React.ReactNode>> = Object.freeze({
  docs: <FileTextIcon aria-hidden="true" />,
  contacts: <UserIcon aria-hidden="true" />,
  campaigns: <HeartHandshakeIcon aria-hidden="true" />,
  forms: <ClipboardListIcon aria-hidden="true" />,
});

/**
 * The icon for one ATTACHED record, by its record type.
 *
 * 🔴 Exported because the composer's chips and `AttachmentCard` rendered the
 * same four types as EMOJI — 📄 👤 📝 🎯. An emoji is a font-dependent colour
 * glyph: it ignores all four palettes, renders differently on every OS, and is
 * announced by a screen reader as its CLDR name ("page facing up") rather than
 * as the thing it stands for. One map, so the picker and the attached chip can
 * never drift apart.
 */
export function AttachTypeIcon({ type }: { type: AttachRecord['type'] }) {
  const byType: Record<AttachRecord['type'], React.ReactNode> = {
    doc: <FileTextIcon aria-hidden="true" />,
    contact: <UserIcon aria-hidden="true" />,
    campaign: <HeartHandshakeIcon aria-hidden="true" />,
    form: <ClipboardListIcon aria-hidden="true" />,
  };
  return <>{byType[type]}</>;
}

/**
 * 🔴 44px below `sm`, released above it. Rule 4 fixes controls at 38px from
 * `sm` up and a test asserts `DENSITY_PX.control < 44` deliberately, so a flat
 * `min-h-11` would fight it at desktop widths. Applied to menu rows AND
 * cascader rows: both are tap targets.
 */
const TAP_TARGET = 'min-h-11 sm:min-h-0';

/** The same rule, reached through the list — a cascader row is a tap target. */
const CASCADER_ROW_TAP_TARGET =
  '[&_[role=option]]:min-h-11 sm:[&_[role=option]]:min-h-0';

/** The node id namespaces the collection, because ids repeat across the four. */
const nodeValue = (r: AttachRecord) => `${r.category}:${r.id}`;

/**
 * The browse tree: four category roots, each holding its records.
 * `selectable` stays at its default `"leaf"`, so a category row drills in and
 * only a record can be committed.
 */
function buildTree(loads: AttachLoadsByCategory): CascaderNode<AttachRecord>[] {
  return ATTACH_CATEGORY_IDS.map((id) => {
    const load = loads[id];
    const children = load.ok
      ? load.records.map((r) => ({
          value: nodeValue(r),
          label: r.title,
          description: r.subtitle,
          icon: CATEGORY_ICONS[id],
          data: r,
        }))
      : [];
    return {
      value: id,
      label: ATTACH_CATEGORY_LABELS[id],
      icon: CATEGORY_ICONS[id],
      // Declared so a category that failed to load still reads as a branch
      // rather than silently flattening into a selectable leaf.
      hasChildren: true,
      children,
    };
  });
}

export interface AttachMenuProps {
  tenantId: string;
  includeNull: boolean;
  /** Commits one record. Receives the WHOLE record, never a bare id. */
  onAttach: (record: AttachRecord) => void;
  /** Labels the trigger for assistive tech; the glyph alone says nothing. */
  triggerLabel?: string;
  disabled?: boolean;
}

export function AttachMenu({
  tenantId,
  includeNull,
  onAttach,
  triggerLabel = 'Attach a record',
  disabled,
}: AttachMenuProps) {
  const [loads, setLoads] = React.useState<AttachLoadsByCategory | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [browsing, setBrowsing] = React.useState(false);
  const [value, setValue] = React.useState('');

  // Loaded when the menu first opens, not on mount: six Firestore listeners are
  // already live on this screen and a composer the user never opens should not
  // add four one-shot reads to them.
  const load = React.useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      setLoads(await loadAllAttachCategories(tenantId, includeNull));
    } finally {
      setLoading(false);
    }
  }, [tenantId, includeNull]);

  const onOpenChange = React.useCallback(
    (open: boolean) => {
      if (open && !loads && !loading) void load();
    },
    [loads, loading, load],
  );

  const tree = React.useMemo(() => (loads ? buildTree(loads) : []), [loads]);

  const commit = React.useCallback(
    (next: string, details: CascaderChangeDetails<AttachRecord>) => {
      setValue(next);
      // 🔴 The record comes off the resolved node, so the category rides with
      // it. `path[0]` is the category root and must agree; if it somehow does
      // not, the selection is dropped rather than filed under a guess.
      const record = details.node?.data;
      if (!record) return;
      const root = details.path[0]?.value;
      if (root && root !== record.category) return;
      onAttach(record);
      setBrowsing(false);
      setValue('');
    },
    [onAttach],
  );

  const openBrowse = React.useCallback(() => {
    setValue('');
    setBrowsing(true);
  }, []);

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={triggerLabel}
              disabled={disabled}
              className={TAP_TARGET}
            />
          }
        >
          <PaperclipIcon aria-hidden="true" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="z-[110] w-56">
          {ATTACH_CATEGORY_IDS.map((id) => {
            const categoryLoad = loads?.[id];
            const recents = categoryLoad ? recentsOf(categoryLoad) : [];
            return (
              <DropdownMenuSub key={id}>
                <DropdownMenuSubTrigger className={TAP_TARGET}>
                  {CATEGORY_ICONS[id]}
                  {ATTACH_CATEGORY_LABELS[id]}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="z-[110] w-64">
                  {loading || !categoryLoad ? (
                    <div className="flex items-center justify-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                      <Spinner />
                      Loading
                    </div>
                  ) : !categoryLoad.ok ? (
                    /* 🔴 A failed read is a FAILURE. It is NOT "nothing found":
                       a church that cannot read its contacts was being told it
                       had none. */
                    <Alert variant="destructive" className="border-0">
                      <AlertTitle>{ATTACH_CATEGORY_LABELS[id]} could not be loaded</AlertTitle>
                      <AlertDescription>
                        The records are there; this screen could not read them. Try again.
                      </AlertDescription>
                    </Alert>
                  ) : recents.length === 0 ? (
                    <Empty className="px-2 py-6">
                      <EmptyHeader>
                        <EmptyTitle>No {ATTACH_CATEGORY_LABELS[id].toLowerCase()} yet</EmptyTitle>
                        <EmptyDescription>
                          Records you add will show up here.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    recents.map((r) => (
                      <DropdownMenuItem
                        key={nodeValue(r)}
                        className={TAP_TARGET}
                        onClick={() => onAttach(r)}
                      >
                        {CATEGORY_ICONS[id]}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{r.title}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {r.subtitle}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className={TAP_TARGET} onClick={openBrowse}>
                    Browse&hellip;
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={browsing} onOpenChange={setBrowsing}>
        <DialogPortal>
          {/* Above the menu's 110 as well as the nav's 100 — see the header. */}
          <DialogOverlay className="z-[130]" />
          <DialogContent className="z-[131] gap-3 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Attach a record</DialogTitle>
              <DialogDescription>
                Search every category at once. Each result shows where it lives.
              </DialogDescription>
            </DialogHeader>
            <Cascader
              items={tree}
              value={value}
              onValueChange={commit}
              searchScope="deep"
              virtualize={false}
            >
              <CascaderPanel>
                <CascaderNav>
                  <CascaderInput placeholder="Search records..." />
                </CascaderNav>
                <CascaderBreadcrumb />
                <CascaderEmpty />
                {/* 🔴 The tap target is applied to the ROWS through the list,
                    not by hand-rendering each one: `CascaderItem` needs an
                    explicit `index` once virtualization engages, and taking
                    over the row render would mean owning that too. */}
                <CascaderList className={CASCADER_ROW_TAP_TARGET}>
                  <CascaderItems />
                </CascaderList>
                <CascaderStatus />
              </CascaderPanel>
            </Cascader>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}
