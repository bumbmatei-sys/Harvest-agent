'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SIGNUP_FIELDS, parseSignupPageInput, type SignupFieldSettings, type SignupPageInput } from '@/lib/signup-pages/model';
import { authFetch } from '@/utils/auth-fetch';

export const fieldLabels = { name: 'Name', email: 'Email', phone: 'Phone', prayerRequest: 'Prayer request' } as const;
export const defaultFields: SignupFieldSettings = { name: { enabled: true, required: true }, email: { enabled: true, required: true }, phone: { enabled: false, required: false }, prayerRequest: { enabled: false, required: false } };
export type Page = SignupPageInput & { id: string; active: boolean };
export function SignupPageBuilder({ page, onSaved, onCancel, request = authFetch }: { page?: Page; onSaved: () => void; onCancel: () => void; request?: typeof authFetch }) {
  const [title, setTitle] = useState(page?.title ?? '');
  const [message, setMessage] = useState(page?.message ?? '');
  const [handle, setHandle] = useState(page?.handle ?? '');
  const [fields, setFields] = useState<SignupFieldSettings>(page?.fields ?? defaultFields);
  const [active, setActive] = useState(page?.active ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const input = parseSignupPageInput({ title, message, handle, fields });
    if (!input) { setError('Enter a title, a valid lowercase handle (3–50 letters, numbers or hyphens), and at least one field.'); return; }
    setSaving(true); setError('');
    try {
      const response = await request('/api/signup-pages', { method: page ? 'PATCH' : 'POST', body: JSON.stringify(page ? { ...input, pageId: page.id, active } : input) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Could not save page'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save page'); } finally { setSaving(false); }
  }
  return <Card><CardHeader><CardTitle>{page ? 'Edit sign-up page' : 'New sign-up page'}</CardTitle></CardHeader><CardContent><form onSubmit={save} className="space-y-5">
    <div className="space-y-2"><Label htmlFor="signup-title">Title</Label><Input className="min-h-11 sm:min-h-[38px]" id="signup-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required /></div>
    <div className="space-y-2"><Label htmlFor="signup-message">Message</Label><Textarea className="min-h-11 sm:min-h-[38px]" id="signup-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} /></div>
    <div className="space-y-2"><Label htmlFor="signup-handle">Handle</Label><Input className="min-h-11 sm:min-h-[38px]" id="signup-handle" value={handle} onChange={e => setHandle(e.target.value)} maxLength={50} required /><p className="text-sm text-muted-foreground">theharvest.app/s/{handle || 'your-handle'}</p></div>
    <fieldset className="space-y-4"><legend className="font-medium">Fields</legend>{SIGNUP_FIELDS.map(field => <div key={field} className="flex flex-wrap items-center gap-4"><Label htmlFor={`field-${field}`} className="min-w-32">{fieldLabels[field]}</Label><Switch id={`field-${field}`} checked={fields[field].enabled} onCheckedChange={enabled => setFields({ ...fields, [field]: { enabled, required: enabled && fields[field].required } })} /><Label htmlFor={`required-${field}`}>Required</Label><Switch id={`required-${field}`} disabled={!fields[field].enabled} checked={fields[field].required} onCheckedChange={required => setFields({ ...fields, [field]: { ...fields[field], required } })} /></div>)}</fieldset>
    {page && <div className="flex items-center gap-3"><Switch id="signup-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="signup-active">Page active</Label></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-2"><Button className="min-h-11 sm:min-h-[38px]" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save page'}</Button><Button className="min-h-11 sm:min-h-[38px]" type="button" variant="outline" onClick={onCancel}>Cancel</Button></div>
  </form></CardContent></Card>;
}
