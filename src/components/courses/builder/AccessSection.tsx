'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Card, StepSection } from '@/components/courses/builder/kit';
import { ErrorNote } from '@/components/email/kit';
import { attachCommunity, detachCommunity } from '@/lib/courses/access';
import type { MemberList, MemberRef } from '@/lib/courses/members';
import type { CommunityRef, CourseAccessMode, ProductCourse } from '@/types/course-product.types';

const RESULT_LIMIT = 6;

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; list: MemberList };

function PeoplePicker({ selected, onChange, loadMembers }: { selected: readonly string[]; onChange: (ids: string[]) => void; loadMembers: () => Promise<MemberList> }) {
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setState({ status: 'loading' });
    loadMembers().then(
      (list) => setState({ status: 'ready', list }),
      () => setState({ status: 'error', message: 'The member list could not be loaded, so you cannot add people right now.' }),
    );
  }, [loadMembers]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(state.status === 'ready' ? state.list.members.map((m) => [m.uid, m]) : []), [state]);
  const matches = useMemo<MemberRef[]>(() => {
    if (state.status !== 'ready') return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return state.list.members
      .filter((m) => !selected.includes(m.uid) && `${m.name} ${m.email}`.toLowerCase().includes(q))
      .slice(0, RESULT_LIMIT);
  }, [state, search, selected]);

  const labelOf = (id: string) => {
    const m = byId.get(id);
    return m ? (m.name || m.email || 'Member') : 'Member not in this list';
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5" data-people-picker>
      <div>
        <Label htmlFor="access-search" className="text-sm font-medium text-strong">People with access</Label>
        <p className="mt-0.5 text-xs text-muted">Search your members and add anyone who should be able to open this course.</p>
      </div>
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="People with access">
          {selected.map((id) => (
            <li key={id} className="flex items-center gap-1 rounded-full bg-surface-sunken py-0.5 pl-3 pr-0.5 text-sm text-strong" data-access-person={id}>
              {labelOf(id)}
              <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 rounded-full" aria-label={`Remove ${labelOf(id)}`} onClick={() => onChange(selected.filter((x) => x !== id))}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted" data-no-people>Nobody is on the list yet.</p>
      )}
      {state.status === 'loading' && <Skeleton className="h-11 w-full" />}
      {state.status === 'error' && (
        <div className="flex flex-col items-start gap-2">
          <ErrorNote>{state.message}</ErrorNote>
          <Button type="button" variant="outline" className="min-h-11" onClick={load}>Try again</Button>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <Input id="access-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" autoComplete="off" />
          {matches.length > 0 && (
            <ul className="overflow-hidden rounded-lg border border-line" aria-label="Matching members">
              {matches.map((m) => (
                <li key={m.uid} className="flex items-center justify-between gap-3 border-t border-line px-3 first:border-t-0">
                  <span className="min-w-0 py-2 text-sm">
                    <span className="block truncate font-medium text-strong">{m.name || 'Member'}</span>
                    <span className="block truncate text-xs text-muted">{m.email}</span>
                  </span>
                  <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => { onChange([...selected, m.uid]); setSearch(''); }}>Add</Button>
                </li>
              ))}
            </ul>
          )}
          {search.trim() && matches.length === 0 && <p className="text-sm text-muted" data-no-match>No member matches “{search.trim()}”.</p>}
          {state.list.truncated && (
            <p className="text-xs text-muted" data-members-truncated>
              Showing the first {state.list.members.length} of {state.list.total} members. Search covers only those.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CommunityAttach({ communities, attached, onChange }: { communities: readonly CommunityRef[]; attached: readonly string[]; onChange: (ids: string[]) => void }) {
  if (communities.length === 0) {
    return (
      <Empty className="border-0 py-8" data-no-communities>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Users /></EmptyMedia>
          <EmptyTitle>No communities yet</EmptyTitle>
          <EmptyDescription>
            Once you have a community, attach this course to it here and its members will find the course in the community&apos;s Classroom.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul aria-label="Communities" className="flex flex-col divide-y divide-line">
      {communities.map((c) => {
        const on = attached.includes(c.id);
        return (
          <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <Label htmlFor={`community-${c.id}`} className="text-sm font-medium text-strong">{c.name}</Label>
              <p className="text-xs text-muted">{on ? 'Shown in its Classroom. Its members can open this course.' : 'Not attached'}</p>
            </div>
            <Switch id={`community-${c.id}`} checked={on} onCheckedChange={(v) => onChange(v ? attachCommunity(attached, c.id) : detachCommunity(attached, c.id))} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Who gets in. A course is its own product with its own access list, and it can
 * also be attached to any number of communities; a member of any of them gets
 * in too. The decision itself lives in lib/courses/access.ts.
 */
export function AccessSection({ course, onChange, communities, loadMembers }: {
  course: ProductCourse;
  onChange: (patch: Partial<ProductCourse>) => void;
  communities: readonly CommunityRef[];
  loadMembers: () => Promise<MemberList>;
}) {
  const mode: CourseAccessMode = course.accessMode === 'restricted' ? 'restricted' : 'everyone';
  return (
    <>
    <StepSection title="Who can open it" description="Choose who gets in. Members you add and members of attached communities can open it.">
      <Card>
        <div className="px-4 py-3.5">
          <RadioGroup
            value={mode}
            onValueChange={(v: unknown) => onChange({ accessMode: String(v) as CourseAccessMode })}
            aria-label="Who can open this course"
            className="gap-3"
          >
            <label className="flex items-start gap-3" htmlFor="access-everyone">
              <RadioGroupItem id="access-everyone" value="everyone" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-strong">Everyone in the ministry</span>
                <span className="block text-xs text-muted">Every member can open it once it is published.</span>
              </span>
            </label>
            <label className="flex items-start gap-3" htmlFor="access-restricted">
              <RadioGroupItem id="access-restricted" value="restricted" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-strong">Only people I choose</span>
                <span className="block text-xs text-muted">The access list below, plus members of any community it is attached to.</span>
              </span>
            </label>
          </RadioGroup>
        </div>
        {mode === 'restricted' && (
          <PeoplePicker selected={course.accessUserIds ?? []} onChange={(ids) => onChange({ accessUserIds: ids })} loadMembers={loadMembers} />
        )}
      </Card>
    </StepSection>
    <StepSection title="Show it in a community" description="A community can carry this course as a tab. Attaching never copies it: the course stays one product, and members of any attached community get in.">
        <Card>
          <CommunityAttach communities={communities} attached={course.communityIds ?? []} onChange={(ids) => onChange({ communityIds: ids })} />
        </Card>
    </StepSection>
    </>
  );
}
