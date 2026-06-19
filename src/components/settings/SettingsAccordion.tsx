"use client";
import React, { useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface SettingsSection {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  hidden?: boolean;
}

interface SettingsAccordionProps {
  sections: SettingsSection[];
  defaultOpen?: string;
  /** Controlled: external section to expand (e.g. from Stripe return URL) */
  forceOpen?: string | null;
}

const SettingsAccordion: React.FC<SettingsAccordionProps> = ({ sections, defaultOpen, forceOpen }) => {
  const [expanded, setExpanded] = useState<string | null>(defaultOpen || null);
  const contentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Allow external control (e.g. Stripe return URL opens a specific section)
  useEffect(() => {
    if (forceOpen) setExpanded(forceOpen);
  }, [forceOpen]);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="space-y-3">
      {sections.filter(s => !s.hidden).map(section => (
        <div key={section.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => toggle(section.id)}
            className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-600">
                {section.icon}
              </div>
              <span className="font-semibold text-gray-900">{section.label}</span>
            </div>
            <ChevronDown
              size={20}
              className={`text-gray-400 transition-transform duration-200 ${expanded === section.id ? 'rotate-180' : ''}`}
            />
          </button>
          <div
            ref={el => { contentRefs.current[section.id] = el; }}
            style={{
              maxHeight: expanded === section.id ? (contentRefs.current[section.id]?.scrollHeight || 2000) + 'px' : '0',
              overflow: 'hidden',
              transition: 'max-height 0.3s ease-in-out',
            }}
          >
            <div className="px-5 pb-5 border-t border-gray-100 pt-4">
              {section.content}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SettingsAccordion;
