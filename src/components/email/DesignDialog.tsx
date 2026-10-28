'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ACCENT_LABELS, THEME_LABELS, readHexColor, type EmailAccent, type EmailDesign, type EmailTheme } from '@/lib/email/design';
import { BRAND_PALETTE } from '@/lib/email/render';
import {
  DEFAULT_THEME_TOKENS,
  getCustomTheme,
  getThemePreset,
  type CustomTheme,
  type EmailThemeTokens,
} from '@/lib/email/themes';
import { Segmented, TAP, ErrorNote } from '@/components/email/kit';
import { ThemePicker } from '@/components/email/ThemePicker';
import { ThemeSettingsPanels } from '@/components/email/ThemeSettingsPanels';
import { cn } from '@/lib/utils';

const THEMES = (Object.keys(THEME_LABELS) as EmailTheme[]).map((value) => ({ value, label: THEME_LABELS[value] }));
const ACCENTS = (Object.keys(ACCENT_LABELS) as EmailAccent[]).map((value) => ({ value, label: ACCENT_LABELS[value] }));

/**
 * Navy and Gold are Harvest's own two colours, so their swatches are the real
 * brand values rather than theme tokens: a token follows the ministry's colour,
 * and a ministry branded red would otherwise see "Gold" drawn red. Custom is the
 * ministry's own branding colour, passed in.
 */
const FIXED_SWATCH = { navy: BRAND_PALETTE.navy900, gold: BRAND_PALETTE.gold500 } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium uppercase tracking-wide text-faint">{label}</Label>
      {children}
    </div>
  );
}

