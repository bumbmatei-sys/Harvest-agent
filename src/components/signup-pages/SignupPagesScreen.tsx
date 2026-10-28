'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SIGNUP_FIELDS, isValidSignupFieldSettings, type SignupFieldSettings } from '@/lib/signup-pages/model';
import { authFetch } from '@/utils/auth-fetch';
import { SignupPageBuilder, type Page } from './SignupPageBuilder';
import { ShareCard } from './ShareCard';
import { SubmissionsTable } from './SubmissionsTable';
function readPage(value: any): Page {
  const fields: Record<string, unknown> = {};
  if (!value || !Array.isArray(value.fields)) throw new Error('Invalid page data');
  for (const entry of value.fields) { if (!entry || !SIGNUP_FIELDS.includes(entry.key) || fields[entry.key]) throw new Error('Invalid page data'); fields[entry.key] = { enabled: entry.enabled, required: entry.required }; }
  if (!isValidSignupFieldSettings(fields) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.message !== 'string' || typeof value.handle !== 'string' || typeof value.active !== 'boolean') throw new Error('Invalid page data');
  return { id: value.id, title: value.title, message: value.message, handle: value.handle, active: value.active, fields: fields as SignupFieldSettings };
}
export function SignupPagesScreen({ tenantId }: { tenantId?: string | null }) {
  const [pages, setPages] = useState<Page[] | null>(null); const [error, setError] = useState(''); const [editing, setEditing] = useState<Page | 'new' | null>(null); const [selected, setSelected] = useState<Page | null>(null);
  const load = useCallback(async () => { setError(''); try { if (tenantId === null) throw new Error('Tenant required'); const url = tenantId === undefined ? '/api/signup-pages' : `/api/signup-pages?tenantId=${encodeURIComponent(tenantId)}`; const r = await authFetch(url); if (!r.ok) throw new Error(); const data = await r.json(); if (!Array.isArray(data.pages)) throw new Error(); setPages(data.pages.map(readPage)); } catch { setPages(null); setError('Could not load sign-up pages. Please try again.'); } }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  if (editing) return <SignupPageBuilder page={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setSelected(null); void load(); }} />;
  if (selected) return <div className="space-y-5"><div className="flex flex-wrap items-center gap-3"><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={() => setSelected(null)}>Back to pages</Button><h1 className="text-2xl font-semibold">{selected.title}</h1><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={() => setEditing(selected)}>Edit</Button></div>{!selected.active && <p className="text-muted-foreground">This page is inactive.</p>}<ShareCard handle={selected.handle} /><SubmissionsTable pageId={selected.id} /></div>;
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Sign-up pages</h1><Button className="min-h-11 sm:min-h-[38px]" onClick={() => setEditing('new')}><Plus className="mr-2 h-4 w-4" />New sign-up page</Button></div>{error && <div role="alert" className="space-y-2"><p className="text-destructive">{error}</p><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={() => void load()}>Retry</Button></div>}{!pages && !error && <p>Loading pages…</p>}{pages?.length === 0 && <Card><CardContent className="py-8 text-muted-foreground">No sign-up pages yet. Create one to share with your community.</CardContent></Card>}{pages?.map(page => <Card key={page.id}><CardHeader><CardTitle>{page.title}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="break-all text-sm text-muted-foreground">theharvest.app/s/{page.handle} {page.active ? '' : '(inactive)'}</p><Button className="min-h-11 sm:min-h-[38px]" variant="outline" onClick={() => setSelected(page)}>View page</Button></CardContent></Card>)}</div>;
}
export default SignupPagesScreen;
