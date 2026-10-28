'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export type GroupAudience = 'all' | 'selected' | 'admins';
export type GroupDraft = { name: string; description: string; audience: GroupAudience; members: string[] };
type Person = { id: string; displayName?: string; email?: string };

export function NewGroupDialog({ open, onOpenChange, people, loadingPeople, peopleError, onCreate, initialAudience = 'all' }: {
  open: boolean; onOpenChange: (open: boolean) => void; people: Person[]; loadingPeople: boolean; peopleError: boolean;
  onCreate: (draft: GroupDraft) => Promise<void>; initialAudience?: GroupAudience;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState<GroupAudience>(initialAudience);
  const [members, setMembers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const close = () => { setName(''); setDescription(''); setAudience('all'); setMembers([]); setSearch(''); setError(''); onOpenChange(false); };
  const create = async () => {
    if (!name.trim() || (audience === 'selected' && !members.length)) return;
    setSaving(true); setError('');
    try { await onCreate({ name: name.trim(), description: description.trim(), audience, members: audience === 'selected' ? members : [] }); close(); }
    catch { setError('Could not create the group. Please try again.'); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next && !saving) close(); }}>
    <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
      <DialogTitle>New group</DialogTitle>
      <DialogDescription>Create a group for your community.</DialogDescription>
      <label className="space-y-1"> <span>Group name</span><Input value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="space-y-1"> <span>Description (optional)</span><Input value={description} onChange={e => setDescription(e.target.value)} /></label>
      <fieldset className="space-y-2"><legend className="font-medium">Audience</legend>
        <RadioGroup value={audience} onValueChange={value => setAudience(value as GroupAudience)}>
          {([['all', 'Everyone'], ['selected', 'Selected people'], ['admins', 'Admins only']] as const).map(([id, label]) => <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-surface-sunken" key={id}><RadioGroupItem value={id} />{label}</label>)}
        </RadioGroup>
      </fieldset>
      {audience === 'selected' && <div className="space-y-2"><p className="text-xs text-muted">Search covers up to 200 loaded accounts.</p><Input aria-label="Search people" placeholder="Search people" value={search} onChange={e => setSearch(e.target.value)} />
        {loadingPeople ? <p>Loading people…</p> : peopleError ? <p role="alert">Could not load people.</p> : <div className="max-h-48 overflow-y-auto">{people.filter(p => `${p.displayName || ''} ${p.email || ''}`.toLowerCase().includes(search.toLowerCase())).map(person => <label className="flex min-h-11 items-center gap-3" key={person.id}><Checkbox checked={members.includes(person.id)} onCheckedChange={checked => setMembers(current => checked ? [...current, person.id] : current.filter(id => id !== person.id))} /><Avatar><AvatarFallback>{(person.displayName || person.email || '?').charAt(0).toUpperCase()}</AvatarFallback></Avatar><span>{person.displayName || person.email || 'Unknown'}</span></label>)}</div>}
      </div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button className="min-h-11 sm:min-h-0" variant="outline" disabled={saving} onClick={close}>Cancel</Button><Button className="min-h-11 sm:min-h-0" disabled={saving || !name.trim() || (audience === 'selected' && (!members.length || peopleError || loadingPeople))} onClick={create}>{saving ? 'Creating…' : 'Create group'}</Button></div>
    </DialogContent>
  </Dialog>;
}
