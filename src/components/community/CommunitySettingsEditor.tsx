'use client';

import { useState } from 'react';
import { BookOpen, Calendar, Gift, Globe, Heart, Lock, Map, MessageSquare, Newspaper, Radio, Rss } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COMMUNITY_MODULES, type CommunityModule, type CommunityQuestion, type CommunitySettings, prepareCommunitySettings } from '@/lib/community/settings';

const labels: Record<CommunityModule, string> = {
  news: 'News feed', blog: 'Blog', courses: 'Courses', events: 'Events', messages: 'Messages and groups',
  prayer: 'Prayer', give: 'Give', livestream: 'Livestream', bible: 'Bible', map: 'Map',
};

const moduleDetails: Record<CommunityModule, { icon: typeof Rss; description: string }> = {
  news: { icon: Rss, description: 'Share updates with your community.' }, blog: { icon: Newspaper, description: 'Publish articles and stories.' },
  courses: { icon: BookOpen, description: 'Learn and grow together.' }, events: { icon: Calendar, description: 'Bring members together.' },
  messages: { icon: MessageSquare, description: 'Connect in group conversations.' }, prayer: { icon: Heart, description: 'Share prayer requests.' },
  give: { icon: Gift, description: 'Share ways to give.' }, livestream: { icon: Radio, description: 'Watch live together.' },
  bible: { icon: BookOpen, description: 'Read and explore scripture.' }, map: { icon: Map, description: 'Find members and places.' },
};

type Props = {
  settings: CommunitySettings;
  available: Record<CommunityModule, boolean>;
  onSave: (settings: CommunitySettings, previous: CommunitySettings) => Promise<void>;
};

