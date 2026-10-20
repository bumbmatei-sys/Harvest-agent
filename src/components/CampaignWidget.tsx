"use client";
import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope, hasPlatformOverride, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { usePublicShareUrl } from '../utils/share-url';
import ShareButton from './ShareButton';
import { Heart, Clock, ChevronLeft, Loader2 } from 'lucide-react';
import { HeroBand, Eyebrow } from './member/desktopKit';
import { useTenant } from '@/contexts/TenantContext';
import CampaignGivingOptions from './donations/CampaignGivingOptions';
import { readGivingLinks } from './donations/giving-providers';
import { resolveCampaignGiving, type ResolvedCampaignGiving } from '@/lib/payment-link-selection';
import { isCardGivingOn } from '@/lib/card-giving';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export interface Campaign {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  goal: number;
  raised: number;
  endDate?: string;
  isActive: boolean;
  /** Legacy. Written by no editor since #13. Still opened below, ahead of a chosen link. */
  donateUrl?: string;
  /**
   * Provider ids only. Empty or absent means every link the ministry
   * publishes. Cleaned by `readSelectedProviderIds` inside
   * `resolveCampaignGiving`.
   */
  paymentProviders?: string[];
  tenantId?: string;
  campaignType?: string;
}

interface CampaignWidgetProps {
  onDonate?: (campaign: Campaign) => void;
}

const AMOUNT_PRESETS = [25, 50, 100, 250];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function campaignProgress(campaign: Campaign) {
  const percentage = campaign.goal > 0
    ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100))
    : 0;
  const daysLeft = campaign.endDate
    ? Math.max(0, Math.ceil((new Date(campaign.endDate).getTime() - Date.now()) / 86_400_000))
    : null;
  return { percentage, daysLeft };
}

/**
 * Giving rails for one campaign. The widget uses them to decide whether Give
 * Now has anywhere to go; the detail sheet uses the same answer to draw the
 * links. One hook so the button and the sheet cannot disagree.
 */
function useCampaignRails(paymentProviders: string[] | undefined): {
  giving: ResolvedCampaignGiving;
  cardGivingOn: boolean;
} {
  // THE-251 — the church's own payment links, for the campaign detail below.
  //
  // 🔴 THE SAME TABLE AND THE SAME VALIDATOR AS THE GIVE PAGE. `readGivingLinks`
  // re-derives every URL against its provider's host allow-list on READ, so a
  // link that no longer passes stops being a link here exactly as it does in
  // MainApp — one implementation, one answer, four surfaces.
  const { branding, tenantId: contextTenantId, stripeConnectStatus } = useTenant();
  const givingLinks = useMemo(() => readGivingLinks(branding), [branding]);
  const giving = useMemo(
    () => resolveCampaignGiving(givingLinks, paymentProviders),
    [givingLinks, paymentProviders],
  );
  // `isCardGivingOn` is MainApp.tsx:255 (`hasStripeGiving`). `isMainSite` is
  // the same derivation MainApp uses just above that line. While this is
  // false the sheet below draws no card form, so it cannot post to the
  // donate route.
  const isWhiteLabel = !!contextTenantId && contextTenantId !== PLATFORM_TENANT_ID;
  const isMainSite = !isWhiteLabel || hasPlatformOverride();
  const cardGivingOn = isCardGivingOn({ isMainSite, stripeConnectStatus });
  return { giving, cardGivingOn };
}

/**
 * The in-app campaign detail. The feed banner and a feed campaign card both
 * open this, so a member never has to leave for `/campaign/[id]` — that route
 * is the public share page, and it 404s when the host is not a tenant.
 */
