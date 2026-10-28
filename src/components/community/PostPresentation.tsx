'use client';

import { useState, type ReactNode } from 'react';
import { Pin } from 'lucide-react';
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

export function MemberAvatar({ name, photo, level, small = false }: { name: string; photo?: string; level?: number; small?: boolean }) {
  return <Avatar size={small ? 'default' : 'lg'}>
    {photo && <AvatarImage src={photo} alt={name} referrerPolicy="no-referrer" />}
    <AvatarFallback>{name.charAt(0)}</AvatarFallback>
    {typeof level === 'number' && Number.isFinite(level) && <AvatarBadge className="!size-5 text-[10px]" aria-label={`Level ${level}`}>{level}</AvatarBadge>}
  </Avatar>;
}

export function relativeCommentTime(value: string): string | null {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PostHeader({ name, photo, level, createdAt, category, pinned, actions }: { name: string; photo?: string; level?: number; createdAt: string; category?: string; pinned?: boolean; actions?: ReactNode }) {
  const date = new Date(createdAt);
  const dateLabel = Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  return <div className="mb-3 flex items-start justify-between gap-2">
    <div className="flex min-w-0 items-center gap-3">
      <MemberAvatar name={name} photo={photo} level={level} />
      <div className="min-w-0"><h4 className="font-bold text-strong text-sm">{name}</h4><p className="text-xs text-muted">{dateLabel}{category ? ` • ${category}` : ''}</p></div>
    </div>
    <div className="flex shrink-0 items-center gap-1">{pinned && <span className="flex items-center gap-1 text-xs font-semibold text-strong"><Pin size={14} /> Pinned</span>}{actions}</div>
  </div>;
}

export function PostText({ content, title }: { content: string; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const heading = title || lines.shift() || '';
  const body = title ? content : lines.join('\n').trim();
  return <div className="mb-3 min-w-0">
    {heading && <p className={`font-bold text-strong whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-2'}`}>{heading}</p>}
    {body && <p className={`text-sm text-body whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-2'}`}>{body}</p>}
    {(body || heading.length > 100) && <Button type="button" variant="link" className="h-auto min-h-11 p-0 text-xs text-gold sm:min-h-0" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read more'}</Button>}
  </div>;
}

export function CommentActivity({ comment, viewerId }: { comment?: { createdAt: string; authorId: string }; viewerId?: string }) {
  if (!comment) return null;
  const relative = relativeCommentTime(comment.createdAt);
  if (!relative) return null;
  const age = Date.now() - new Date(comment.createdAt).getTime();
  const isNew = age >= 0 && age < 7 * 24 * 60 * 60 * 1000 && comment.authorId !== viewerId;
  return <span className={`text-xs font-semibold ${isNew ? 'text-gold' : 'text-muted'}`}>{isNew ? 'New' : 'Last'} comment {relative}</span>;
}