export function DesignDialog({ open, onOpenChange, design, onChange, brandColor, themeId, themeTokens, customThemes, defaultThemeId, onThemeChange, onSaveTheme, onDeleteTheme, onSetDefaultTheme }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  design: EmailDesign;
  onChange: (next: EmailDesign) => void;
  /** The ministry's branding colour. Without a valid hex, Custom is not offered. */
  brandColor?: string | null;
  /** The theme this email renders with. Absent on an older email, which renders from `design`. */
  themeId?: string | null;
  themeTokens?: EmailThemeTokens | null;
  /** A ministry's saved themes. Empty until custom themes land. */
  customThemes?: readonly CustomTheme[];
  /** The theme new emails start with. Its picker tile is labelled Default. */
  defaultThemeId?: string | null;
  /**
   * Hands back a look: a theme id and a snapshot of its tokens, or `null, null`
   * for the classic look this email renders from `design`. Without this prop the
   * dialog is the classic dialog and nothing about themes is shown.
   */
  onThemeChange?: (id: string | null, tokens: EmailThemeTokens | null) => void;
  /** Saves the current tokens under a name as the ministry's own theme. */
  onSaveTheme?: (name: string) => Promise<void>;
  /** Removes one of the ministry's saved themes. */
  onDeleteTheme?: (id: string) => Promise<void> | void;
  /** Sets (or clears, with null) the theme new emails start with. */
  onSetDefaultTheme?: (themeId: string | null) => Promise<void>;
}) {
  const brand = readHexColor(brandColor);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function runSave() {
    if (!onSaveTheme) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveTheme(saveName.trim());
      setSaveOpen(false);
      setSaveName('');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'That theme could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function runDefault(themeIdToSet: string | null) {
    if (!onSetDefaultTheme) return;
    setActionError(null);
    try {
      await onSetDefaultTheme(themeIdToSet);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'That could not be saved.');
    }
  }

  async function runDelete(id: string) {
    if (!onDeleteTheme) return;
    setActionError(null);
    try {
      await onDeleteTheme(id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'That theme could not be deleted.');
    }
  }
  const pickAccent = (accent: EmailAccent) => {
    const { customColor: _drop, ...rest } = design;
    onChange(accent === 'custom' && brand ? { ...rest, accent, customColor: brand } : { ...rest, accent });
  };
  const set = <K extends keyof EmailDesign>(key: K, value: EmailDesign[K]) => onChange({ ...design, [key]: value });
  /** The theme layer is on only when the caller listens for picks. */
  const themed = onThemeChange !== undefined && Boolean(themeId && themeTokens);
  const defaults = getThemePreset(themeId)?.tokens
    ?? getCustomTheme(customThemes ?? [], themeId)?.tokens
    ?? DEFAULT_THEME_TOKENS;
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[90vh] overflow-y-auto', onThemeChange ? 'sm:max-w-xl' : 'sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle>Design</DialogTitle>
          <DialogDescription>Colors, fonts, header, buttons and footer for this email.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {onThemeChange && (
            <Row label="Theme presets">
              <ThemePicker
                selectedId={themeId ?? null}
                onSelect={(choice) => onThemeChange(choice.id, choice.tokens)}
                customThemes={customThemes}
                defaultId={defaultThemeId ?? null}
                onDelete={onDeleteTheme ? (id) => { void runDelete(id); } : undefined}
              />
            </Row>
          )}
          {themed && themeTokens ? (
            <>
              <ThemeSettingsPanels
                tokens={themeTokens}
                onChange={(next) => onThemeChange?.(themeId ?? null, next)}
                defaults={defaults}
              />
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 justify-start px-0 text-sm text-muted"
                onClick={() => onThemeChange?.(null, null)}
              >
                Use the classic look instead
              </Button>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                {onSaveTheme && (
                  <Button type="button" className="min-h-11" onClick={() => { setSaveError(null); setSaveOpen(true); }}>
                    Save as my theme
                  </Button>
                )}
                {defaultThemeId && themeId === defaultThemeId ? (
                  <>
                    <span className="text-xs text-muted">This is your default.</span>
                    {onSetDefaultTheme && (
                      <Button type="button" variant="ghost" className="min-h-11" onClick={() => void runDefault(null)}>Undo</Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" className="min-h-11" disabled={!onSetDefaultTheme} onClick={() => void runDefault(themeId ?? null)}>
                      Make it my default
                    </Button>
                    <span className="text-xs text-faint">For every new email without its own pick.</span>
                  </>
                )}
              </div>
              {actionError && <ErrorNote>{actionError}</ErrorNote>}
            </>
          ) : (
            <>
          <Row label="Theme">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={design.theme === t.value}
                  onClick={() => set('theme', t.value)}
                  className={cn(TAP, 'flex flex-col gap-2 rounded-lg border p-2 text-left text-sm', design.theme === t.value ? 'border-primary ring-1 ring-primary' : 'border-line')}
                >
                  <span aria-hidden className={cn('flex h-12 flex-col justify-center gap-1 rounded-md px-2', t.value === 'plain' ? 'bg-surface-raised' : 'bg-surface-sunken')}>
                    <span className={cn('h-1 w-8 rounded', t.value === 'bold' ? 'bg-gold' : 'bg-foreground/70')} />
                    <span className="h-1 w-12 rounded bg-muted-foreground/40" />
                  </span>
                  <span className="font-medium text-strong">{t.label}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Accent color">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
              {ACCENTS.map((a) => {
                const swatch = a.value === 'custom' ? brand : FIXED_SWATCH[a.value];
                const unavailable = a.value === 'custom' && !brand;
                const selected = design.accent === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={unavailable}
                    title={unavailable ? 'Set a brand color in Branding to use it here' : undefined}
                    onClick={() => pickAccent(a.value)}
                    className={cn(TAP, 'flex items-center gap-2 rounded-lg border px-3 text-sm disabled:opacity-50', selected ? 'border-primary ring-1 ring-primary' : 'border-line')}
                  >
                    <span
                      aria-hidden
                      data-accent-swatch={a.value}
                      className="flex size-5 items-center justify-center rounded-full border border-line text-white"
                      style={swatch ? { backgroundColor: swatch } : undefined}
                    >
                      {selected && <Check className="size-3" />}
                    </span>
                    {a.label}
                  </button>
                );
              })}
            </div>
          </Row>
          <div className="grid gap-5 sm:grid-cols-2">
            <Row label="Font">
              <Segmented label="Font" value={design.font} onChange={(v) => set('font', v)} options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }]} />
            </Row>
            <Row label="Header">
              <Segmented label="Header" value={design.header} onChange={(v) => set('header', v)} options={[{ value: 'name', label: 'Ministry name' }, { value: 'none', label: 'None' }]} />
            </Row>
            <Row label="Buttons">
              <Segmented label="Buttons" value={design.buttons} onChange={(v) => set('buttons', v)} options={[{ value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }]} />
            </Row>
          </div>
            </>
          )}
          <Row label="Footer note">
            <Input
              aria-label="Footer note"
              value={design.footerText}
              maxLength={200}
              onChange={(e) => set('footerText', e.target.value)}
              placeholder="You are receiving this because you joined our list."
              className={TAP}
            />
            <p className="text-xs text-faint">The unsubscribe link and your mailing address are always added below this.</p>
          </Row>
        </div>
        <DialogFooter className="border-line">
          <Button className="min-h-11" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as my theme</DialogTitle>
          <DialogDescription>
            Keeps the current colours, fonts and layout as your own theme. The built-in themes stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="saved-theme-name">Theme name</Label>
          <Input
            id="saved-theme-name"
            value={saveName}
            maxLength={60}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Sunday letter"
          />
        </div>
        {saveError && <ErrorNote>{saveError}</ErrorNote>}
        <DialogFooter className="border-line">
          <Button variant="outline" className="min-h-11" onClick={() => setSaveOpen(false)}>Cancel</Button>
          <Button className="min-h-11" disabled={saving || !saveName.trim()} onClick={() => void runSave()}>
            {saving ? 'Saving…' : 'Save theme'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