export const CampaignDetailSheet: React.FC<{
  campaign: Campaign;
  onClose: () => void;
}> = ({ campaign, onClose }) => {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [donateError, setDonateError] = useState('');
  const { giving, cardGivingOn } = useCampaignRails(campaign.paymentProviders);
  const shareUrl = usePublicShareUrl(
    `/${campaign.campaignType === 'pledge' ? 'pledge' : 'campaign'}/${campaign.id}`,
  );
  const { percentage, daysLeft } = campaignProgress(campaign);

  useEffect(() => {
    if (auth.currentUser) {
      setDonorName(auth.currentUser.displayName || '');
      setDonorEmail(auth.currentUser.email || '');
    }
  }, []);

  const handleSubmitDonation = async () => {
    const amount = selectedAmount ?? (customAmount ? parseFloat(customAmount) : 0);
    if (!amount || amount <= 0) { setDonateError('Please select or enter an amount'); return; }
    if (!donorEmail.trim()) { setDonateError('Email is required'); return; }
    setIsProcessing(true);
    setDonateError('');
    try {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      const res = await fetch('/api/stripe/donate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          donationType: 'one-time',
          metadata: {
            type: 'donation',
            campaignId: campaign.id,
            tenantId: campaign.tenantId || '',
            donorName: donorName.trim(),
            donorEmail: donorEmail.trim(),
          },
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setDonateError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setDonateError('Network error. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="campaign-detail-sheet"
        className="inset-0! top-0! z-[300]! flex h-dvh! max-h-none! w-full! max-w-none! gap-0 overflow-y-auto rounded-none border-0 bg-surface-raised p-0 shadow-none data-[side=bottom]:inset-0! data-[side=bottom]:h-dvh! data-[side=bottom]:max-h-none! data-[side=bottom]:w-full! data-[side=bottom]:border-0 data-starting-style:translate-none! data-starting-style:opacity-100! sm:max-w-none!"
      >
      <SheetHeader className="sticky top-0 z-10 flex-row items-center gap-3 border-b border-line bg-surface-raised px-4 py-3">
        {/* `Button` is a plain function, so `render={<Button />}` cannot take
            the ref DialogClose needs and React warns. The close control is the
            Sheet primitive wearing `buttonVariants`, the same workaround
            AttachMenu uses. */}
        <SheetClose
          aria-label="Back"
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-11 shrink-0' })}
        >
          <ChevronLeft className="text-[var(--brand-color)]" strokeWidth={2.5} />
        </SheetClose>
        <SheetTitle className="min-w-0 flex-1 truncate font-display text-base font-bold text-strong">
          {campaign.title}
        </SheetTitle>
        <ShareButton url={shareUrl} title={campaign.title} />
      </SheetHeader>

      {campaign.coverImage && (
        <div className="relative h-52 bg-surface-sunken flex-shrink-0 lg:max-w-2xl lg:mx-auto w-full">
          <Image src={campaign.coverImage} alt={campaign.title} fill sizes="100vw" className="object-cover" referrerPolicy="no-referrer" />
          {daysLeft !== null && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-xs">
              <Clock size={12} />
              {daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}
            </div>
          )}
        </div>
      )}

      <div className="p-4 space-y-5 pb-10 lg:max-w-2xl lg:mx-auto w-full">
        <div className="bg-surface-sunken rounded-2xl p-4">
          <div className="flex justify-between items-baseline mb-2 text-sm">
            <span className="font-bold text-strong">{fmt(campaign.raised)} raised</span>
            <span className="text-muted">of {fmt(campaign.goal)}</span>
          </div>
          <div className="h-3 bg-surface-chip rounded-full overflow-hidden mb-1">
            <div className="h-full rounded-full" style={{ width: `${percentage}%`, backgroundColor: 'var(--brand-color, #e6b325)' }} />
          </div>
          <div className="text-right text-xs font-bold" style={{ color: 'var(--brand-color, #e6b325)' }}>{percentage}%</div>
        </div>

        <SheetDescription className="text-sm leading-relaxed text-muted">
          {campaign.description}
        </SheetDescription>

        {/* Card giving only. While the switch is off, none of this renders,
            so this sheet cannot post to `/api/stripe/donate`. */}
        {cardGivingOn && (
          <>
            <div>
              <p className="text-sm font-bold text-strong mb-3">Select Amount</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {AMOUNT_PRESETS.map(amt => (
                  <Button
                    key={amt}
                    type="button"
                    variant={selectedAmount === amt ? 'default' : 'outline'}
                    onClick={() => { setSelectedAmount(amt); setCustomAmount(''); }}
                    className="h-auto w-full py-2.5 font-bold"
                  >
                    ${amt}
                  </Button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                value={customAmount}
                onChange={e => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                placeholder="Custom amount ($)"
                className="h-auto rounded-xl px-3 py-2.5"
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-bold text-strong">Your Information</p>
              <Input
                value={donorName}
                onChange={e => setDonorName(e.target.value)}
                placeholder="Your name"
                className="h-auto rounded-xl px-3 py-2.5"
              />
              <Input
                type="email"
                value={donorEmail}
                onChange={e => setDonorEmail(e.target.value)}
                placeholder="Your email *"
                className="h-auto rounded-xl px-3 py-2.5"
              />
            </div>

            {donateError && (
              <p className="text-xs font-medium text-destructive">{donateError}</p>
            )}

            <Button
              type="button"
              onClick={handleSubmitDonation}
              disabled={isProcessing || (!selectedAmount && !customAmount)}
              className="h-auto w-full gap-2 py-3.5 font-bold"
            >
              {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Heart size={15} strokeWidth={2.5} />}
              {isProcessing
                ? 'Processing...'
                : `Donate${selectedAmount ? ` $${selectedAmount}` : customAmount ? ` $${customAmount}` : ''}`}
            </Button>
          </>
        )}

        <CampaignGivingOptions
          links={giving.links}
          directLink={giving.direct}
          narrowed={giving.narrowed}
          showCardForm={cardGivingOn}
          brandColor="var(--brand-color, #e6b325)"
        />
      </div>
      </SheetContent>
    </Sheet>
  );
};

const CampaignWidget: React.FC<CampaignWidgetProps> = ({ onDonate }) => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const { giving, cardGivingOn } = useCampaignRails(campaign?.paymentProviders);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      const tenantId = await getTenantScope();
      if (cancelled) return;

      // Single-field filter only (isActive); tenant scoping applied in-memory to avoid a composite index.
      const q = tenantId
        ? query(collection(db, 'campaigns'), where('tenantId', '==', tenantId), limit(20))
        : query(collection(db, 'campaigns'), where('isActive', '==', true), limit(20));

      unsub = onSnapshot(q, (snap) => {
        if (cancelled) return;
        const docs = snap.docs.filter(d => d.data().isActive === true);
        if (docs.length > 0) {
          const d = docs[0];
          setCampaign({ id: d.id, ...d.data() } as Campaign);
        } else {
          setCampaign(null);
        }
        setLoading(false);
      }, (err) => {
        console.error('Failed to load campaign:', err);
        if (!cancelled) setLoading(false);
      });
    })();

    return () => { cancelled = true; unsub?.(); };
  }, []);

  if (loading || !campaign) return null;

  const { percentage, daysLeft } = campaignProgress(campaign);

  // Same shape as MainApp's `hasGivingRails`: a Give Now button with nowhere
  // to land is a dead control. A legacy donateUrl, a published link, or card
  // giving each count. None of them means the campaign card stays and the
  // button does not. `onDonate` is a handoff, not a rail of its own.
  const showGiveNow = Boolean(campaign.donateUrl) || giving.links.length > 0 || cardGivingOn;

  const handleDonateClick = () => {
    if (campaign.donateUrl) {
      window.open(campaign.donateUrl, '_blank', 'noopener,noreferrer');
    } else if (giving.direct) {
      window.open(giving.direct.url, '_blank', 'noopener,noreferrer');
    } else if (onDonate) {
      onDonate(campaign);
    } else {
      setShowDetail(true);
    }
  };

  const openDetail = () => setShowDetail(true);

  const onBannerKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetail();
    }
  };

  return (
    <>
      {/* Navy "money band" campaign banner — the Harvest Member App design.
          A cover photo (when set) washes behind the navy→gold gradient. Stacks
          on mobile, goes horizontal on desktop. The whole band opens the
          in-app detail. Give Now keeps its own destination and must not also
          activate the band. */}
      <div className="mb-4 lg:mb-3">
        {/* `ui/button` has no `asChild` — it is Base UI. `nativeButton={false}`
            is the equivalent: the band is the accessible control, and Give Now
            stays a real button inside it. A native button here would nest two
            buttons, which is invalid. */}
        <Button
          variant="ghost"
          nativeButton={false}
          render={<div />}
          aria-label={`View ${campaign.title}`}
          onClick={openDetail}
          onKeyDown={onBannerKeyDown}
          className="block h-auto w-full cursor-pointer whitespace-normal rounded-[var(--ds-radius-card)] bg-transparent p-0 text-left font-normal hover:bg-transparent active:translate-y-0"
        >
          <HeroBand
            className="w-full px-5 py-5 lg:px-6"
            backdrop={campaign.coverImage ? (
              <span aria-hidden className="absolute inset-0 pointer-events-none">
                <Image
                  src={campaign.coverImage}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 900px"
                  className="object-cover opacity-25"
                  style={{ objectPosition: 'center 35%' }}
                  referrerPolicy="no-referrer"
                />
              </span>
            ) : null}
          >
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <Eyebrow tone="glow" className="truncate">{campaign.title}</Eyebrow>
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className="font-display font-light text-[30px] leading-none text-white tracking-[-0.02em]">{fmt(campaign.raised)}</span>
                  <span className="text-[13px] text-white/70">of {fmt(campaign.goal)}</span>
                </div>
                <div className="mt-3 h-1.5 w-full lg:w-[220px] max-w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.2)' }}>
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${percentage}%`, background: 'var(--wheat-glow)' }} />
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-white/60">
                  <span className="font-semibold" style={{ color: 'var(--wheat-glow)' }}>{percentage}% funded</span>
                  {daysLeft !== null && (
                    <span className="flex items-center gap-1"><Clock size={11} />{daysLeft === 0 ? 'Last day!' : `${daysLeft} days left`}</span>
                  )}
                </div>
              </div>
              {showGiveNow && (
                <Button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDonateClick();
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                  }}
                  className="h-11 self-start px-5 lg:self-auto"
                >
                  Give Now
                </Button>
              )}
            </div>
          </HeroBand>
        </Button>
      </div>

      {showDetail && (
        <CampaignDetailSheet campaign={campaign} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
};

export default CampaignWidget;
