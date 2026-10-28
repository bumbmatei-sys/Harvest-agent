'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Star } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type Review = { authorName: string; authorPhotoURL: string | null; rating: number; text: string; createdAt: unknown; memberSince: unknown };
type OwnReview = { rating: number; text: string };
type Access = { getToken: () => Promise<string> };
function dateOf(value: unknown): Date | null {
  const seconds = value && typeof value === 'object' ? (value as { _seconds?: number; seconds?: number })._seconds ?? (value as { seconds?: number }).seconds : undefined;
  const date = typeof seconds === 'number' ? new Date(seconds * 1000) : typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
function tenure(value: unknown): string | null {
  const date = dateOf(value); if (!date || date.getTime() > Date.now()) return null;
  const now = new Date(); let months = (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth();
  if (now.getDate() < date.getDate()) months--;
  return `Member for ${Math.max(0, months)} months`;
}
export function Stars({ rating }: { rating: number }) {
  return <span className="inline-flex" aria-label={`${rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} size={16} aria-hidden="true" fill={n <= rating ? 'var(--brand-color)' : 'none'} stroke="var(--brand-color)" />)}</span>;
}
export function HarvestFooter() {
  return <footer className="mx-auto mt-10 border-t border-line py-6 text-center text-xs text-muted"><a href="https://theharvest.app" target="_blank" rel="noopener" className="hover:underline">Made with Harvest</a></footer>;
}
export function ReviewDialog({ open, onOpenChange, review, onSave, onDelete }: { open: boolean; onOpenChange: (open: boolean) => void; review: OwnReview | null; onSave: (review: OwnReview) => Promise<void>; onDelete: () => Promise<void> }) {
  const [rating, setRating] = useState<number>(0); const [text, setText] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setRating(review?.rating ?? 0); setText(review?.text ?? ''); setError(''); } }, [open, review]);
  const submit = async (deleting = false) => {
    if (!deleting && (!rating || text.length > 1000)) { setError(!rating ? 'Choose a star rating.' : 'Review must be 1000 characters or fewer.'); return; }
    setSaving(true); setError('');
    try { if (deleting) await onDelete(); else await onSave({ rating, text }); onOpenChange(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save your review.'); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{review ? 'Edit your review' : 'Write a review'}</DialogTitle><DialogDescription>Share your experience with this community.</DialogDescription></DialogHeader>
    <ToggleGroup aria-label="Star rating" value={rating ? [String(rating)] : []} onValueChange={values => setRating(Number(values[values.length - 1]) || 0)}>{[1, 2, 3, 4, 5].map(n => <ToggleGroupItem key={n} value={String(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`} className="min-h-11 min-w-11"><Star aria-hidden="true" fill={n <= rating ? 'var(--brand-color)' : 'none'} stroke="var(--brand-color)" /></ToggleGroupItem>)}</ToggleGroup>
    <Textarea aria-label="Review" maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="Write a review..." /><p className="text-right text-xs text-muted">{text.length}/1000</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={saving} onClick={() => void submit()}>Save review</Button>{review && <Button className="min-h-11" variant="outline" disabled={saving} onClick={() => void submit(true)}>Delete review</Button>}</div>
  </DialogContent></Dialog>;
}
export function CommunityReviews({ tenantId, access, onRatingChange }: { tenantId: string; access?: Access; onRatingChange?: (aggregate: { ratingAvg: number; ratingCount: number }) => void }) {
  const [sort, setSort] = useState('newest'); const [reviews, setReviews] = useState<Review[] | null>(null); const [next, setNext] = useState<number | null>(null); const [error, setError] = useState(''); const [loadingMore, setLoadingMore] = useState(false);
  const [own, setOwn] = useState<OwnReview | null>(null); const [canReview, setCanReview] = useState(false); const [open, setOpen] = useState(false); const [revision, setRevision] = useState(0);
  const load = useCallback(async (offset: number, signal?: AbortSignal) => {
    const headers: Record<string, string> = {}; if (access) headers.Authorization = `Bearer ${await access.getToken()}`;
    const response = await fetch(`/api/community/reviews?tenantId=${encodeURIComponent(tenantId)}&sort=${sort}&offset=${offset}`, { headers, signal });
    if (!response.ok) throw new Error('Could not load reviews. Please try again.');
    const data = await response.json(); if (!Array.isArray(data.reviews) || !(data.nextOffset === null || Number.isInteger(data.nextOffset))) throw new Error('Could not load reviews. Please try again.');
    setReviews(previous => offset ? [...(previous || []), ...data.reviews] : data.reviews); setNext(data.nextOffset);
  }, [tenantId, sort, access]);
  useEffect(() => { const controller = new AbortController(); setReviews(null); setError(''); load(0, controller.signal).catch(() => { if (!controller.signal.aborted) setError('Could not load reviews. Please try again.'); }); return () => controller.abort(); }, [load, revision]);
  useEffect(() => { if (!access) return; let active = true; setCanReview(false);
    (async () => { const token = await access.getToken(); const response = await fetch(`/api/community/reviews?tenantId=${encodeURIComponent(tenantId)}&mine=1`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error(); const data = await response.json(); if (active) { setCanReview(data.canReview === true); setOwn(data.review); } })().catch(() => { if (active) setError('Could not load your review access. Please try again.'); }); return () => { active = false; };
  }, [access, tenantId, revision]);
  const write = async (method: 'POST' | 'DELETE', review?: OwnReview) => { if (!access) throw new Error('Sign in to review.'); const token = await access.getToken(); const response = await fetch('/api/community/reviews', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ tenantId, ...review }) }); if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Could not save your review.'); } const result = await response.json(); if (!result.aggregate || typeof result.aggregate.ratingAvg !== 'number' || typeof result.aggregate.ratingCount !== 'number') throw new Error('Review saved, but its updated rating could not be loaded.'); onRatingChange?.(result.aggregate); setRevision(n => n + 1); };
  return <section className="space-y-4 border-t border-line pt-6" aria-label="Reviews"><div className="flex items-center justify-between gap-3"><h3 className="font-display text-2xl font-semibold">Reviews</h3><Select value={sort} onValueChange={value => { if (value) setSort(value); }}><SelectTrigger aria-label="Sort reviews" className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Newest</SelectItem><SelectItem value="highest">Highest</SelectItem><SelectItem value="lowest">Lowest</SelectItem></SelectContent></Select></div>
    {canReview && <Button variant="outline" className="min-h-11 w-full justify-start" onClick={() => setOpen(true)}>{own ? 'Edit your review' : 'Write a review'}</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!reviews && !error ? <div aria-label="Loading reviews" className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : reviews && reviews.length === 0 ? <p className="text-sm text-muted">No reviews yet.</p> : reviews?.map((review, index) => { const date = dateOf(review.createdAt); const memberTenure = tenure(review.memberSince); return <div key={`${review.authorName}-${index}`} className="flex gap-3"><Avatar><AvatarImage src={review.authorPhotoURL || undefined} alt="" /><AvatarFallback>{review.authorName.slice(0, 1)}</AvatarFallback></Avatar><Card className="flex-1 bg-surface-sunken"><CardContent className="space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{review.authorName}</span><Stars rating={review.rating} /></div><p className="whitespace-pre-wrap">{review.text}</p><p className="text-xs text-muted">{date && formatDistanceToNow(date, { addSuffix: true })}{date && memberTenure && ' · '}{memberTenure}</p></CardContent></Card></div>; })}
    {next !== null && <Button variant="outline" className="min-h-11" disabled={loadingMore} onClick={() => { setLoadingMore(true); load(next).catch(() => setError('Could not load more reviews. Please try again.')).finally(() => setLoadingMore(false)); }}>Load more reviews</Button>}
    {access && <ReviewDialog open={open} onOpenChange={setOpen} review={own} onSave={review => write('POST', review)} onDelete={() => write('DELETE')} />}
  </section>;
}
