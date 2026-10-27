'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ImageIcon, ImagePlus, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SOCIAL_MEDIA_MIME_TYPES, validateSocialMedia } from '@/lib/social/media-rules';
import { uploadSocialMedia } from '@/lib/social/upload-media';
import type { SocialMedia } from '@/lib/social/types';

export interface Attachment {
  id: string;
  media: SocialMedia;
  progress?: number;
  error?: string;
  preview?: string;
}

export function attachmentsFromMedia(media: readonly SocialMedia[]): Attachment[] {
  return media.map((item) => ({ id: crypto.randomUUID(), media: item }));
}

export function PostMediaThumb({ media }: { media: readonly SocialMedia[] }) {
  const first = media[0];
  if (!first) return null;
  return (
    <span className="relative inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted" aria-label={`${media.length} media attachment${media.length === 1 ? '' : 's'}`}>
      {first.url && first.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={first.url} alt={first.alt || first.name || 'Post attachment'} className="size-full object-cover" />
      ) : first.kind === 'video' ? <Play className="size-5" aria-hidden /> : <ImageIcon className="size-5" aria-hidden />}
      {media.length > 1 && <span className="absolute bottom-0 right-0 rounded bg-card px-1 text-xs text-strong">+{media.length - 1}</span>}
    </span>
  );
}

export function MediaAttachments({ items, setItems, children }: { items: Attachment[]; setItems: React.Dispatch<React.SetStateAction<Attachment[]>>; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  async function addFiles(files: File[]) {
    const additions: Attachment[] = files.map((file) => ({
      id: crypto.randomUUID(),
      media: { name: file.name, kind: (SOCIAL_MEDIA_MIME_TYPES.video as readonly string[]).includes(file.type) ? 'video' : 'image', mimeType: file.type },
      progress: 0,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    const invalid = files.map((file, index) => validateSocialMedia([{ ...additions[index].media, size: file.size }], []));
    setItems((current) => [...current, ...additions.map((item, index) => invalid[index] ? { ...item, progress: undefined, error: 'Unsupported media type or file size.' } : item)]);
    await Promise.all(additions.map(async (item, index) => {
      if (invalid[index]) {
        if (item.preview) URL.revokeObjectURL(item.preview);
        return;
      }
      try {
        const { auth } = await import('@/firebase');
        const user = auth.currentUser;
        if (!user) throw new Error('Sign in to upload media.');
        const token = await user.getIdToken();
        const media = await uploadSocialMedia(files[index], token, (progress) => {
          setItems((current) => current.map((row) => row.id === item.id ? { ...row, progress } : row));
        });
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, media, progress: undefined } : row));
      } catch (error) {
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, progress: undefined, error: error instanceof Error ? error.message : 'Upload failed.' } : row));
      } finally {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
    }));
  }

  useEffect(() => {
    const card = root.current?.closest('[data-testid="social-composer"]') ?? root.current;
    if (!card) return;
    const drag = (event: Event) => { event.preventDefault(); };
    const drop = (event: Event) => {
      event.preventDefault();
      const files = (event as DragEvent).dataTransfer?.files;
      if (files?.length) void addFiles(Array.from(files));
    };
    card.addEventListener('dragover', drag);
    card.addEventListener('drop', drop);
    return () => { card.removeEventListener('dragover', drag); card.removeEventListener('drop', drop); };
  });

  function move(index: number, offset: number) {
    setItems((current) => {
      const next = [...current];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div ref={root} className="flex flex-col gap-2">
      {children}
      <input ref={input} type="file" multiple accept={[...SOCIAL_MEDIA_MIME_TYPES.image, ...SOCIAL_MEDIA_MIME_TYPES.video].join(',')} className="sr-only" aria-label="Choose media files" onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
      <div className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <div key={item.id} className="w-36 rounded-lg border border-line bg-card p-2">
            <PostMediaThumb media={[item.progress !== undefined && item.preview ? { ...item.media, url: item.preview } : item.media]} />
            <p className="truncate text-xs text-strong" title={item.media.name}>{item.media.name}</p>
            {item.progress !== undefined && <Progress value={item.progress} aria-label={`Uploading ${item.media.name}`} />}
            {item.error && <p role="alert" className="text-xs text-destructive">{item.error}</p>}
            {!item.media.url && item.progress === undefined && !item.error && <p className="text-xs text-destructive">This attachment has no URL. Remove it before saving.</p>}
            <div className="flex">
              <Button type="button" variant="ghost" className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px]" aria-label={`Move ${item.media.name} left`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowLeft className="size-4" /></Button>
              <Button type="button" variant="ghost" className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px]" aria-label={`Move ${item.media.name} right`} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowRight className="size-4" /></Button>
              <Button type="button" variant="ghost" className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px]" aria-label={`Remove ${item.media.name}`} onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><X className="size-4" /></Button>
            </div>
          </div>
        ))}
      </div>
      <div><Button type="button" variant="outline" className="min-h-[44px] sm:min-h-[38px]" onClick={() => input.current?.click()}><ImagePlus className="size-4" aria-hidden />Add media</Button></div>
    </div>
  );
}
