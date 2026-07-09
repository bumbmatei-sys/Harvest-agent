"use client";
import React, { useState, useCallback, ReactNode, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface SettingsSection {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  hidden?: boolean;
  /** Render the row in the danger tone (e.g. Cancel Subscription). */
  danger?: boolean;
}

interface SettingsAccordionProps {
  sections: SettingsSection[];
  defaultOpen?: string;
  /** Controlled: external section to expand (e.g. from Stripe return URL) */
  forceOpen?: string | null;
}

const SettingsAccordion: React.FC<SettingsAccordionProps> = ({ sections, defaultOpen, forceOpen }) => {
  const [expanded, setExpanded] = useState<string | null>(defaultOpen || null);

  // Allow external control (e.g. Stripe return URL opens a specific section)
  useEffect(() => {
    if (forceOpen) setExpanded(forceOpen);
  }, [forceOpen]);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="space-y-2.5">
      {sections.filter(s => !s.hidden).map(section => (
        <div key={section.id} className="bg-white rounded-brand border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
          <button
            onClick={() => toggle(section.id)}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-stone-100/60 transition-colors text-left"
          >
            <span className={`flex items-center shrink-0 ${section.danger ? 'text-[#C4553B]' : 'text-gold'}`}>{section.icon}</span>
            <span className={`flex-1 text-sm font-semibold ${section.danger ? 'text-[#C4553B]' : 'text-earth'}`}>{section.label}</span>
            <ChevronDown
              size={16}
              className={`text-[color:var(--text-faint)] transition-transform ${expanded === section.id ? 'rotate-180' : ''}`}
            />
          </button>
          {expanded === section.id && (
            <div className="px-5 py-4 border-t border-stone-200">
              {section.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default SettingsAccordion;
