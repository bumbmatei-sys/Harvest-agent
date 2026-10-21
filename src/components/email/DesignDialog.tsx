'use client';

import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ACCENT_LABELS, THEME_LABELS, type EmailAccent, type EmailDesign, type EmailTheme } from '@/lib/email/design';
import { Segmented, TAP } from '@/components/email/kit';
import { cn } from '@/lib/utils';

const THEMES = (Object.keys(THEME_LABELS) as EmailTheme[]).map((value) => ({ value, label: THEME_LABELS[value] }));
const ACCENTS = (Object.keys(ACCENT_LABELS) as EmailAccent[]).map((value) => ({ value, label: ACCENT_LABELS[value] }));

/** The swatch is the one place the brand palette shows in the app UI, through theme tokens. */
const SWATCH: Record<EmailAccent, string> = { navy: 'bg-navy-900', gold: 'bg-gold', harbor: 'bg-navy-600' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium uppercase tracking-wide text-faint">{label}</Label>
      {children}
    </div>
  );
}

export function DesignDialog({ open, onOpenChange, design, onChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  design: EmailDesign;
  onChange: (next: EmailDesign) => void;
}) {
  const set = <K extends keyof EmailDesign>(key: K, value: EmailDesign[K]) => onChange({ ...design, [key]: value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Design</DialogTitle>
          <DialogDescription>Colors, fonts, header, buttons and footer for this email.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
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
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  role="radio"
                  aria-checked={design.accent === a.value}
                  onClick={() => set('accent', a.value)}
                  className={cn(TAP, 'flex items-center gap-2 rounded-lg border px-3 text-sm', design.accent === a.value ? 'border-primary ring-1 ring-primary' : 'border-line')}
                >
                  <span aria-hidden className={cn('flex size-5 items-center justify-center rounded-full text-white', SWATCH[a.value])}>
                    {design.accent === a.value && <Check className="size-3" />}
                  </span>
                  {a.label}
                </button>
              ))}
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
        <DialogFooter>
          <Button className="min-h-11" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
