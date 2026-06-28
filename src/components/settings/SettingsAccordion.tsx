"use client";
import React, { useState, useCallback, ReactNode, useEffect } from 'react';
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

  // Allow external control (e.g. Stripe return URL opens a specific section)
  useEffect(() => {
    if (forceOpen) setExpanded(forceOpen);
  }, [forceOpen]);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {sections.filter(s => !s.hidden).map(section => (
        <div key={section.id} className="border-b border-gray-100 last:border-0">
          <button
            onClick={() => toggle(section.id)}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
          >
            <span className="text-gray-400 flex items-center">{section.icon}</span>
            <span className="flex-1 text-sm font-medium text-gray-800">{section.label}</span>
            <ChevronDown
              size={16}
              className={`text-gray-400 transition-transform ${expanded === section.id ? 'rotate-180' : ''}`}
            />
          </button>
          {expanded === section.id && (
            <div className="px-4 py-4 border-t border-gray-100 bg-white">
              {section.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default SettingsAccordion;
