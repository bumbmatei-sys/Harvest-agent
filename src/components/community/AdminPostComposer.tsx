"use client";
import { Button } from '@/components/ui/button';

// THE-555: named classes let the touch-floor guard resolve every state.
const COMPOSER_PIN_BUTTON = 'h-auto min-h-11 sm:min-h-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors data-[pinned=true]:bg-[color-mix(in_srgb,var(--brand-color)_15%,transparent)] data-[pinned=true]:text-gold data-[pinned=false]:text-muted data-[pinned=false]:hover:bg-surface-sunken';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import React from 'react';
import Image from 'next/image';
import { Paperclip, Pin, Send, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ImageUpload } from '../ImageUpload';
import { EmbedComposerChip, type PostEmbed, type EmbedType } from '../EmbedCard';
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Option = { id: string; text: string; votes?: string[] };
export interface AdminPostComposerProps {
  user: { photoURL: string | null; displayName: string | null };
  editingPostId: string | null; composerMode: 'post' | 'poll'; setComposerMode: Setter<'post' | 'poll'>;
  composerText: string; setComposerText: Setter<string>; composerImages: string[]; setComposerImages: Setter<string[]>;
  composerEmbed: PostEmbed | null; setComposerEmbed: Setter<PostEmbed | null>;
  showImageAttach: boolean; setShowImageAttach: Setter<boolean>; attachMenuOpen: boolean; setAttachMenuOpen: Setter<boolean>;
  attachMenuRef: React.RefObject<HTMLDivElement>; pollOptions: Option[]; setPollOptions: Setter<Option[]>;
  scopeTenantId: string | null | undefined; setEmbedPicker: Setter<EmbedType | null>;
  composerPinned: boolean; setComposerPinned: Setter<boolean>; resetComposer: () => void;
  handleSubmitPost: () => void; isPosting: boolean; composerCanSubmit: boolean; canPostImages: boolean; preview?: boolean;
}
export function AdminPostComposer({ user, editingPostId, composerMode, setComposerMode, composerText, setComposerText, composerImages, setComposerImages, composerEmbed, setComposerEmbed, showImageAttach, setShowImageAttach, attachMenuOpen, setAttachMenuOpen, attachMenuRef, pollOptions, setPollOptions, scopeTenantId, setEmbedPicker, composerPinned, setComposerPinned, resetComposer, handleSubmitPost, isPosting, composerCanSubmit, canPostImages, preview = false }: AdminPostComposerProps) {
  const MAX_IMAGES = 3;
  return (
        <div className="bg-surface-raised rounded-2xl shadow-xs border border-line p-4 lg:rounded-[var(--ds-radius-card)] lg:shadow-[var(--ds-sh-sm)]">
          {/* Post / Poll switch (ported from AdminPosts). Hidden while editing so
              an existing post's type isn't accidentally flipped. */}
          {!editingPostId && (
            <ToggleGroup value={[composerMode]} onValueChange={values => {
              const mode = values[values.length - 1];
              if (mode === 'post') setComposerMode('post');
              if (mode === 'poll') {
                setComposerMode('poll'); setComposerImages([]); setShowImageAttach(false);
                setComposerEmbed(null); setAttachMenuOpen(false);
              }
            }} className="mb-3 w-fit">
              <ToggleGroupItem value="post" className="min-h-11">Post</ToggleGroupItem>
              <ToggleGroupItem value="poll" className="min-h-11">Poll</ToggleGroupItem>
            </ToggleGroup>
          )}
          <div className="flex items-start gap-3">
            <Avatar className="size-9 shrink-0"><AvatarImage src={user.photoURL || undefined} alt="You" referrerPolicy="no-referrer" /><AvatarFallback>{(user.displayName || 'Y').charAt(0)}</AvatarFallback></Avatar>
            <Textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              placeholder={composerMode === 'poll' ? 'Ask a question…' : editingPostId ? 'Edit your post…' : 'Share an update with the community…'}
              rows={2}
              className="h-auto min-h-11 sm:min-h-0 flex-1 min-w-0 bg-transparent border-none focus:ring-0 resize-none text-strong placeholder-[color:var(--text-faint)] text-sm p-0 pt-1.5 outline-hidden"
            />
          </div>

          {/* Poll options — add/remove; needs at least two non-empty to post. */}
          {composerMode === 'poll' && (
            <div className="space-y-2 mt-3 pl-12">
              {pollOptions.map((option, index) => (
                <div key={option.id} className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={option.text}
                    onChange={(e) => setPollOptions(prev => prev.map((o, i) => i === index ? { ...o, text: e.target.value } : o))}
                    placeholder={`Option ${index + 1}`}
                    className="h-auto min-h-11 sm:min-h-0 flex-1 px-3 py-2 bg-surface-sunken border border-line rounded-lg text-sm text-strong focus:ring-1 focus:ring-gold outline-hidden"
                  />
                  {pollOptions.length > 2 && (
                    <Button variant="ghost"
                      type="button"
                      onClick={() => setPollOptions(prev => prev.filter(o => o.id !== option.id))}
                      aria-label={`Remove option ${index + 1}`}
                      className="h-auto min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 p-2 text-faint hover:text-destructive transition-colors"
                    >
                      <X size={16} />
                    </Button>
                  )}
                </div>
              ))}
              {pollOptions.length < 5 && (
                <Button variant="ghost"
                  type="button"
                  onClick={() => setPollOptions(prev => [...prev, { id: Date.now().toString(), text: '' }])}
                  className="h-auto min-h-11 sm:min-h-0 text-sm text-gold font-medium hover:underline"
                >
                  + Add option
                </Button>
              )}
            </div>
          )}

          {/* Attached image thumbnails + remove-each (post mode only) */}
          {composerMode === 'post' && composerImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pl-12">
              {composerImages.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden bg-surface-sunken border border-line">
                  <Image src={url} alt={`Attachment ${i + 1}`} fill sizes="80px" className="object-cover" referrerPolicy="no-referrer" />
                  <Button variant="ghost"
                    type="button"
                    onClick={() => setComposerImages(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label={`Remove image ${i + 1}`}
                    className="h-auto min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 absolute top-1 right-1 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Image attach zone — reveals the uploader (reuses ImageUpload); appends to the array, capped at 3 */}
          {composerMode === 'post' && showImageAttach && canPostImages && (
            <div className="mt-3 pl-12">
              {preview ? <p className="text-sm text-muted">Image upload preview</p> : <ImageUpload
                value=""
                onChange={(url) => {
                  if (!url) return;
                  setComposerImages(prev => prev.length < MAX_IMAGES ? [...prev, url] : prev);
                }}
                label={`Add image (${composerImages.length}/${MAX_IMAGES})`}
              />}
            </div>
          )}

          {/* Attached embed preview — one per post, removable, replaced when a new one is picked */}
          {composerMode === 'post' && composerEmbed && (
            <div className="mt-3 pl-12">
              <EmbedComposerChip embed={composerEmbed} tenantId={scopeTenantId} onRemove={() => setComposerEmbed(null)} />
            </div>
          )}

          {/*
             THE-346 · `pl-12` IS GONE, and that ONE class was the whole bug.

            The founder: *"In news user app when creating a post put that
            paperclip and pin button in the left to be in parallel with the user
            profile picture."*

            The composer's text row is `flex items-start gap-3` with a `w-9`
            (36px) avatar, so the textarea beside it starts at 36 + 12 = 48px.
            `pl-12` is exactly that 48px, and it is CORRECT on the four rows
            above — poll options, the attachment chips, the image strip and the
            embed card all continue the SENTENCE the textarea started, so they
            line up with the text.

             THIS ROW IS NOT ONE OF THOSE. It is the composer's action bar —
            paperclip, Pin, Post — and it belongs to the whole composer, not to
            the text column, which is what the founder is seeing when he says it
            should be in parallel with the picture. Measured at 380px, before:
            the paperclip's icon sat at x=64 against an avatar at x=16.

             THE `-ml-2` ON THE PAPERCLIP STAYS, and it is why this is `pl-0`
            rather than `pl-2`. That negative margin exists so the ICON, not the
            44px hit area around it, is what aligns — the same optical trick the
            row's right-hand `Post` button gets from its own padding. With the
            indent gone the button's box starts 8px into the card's own padding
            and the GLYPH lands at exactly the avatar's left edge, which is the
            edge the founder is pointing at. Measured after: both at x=16.
          */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
            <div className="flex items-center gap-1">
              {/* Paperclip "add" menu — image + blog / fundraising / event embeds (post mode only). */}
              {composerMode === 'post' && (
                <div ref={attachMenuRef}>
                  <DropdownMenu open={attachMenuOpen} onOpenChange={setAttachMenuOpen}>
                    <DropdownMenuTrigger aria-label="Add attachment" className="p-2 -ml-2 text-muted hover:bg-surface-sunken hover:text-gold rounded-full min-h-11 min-w-11"><Paperclip size={18} /></DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="start" className="min-w-44">
                      <DropdownMenuItem className="min-h-11" disabled={!canPostImages} onClick={() => setShowImageAttach(true)}>{canPostImages ? 'Add image' : 'Max 3 images'}</DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11" onClick={() => setEmbedPicker('blog')}>Add blog article</DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11" onClick={() => setEmbedPicker('fundraising')}>Add fundraising</DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11" onClick={() => setEmbedPicker('event')}>Add event</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {/* Pin-to-top toggle (admin). Writes `isPinned` — the field the feed sorts on. */}
              <Button variant="ghost"
                type="button"
                onClick={() => setComposerPinned(p => !p)}
                aria-pressed={composerPinned}
                aria-label={composerPinned ? 'Unpin from top' : 'Pin to top'}
                data-pinned={composerPinned}
                className={COMPOSER_PIN_BUTTON}
              >
                <Pin size={15} className={composerPinned ? 'fill-current' : ''} />
                {composerPinned ? 'Pinned' : 'Pin'}
              </Button>
            </div>

            <div className="min-h-11 flex items-center gap-2">
              {editingPostId && (
                <Button variant="ghost"
                  type="button"
                  onClick={resetComposer}
                  className="h-auto min-h-11 sm:min-h-0 px-4 py-1.5 text-sm font-medium text-muted hover:bg-surface-sunken rounded-lg transition-colors"
                >
                  Cancel
                </Button>
              )}
              <Button variant="ghost"
                type="button"
                onClick={handleSubmitPost}
                disabled={isPosting || !composerCanSubmit}
                className="h-auto min-h-11 sm:min-h-0 flex items-center gap-2 px-5 py-1.5 bg-gold text-[var(--brand-foreground)] rounded-lg font-medium text-sm hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={16} />
                {editingPostId ? 'Update' : composerMode === 'poll' ? 'Post Poll' : 'Post'}
              </Button>
            </div>
          </div>
        </div>
  );
}
