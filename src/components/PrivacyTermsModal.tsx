"use client";
import React from 'react';
import { ArrowLeft, ExternalLink, ShieldCheck, FileText, Receipt, type LucideIcon } from 'lucide-react';
import { visibleLegalLinks, type LegalLinkKey } from '../lib/legal-links';
import ModalContentContainer from './ModalContentContainer';

interface PrivacyTermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The SAME admin flag that gates the Admin Dashboard entry on the Profile
   * screen, passed down rather than re-derived here. One condition, one place
   * it can drift. It gates the Refund & Cancellation link ONLY — Privacy and
   * Terms render for every viewer.
   */
  isAdmin: boolean;
}

const ICONS: Record<LegalLinkKey, LucideIcon> = {
  privacy: ShieldCheck,
  terms: FileText,
  refunds: Receipt,
};

/**
 * Privacy & Terms — a signpost, not a document.
 *
 * This screen used to carry the app's own copy of the Privacy Policy and Terms
 * of Use. That copy contradicted the canonical documents on theharvest.site, so
 * it is gone: see src/lib/legal-links.ts for what it said and why none of it
 * should come back here. The screen and its Profile entry stay, because a
 * removed entry is a dead end and the links are the whole point.
 */
const PrivacyTermsModal: React.FC<PrivacyTermsModalProps> = ({ isOpen, onClose, isAdmin }) => {
  if (!isOpen) return null;

  const links = visibleLegalLinks(isAdmin);

  /* z-[300], not z-50: the desktop sidebar (MainApp.tsx) is `lg:relative
       z-[100]`, so a z-50 overlay is painted UNDERNEATH it. `inset-0` still spanned
       the viewport, but its left 224px sat behind the rail — which is how body copy
       ended up clipped mid-word, and why `mx-auto` centred the column 112px left of
       where every other page centres. z-[300] matches the sibling overlays opened
       from the same settings list (UserEvents / SavedItems / DonationHistory in
       Profile.tsx). Guarded in modal-content-surface.test.tsx. */
  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-surface animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 py-4 bg-surface-raised border-b border-line sticky top-0 z-10">
        <button onClick={onClose} className="p-2 -ml-2 text-muted" aria-label="Back">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-lg font-bold text-strong flex-1 text-center pr-8 font-display">Privacy &amp; Terms</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ModalContentContainer>
          <p className="text-sm text-muted leading-relaxed mb-5 px-1">
            Harvest keeps one copy of each policy, published on our website, so what you read here is
            always the version in force. Each link opens in your browser.
          </p>

          <div className="bg-surface-raised rounded-3xl shadow-xs border border-line overflow-hidden">
            {links.map((link, i) => {
              const Icon = ICONS[link.key];
              return (
                <React.Fragment key={link.key}>
                  {i > 0 && <div className="h-px bg-surface-sunken mx-4" />}
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-between gap-3 p-3.5 hover:bg-surface-sunken transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-wheat-100">
                        <Icon size={16} className="text-wheat-600" />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[13px] font-medium text-body">{link.label}</span>
                        <span className="block text-[11px] text-faint">{link.description}</span>
                      </div>
                    </div>
                    <ExternalLink size={16} className="text-faint shrink-0" />
                  </a>
                </React.Fragment>
              );
            })}
          </div>
        </ModalContentContainer>
      </div>
    </div>
  );
};

export default PrivacyTermsModal;
