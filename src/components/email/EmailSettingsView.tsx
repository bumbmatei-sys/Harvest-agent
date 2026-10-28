'use client';

import { useEffect, useState } from 'react';
import { Facebook, Globe, Instagram, Linkedin, Music2, Plus, Trash2, Twitter, Youtube } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EmailApiError, type SettingsFocus, type EmailApi, type EmailSettings, type Overview } from '@/components/email/email-api';
import { PlatformLimitsCard } from '@/components/email/PlatformLimitsCard';
import { UsageMeter } from '@/components/email/UsageMeter';
import { ErrorNote, TAP } from '@/components/email/kit';
import {
  MAX_SOCIAL_LINKS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  type SocialLink,
  type SocialPlatform,
} from '@/lib/email/themes';
import { cn } from '@/lib/utils';

/** Lucide glyphs for the platform picker rows. The email footer itself uses names, not icons. */
const PLATFORM_ICONS: Readonly<Record<SocialPlatform, React.ComponentType<{ className?: string }>>> = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  x: Twitter,
  tiktok: Music2,
  linkedin: Linkedin,
  website: Globe,
};

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-strong">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <Card className="gap-5 p-6">{children}</Card>
    </section>
  );
}

export function EmailSettingsView({ api, data, focus = null, onSaved, onLimitsSaved }: {
  api: Pick<EmailApi, 'saveSettings' | 'saveLimits'>;
  data: Pick<Overview, 'settings' | 'usage' | 'canEditLimits' | 'limits'>;
  /** Scrolls to and focuses this part when the page opens, for a deep link from the send step. */
  focus?: SettingsFocus | null;
  onSaved: (next: EmailSettings) => void;
  onLimitsSaved: () => void;
}) {
  const { settings } = data;
  const [fromName, setFromName] = useState(settings.fromName);
  const [replyTo, setReplyTo] = useState(settings.replyTo);
  const [mailingAddress, setMailingAddress] = useState(settings.mailingAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl);
  const [footerNote, setFooterNote] = useState(settings.footerNote);
  const [socialLinks, setSocialLinks] = useState<readonly SocialLink[]>(settings.socialLinks);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandSaved, setBrandSaved] = useState(false);

  useEffect(() => {
    if (!focus) return;
    // Both focus targets land on the sender details: there is no domain to set up.
    document.getElementById('email-sender-section')?.scrollIntoView?.({ block: 'start' });
    document.getElementById('email-from-name')?.focus({ preventScroll: true });
  }, [focus]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // The send-from part of the address stays whatever it already was: the sender is Harvest's.
      onSaved(await api.saveSettings({ fromName, replyTo, mailingAddress, fromLocal: settings.fromLocal }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'Your settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function setLink(index: number, patch: Partial<SocialLink>) {
    setSocialLinks((list) => list.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setBrandSaved(false);
  }

  async function saveBrand() {
    setBrandBusy(true);
    setBrandError(null);
    setBrandSaved(false);
    try {
      onSaved(await api.saveSettings({ logoUrl, footerNote, socialLinks }));
      setBrandSaved(true);
    } catch (e) {
      setBrandError(e instanceof EmailApiError ? e.message : 'Your logo and footer could not be saved.');
    } finally {
      setBrandBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Section id="email-sender-section" title="Sender">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-from-name">From name</Label>
            <Input id="email-from-name" className={TAP} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Grace Church" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-reply-to">Replies go to</Label>
            <Input id="email-reply-to" type="email" className={TAP} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="office@yourchurch.org" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-address">Mailing address</Label>
          <Textarea id="email-address" rows={2} value={mailingAddress} onChange={(e) => setMailingAddress(e.target.value)} placeholder="1 Main Street, Springfield" />
          <p className="text-xs text-faint">The law requires a mailing address at the bottom of every marketing email.</p>
        </div>
        <p className="text-sm text-muted" data-sender-note>
          Emails are sent from Harvest&apos;s own sending address, under your name, and replies come to the address above.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-3">
          <Button className="min-h-11" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
          {saved && <span role="status" className="text-sm text-muted">Saved.</span>}
        </div>
      </Section>

      <Section title="Logo and footer" description="Set these once. Every email theme shows them.">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-logo-url">Logo web address</Label>
          <Input
            id="email-logo-url"
            type="url"
            className={TAP}
            value={logoUrl}
            onChange={(e) => { setLogoUrl(e.target.value); setBrandSaved(false); }}
            placeholder="https://yourchurch.org/logo.png"
          />
          <p className="text-xs text-faint">A full https:// link to your logo image. It shows at the top of every email, beside your ministry name.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-footer-note">Footer note</Label>
          <Textarea
            id="email-footer-note"
            rows={2}
            value={footerNote}
            maxLength={300}
            onChange={(e) => { setFooterNote(e.target.value); setBrandSaved(false); }}
            placeholder="A sign-off or a line about your ministry."
          />
          <p className="text-xs text-faint">Shows at the bottom of every email, above the unsubscribe link and your mailing address (those are always there).</p>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <Label className="text-xs font-medium uppercase tracking-wide text-faint">Social links</Label>
            <p className="mt-0.5 text-xs text-faint">Shown as a row of names in the footer of every email.</p>
          </div>
          {socialLinks.map((link, index) => {
            const Icon = PLATFORM_ICONS[link.platform];
            return (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <span aria-hidden className="flex size-9 items-center justify-center rounded-md border border-line bg-surface-raised text-muted">
                  <Icon className="size-4" />
                </span>
                <Select value={link.platform} onValueChange={(v) => setLink(index, { platform: v as SocialPlatform })}>
                  <SelectTrigger className={cn(TAP, 'w-36')} aria-label="Platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>{SOCIAL_PLATFORM_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`${SOCIAL_PLATFORM_LABELS[link.platform]} address`}
                  className={cn(TAP, 'min-w-[12rem] flex-1')}
                  value={link.url}
                  onChange={(e) => setLink(index, { url: e.target.value })}
                  placeholder="https://"
                />
                <Button
                  type="button"
                  variant="ghost"
                  // A literal, not {TAP}: THE-356 measures every Button call
                  // site and its resolver reads literals and form-layout
                  // constants only — an imported token would throw there.
                  className="min-h-11"
                  aria-label={`Remove the ${SOCIAL_PLATFORM_LABELS[link.platform]} link`}
                  onClick={() => { setSocialLinks((list) => list.filter((_, i) => i !== index)); setBrandSaved(false); }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
          {socialLinks.length < MAX_SOCIAL_LINKS && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-fit gap-2"
              onClick={() => { setSocialLinks((list) => [...list, { platform: 'facebook', url: '' }]); setBrandSaved(false); }}
            >
              <Plus className="size-4" />
              Add link
            </Button>
          )}
        </div>
        {brandError && <ErrorNote>{brandError}</ErrorNote>}
        <div className="flex items-center gap-3">
          <Button className="min-h-11" disabled={brandBusy} onClick={() => void saveBrand()}>{brandBusy ? 'Saving…' : 'Save'}</Button>
          {brandSaved && <span role="status" className="text-sm text-muted">Saved.</span>}
        </div>
      </Section>

      <Section title="Emails this month" description="Your plan includes a monthly number of emails. Your list can be any size.">
        <UsageMeter usage={data.usage} />
      </Section>

      {/* "Advanced" (bring your own Plunk key) is hidden while it is coming soon. Mailchimp is not
          part of it at all: Harvest replaces Mailchimp, it does not connect to it. */}
      {data.canEditLimits && data.limits && <PlatformLimitsCard api={api} limits={data.limits} onSaved={() => onLimitsSaved()} />}
    </div>
  );
}