export function CommunitySettingsEditor({ settings, available, onSave }: Props) {
  const [saved, setSaved] = useState(settings);
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const updateQuestion = (index: number, changes: Partial<CommunityQuestion>) => setDraft(current => ({
    ...current, questions: { ...current.questions, items: current.questions.items.map((q, i) => i === index ? { ...q, ...changes } : q) },
  }));
  const save = async () => {
    setError('');
    try {
      const next = prepareCommunitySettings(saved, draft);
      setSaving(true);
      await onSave(next, saved);
      setSaved(next);
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save community settings.');
    } finally { setSaving(false); }
  };
  return <div className="mx-auto max-w-4xl space-y-6 p-4">
    <div><h1 className="font-display text-2xl font-semibold">Community setup</h1><p className="text-sm text-muted">Choose what members see and how they join.</p></div>
    <Tabs defaultValue="modules">
      <TabsList><TabsTrigger value="modules">Modules</TabsTrigger><TabsTrigger value="rules">Rules</TabsTrigger><TabsTrigger value="questions">Questions</TabsTrigger></TabsList>
      <TabsContent value="modules"><Card><CardHeader><CardTitle>Modules</CardTitle></CardHeader><CardContent className="space-y-4">
        {COMMUNITY_MODULES.map(key => { const Icon = moduleDetails[key].icon; return <div className="flex items-center justify-between gap-4 border-b border-line py-3" key={key}><div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-muted"><Icon size={18} /></span><div><p className="text-sm font-medium">{labels[key]}</p><p className="text-xs text-muted">{moduleDetails[key].description}</p>{!available[key] && <Badge variant="outline" className="mt-1"><Lock size={12} /> Not on your plan</Badge>}</div></div><Switch aria-label={labels[key]} checked={draft.modules[key]} disabled={!available[key]} onCheckedChange={checked => setDraft(d => ({ ...d, modules: { ...d.modules, [key]: checked } }))} /></div>; })}
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4"><div><p className="flex items-center gap-2 text-sm font-medium"><Globe size={16} /> Public community</p><p className="text-xs text-muted">Allow this community to appear in Discovery.</p></div><Switch aria-label="Public community" checked={draft.isPublic} onCheckedChange={checked => setDraft(d => ({ ...d, isPublic: checked }))} /></div>
        <label className="block space-y-2 text-sm">Short description<Input aria-label="Short description" maxLength={240} value={draft.shortDescription} onChange={e => setDraft(d => ({ ...d, shortDescription: e.target.value }))} /></label>
        <label className="block space-y-2 text-sm">Community logo URL<Input aria-label="Community logo URL" placeholder="Uses ministry logo when empty" value={draft.logoUrl} onChange={e => setDraft(d => ({ ...d, logoUrl: e.target.value }))} /></label>
      </CardContent></Card></TabsContent>
      <TabsContent value="rules"><Card><CardHeader><CardTitle>Community rules</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between"><span>Require members to accept rules</span><Switch aria-label="Require rules" checked={draft.rules.enabled} onCheckedChange={enabled => setDraft(d => ({ ...d, rules: { ...d.rules, enabled } }))} /></div>
        {draft.rules.items.map((rule, index) => <div className="flex gap-2" key={index}><Input aria-label={`Rule ${index + 1}`} value={rule} onChange={e => setDraft(d => ({ ...d, rules: { ...d.rules, items: d.rules.items.map((item, i) => i === index ? e.target.value : item) } }))} /><Button className="min-h-11 sm:min-h-0" variant="outline" onClick={() => setDraft(d => ({ ...d, rules: { ...d.rules, items: d.rules.items.filter((_, i) => i !== index) } }))}>Remove</Button></div>)}
        <Button className="min-h-11 sm:min-h-0" variant="outline" onClick={() => setDraft(d => ({ ...d, rules: { ...d.rules, items: [...d.rules.items, ''] } }))}>Add rule</Button>
      </CardContent></Card></TabsContent>
      <TabsContent value="questions"><Card><CardHeader><CardTitle>Joining questions</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between"><span>Ask questions when members join</span><Switch aria-label="Enable questions" checked={draft.questions.enabled} onCheckedChange={enabled => setDraft(d => ({ ...d, questions: { ...d.questions, enabled } }))} /></div>
        {draft.questions.items.map((q, index) => <div className="space-y-2 rounded-lg border border-line p-3" key={q.id}><Input aria-label={`Question ${index + 1}`} value={q.label} onChange={e => updateQuestion(index, { label: e.target.value })} placeholder="Question" /><label className="text-sm">Type <select className="ml-2 rounded border border-line bg-surface-raised p-1" value={q.type} onChange={e => updateQuestion(index, { type: e.target.value as CommunityQuestion['type'] })}><option value="short">Short text</option><option value="choice">Multiple choice</option></select></label>{q.type === 'choice' && <Input aria-label="Choices, separated by commas" placeholder="Choices, separated by commas" value={q.options.join(',')} onChange={e => updateQuestion(index, { options: e.target.value.split(',') })} />}<div className="flex flex-wrap items-center gap-2"><Switch aria-label={`Required question ${index + 1}`} checked={q.required} onCheckedChange={required => updateQuestion(index, { required })} /><span className="text-sm">Required</span><Button className="min-h-11 sm:min-h-0" variant="outline" disabled={index === 0} onClick={() => setDraft(d => { const items = [...d.questions.items]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; return { ...d, questions: { ...d.questions, items } }; })}>Move up</Button><Button className="min-h-11 sm:min-h-0" variant="outline" onClick={() => setDraft(d => ({ ...d, questions: { ...d.questions, items: d.questions.items.filter(item => item.id !== q.id) } }))}>Remove</Button></div></div>)}
        <Button className="min-h-11 sm:min-h-0" variant="outline" onClick={() => setDraft(d => ({ ...d, questions: { ...d.questions, items: [...d.questions.items, { id: crypto.randomUUID(), type: 'short', label: '', options: [], required: false }] } }))}>Add question</Button>
      </CardContent></Card></TabsContent>
    </Tabs>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button className="min-h-11 sm:min-h-0" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
  </div>;
}
