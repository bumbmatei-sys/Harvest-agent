'use client';
import { Hash, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface GroupListItem {
  id: string;
  name: string;
  description?: string;
  lastMessage?: string;
  unreadCount?: number;
}

export function GroupList<T extends GroupListItem>({ channels, selectedId, onSelect, renderTime }: { channels: T[]; selectedId?: string; onSelect: (channel: T) => void; renderTime?: (channel: T) => React.ReactNode }) {
  if (!channels.length) return null;
  const ordered = [...channels].sort((a, b) => Number(b.id === 'all-members') - Number(a.id === 'all-members'));
  return <div className="mb-5">
    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-faint">Groups</p>
    <div className="space-y-1">{ordered.map(ch => <Button variant="ghost" key={ch.id} onClick={() => onSelect(ch)} aria-pressed={selectedId === ch.id} className="flex h-auto min-h-11 whitespace-normal w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-sunken aria-pressed:bg-surface-sunken">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-chip text-muted">{ch.id === 'all-members' ? <Users size={19} /> : <Hash size={19} />}</div>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-strong">#{ch.name}</p><p className="truncate text-xs text-faint">{ch.lastMessage || ch.description || 'No messages yet'}</p></div>
      <div className="flex shrink-0 flex-col items-end gap-1"><span className="text-[10px] text-faint">{renderTime?.(ch)}</span>{typeof ch.unreadCount === 'number' && ch.unreadCount > 0 && <Badge>{ch.unreadCount}</Badge>}</div>
    </Button>)}</div>
  </div>;
}
