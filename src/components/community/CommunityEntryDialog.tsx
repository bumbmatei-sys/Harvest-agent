'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { type CommunitySettings, requiredQuestionsAnswered } from '@/lib/community/settings';

export function CommunityEntryDialog({ settings, onSubmit }: {
  settings: CommunitySettings;
  onSubmit: (answers: Record<string, string>) => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
    <DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogTitle>Welcome to the community</DialogTitle>
      <DialogDescription>Please complete these steps to enter.</DialogDescription>
      {settings.rules.enabled && <section className="space-y-3"><h2 className="font-semibold">Community rules</h2><ol className="list-decimal space-y-2 pl-5">{settings.rules.items.map((rule, i) => <li key={i}>{rule}</li>)}</ol><label className="flex items-center gap-3"><Checkbox checked={accepted} onCheckedChange={setAccepted} />I agree to the community rules</label></section>}
      {settings.questions.enabled && settings.questions.items.map(q => <fieldset key={q.id} className="space-y-2"><legend className="font-medium">{q.label}{q.required ? ' *' : ''}</legend>{q.type === 'short' ? <Input aria-label={q.label} value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} /> : q.options.map(option => <label className="flex items-center gap-2" key={option}><input type="radio" name={q.id} value={option} checked={answers[q.id] === option} onChange={() => setAnswers(a => ({ ...a, [q.id]: option }))} />{option}</label>)}</fieldset>)}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button disabled={!canSubmit || saving} onClick={submit}>{saving ? 'Saving…' : 'Enter community'}</Button>
    </DialogContent>
  </Dialog>;
}
