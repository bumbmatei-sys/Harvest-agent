'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { type CommunitySettings, requiredQuestionsAnswered } from '@/lib/community/settings';

export function CommunityEntryDialog({ settings, onSubmit, initialAnswers = {}, communityName = 'the community', logoUrl }: {
  settings: CommunitySettings;
  communityName?: string; logoUrl?: string;
  initialAnswers?: Record<string, string>;
  onSubmit: (answers: Record<string, string>) => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canSubmit = (!settings.rules.enabled || accepted) &&
    (!settings.questions.enabled || requiredQuestionsAnswered(settings.questions.items, answers));
  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try { await onSubmit(answers); }
    catch { setError('Could not save your answers. Please try again.'); }
    finally { setSaving(false); }
  };
  return <Dialog open>
    <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-y-auto rounded-xl p-6 sm:max-h-[90vh] sm:max-w-lg">
      <div className="flex items-center gap-3"><Avatar size="lg">{logoUrl && <AvatarImage src={logoUrl} alt="" />}<AvatarFallback><Users size={20} /></AvatarFallback></Avatar><div><DialogTitle>Welcome to {communityName}</DialogTitle><p className="text-sm text-muted">{communityName}</p></div></div>
      <DialogDescription>Please complete these steps to enter.</DialogDescription>
      {settings.rules.enabled && <section className="space-y-3"><h2 className="font-semibold">Community rules</h2><ol className="space-y-2">{settings.rules.items.map((rule, i) => <li className="flex gap-3 rounded-lg border border-line bg-surface-sunken p-3 text-sm" key={i}><span className="font-semibold text-muted">{i + 1}.</span><span>{rule}</span></li>)}</ol><label className="flex items-center gap-3"><Checkbox checked={accepted} onCheckedChange={setAccepted} />I agree to the community rules</label></section>}
      {settings.questions.enabled && settings.questions.items.map(q => <fieldset key={q.id} className="space-y-2"><legend className="font-medium">{q.label}{q.required ? ' *' : ''}</legend>{q.type === 'short' ? <Input aria-label={q.label} value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} /> : <RadioGroup value={answers[q.id] || ''} onValueChange={value => setAnswers(a => ({ ...a, [q.id]: value }))}>{q.options.map(option => <label className="flex min-h-11 items-center gap-3" key={option}><RadioGroupItem value={option} />{option}</label>)}</RadioGroup>}</fieldset>)}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button className="min-h-11 sm:min-h-0" disabled={!canSubmit || saving} onClick={submit}>{saving ? 'Saving…' : 'Enter community'}</Button>
    </DialogContent>
  </Dialog>;
}
