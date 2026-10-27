'use client';
import { Hash } from 'lucide-react';

export interface GroupListItem {
  id: string;
  name: string;
  description?: string;
  lastMessage?: string;
}

export function GroupList<T extends GroupListItem>({ channels, selectedId, onSelect, renderTime }: { channels: T[]; selectedId?: string; onSelect: (channel: T) => void; renderTime?: (channel: T) => React.ReactNode }) {
  if (!channels.length) return null;
  return <div className="mb-5">
    <p className="text-xs font-bold text-faint uppercase tracking-wider mb-2">Groups</p>
    <div className="space-y-2">{channels.map(ch => <button key={ch.id} onClick={() => onSelect(ch)} aria-pressed={selectedId === ch.id} className="w-full bg-surface-raised rounded-2xl border border-line-hairline px-4 py-3.5 flex items-center gap-3 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-xs transition-all text-left">
      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center lg:bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)]"><Hash size={18} style={{ color: 'var(--brand-color, #B8962E)' }} /></div>
      <div className="flex-1 min-w-0"><p className="text-sm font-bold text-strong truncate">#{ch.name}</p><p className="text-xs text-faint truncate">{ch.lastMessage || ch.description || 'No messages yet'}</p></div>
      {renderTime && <span className="text-[10px] text-faint flex-shrink-0">{renderTime(ch)}</span>}
    </button>)}</div>
  </div>;
}
