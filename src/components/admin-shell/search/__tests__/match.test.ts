import { describe, expect, it } from 'vitest';

import { GROUP_LIMIT, groupHits, indexEntries, indexEntry, scoreIndexed, searchIndexed } from '../match';
import { digitsOf, normalizeText, plainPreview } from '../normalize';
import type { ContentTypeId, SearchEntry } from '../types';

const entry = (over: Partial<SearchEntry> & { title: string }): SearchEntry => ({
  type: 'person',
  id: over.title,
  ...over,
});

const titles = (items: SearchEntry[], query: string) => searchIndexed(indexEntries(items), query).map((h) => h.entry.title);

describe('normalizeText', () => {
  it('lower-cases, strips accents and collapses whitespace', () => {
    expect(normalizeText('  Café   ÉCLAIR ')).toBe('cafe eclair');
    expect(normalizeText('Ștefan Țepeș')).toBe('stefan tepes');
    expect(normalizeText('Ștefan')).toBe(normalizeText('STEFAN'));
    expect(normalizeText('Łódź Søren Straße')).toBe('lodz soren strasse');
  });

  it('answers an empty string for anything that is not text', () => {
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(42)).toBe('');
    expect(normalizeText(null)).toBe('');
  });

  it('reduces a phone number to its digits', () => {
    expect(digitsOf('+1 (555) 010-2030')).toBe('15550102030');
    expect(digitsOf(undefined)).toBe('');
  });

  it('previews rich text as plain text and slices before it strips', () => {
    expect(plainPreview('<h1>Sunday</h1><p>Bring &amp; share</p>', 100)).toBe('Sunday Bring & share');
    expect(plainPreview('<p>' + 'x'.repeat(5000) + '</p>', 50)).toHaveLength(50);
    expect(plainPreview(undefined)).toBe('');
  });
});

describe('searchIndexed matching', () => {
  const people = [entry({ title: 'Ștefan Popescu' }), entry({ title: 'Anna Stefanescu' }), entry({ title: 'José Álvarez' })];

  it('ignores case and accents in both directions', () => {
    expect(titles(people, 'stefan')).toEqual(['Ștefan Popescu', 'Anna Stefanescu']);
    expect(titles(people, 'ȘTEFAN')).toEqual(['Ștefan Popescu', 'Anna Stefanescu']);
    expect(titles(people, 'jose alvarez')).toEqual(['José Álvarez']);
    expect(titles(people, 'JOSÉ')).toEqual(['José Álvarez']);
  });

  it('matches anywhere in the title, not only at the start', () => {
    expect(titles(people, 'escu')).toEqual(['Anna Stefanescu', 'Ștefan Popescu']);
    expect(titles(people, 'varez')).toEqual(['José Álvarez']);
  });

  it('needs every term: "joh smi" finds John Smith, "john zzz" finds nothing', () => {
    const list = [entry({ title: 'John Smith' }), entry({ title: 'Joanna Smithers' })];
    expect(titles(list, 'joh smi')).toEqual(['John Smith']);
    expect(titles(list, 'john zzz')).toEqual([]);
    expect(titles(list, 'smith john')).toEqual(['John Smith']);
  });

  it('matches an email, a phone number in any format, and a body preview', () => {
    const list = [
      entry({ title: 'Maria Ionescu', extra: ['maria@example.org', '+40 722 111 222'] }),
      entry({ title: 'Welcome note', type: 'note', extra: ['Bring a dish to the potluck on Sunday'] }),
    ];
    expect(titles(list, 'maria@example')).toEqual(['Maria Ionescu']);
    expect(titles(list, '722 111')).toEqual(['Maria Ionescu']);
    expect(titles(list, '(722) 111-222')).toEqual(['Maria Ionescu']);
    expect(titles(list, 'potluck')).toEqual(['Welcome note']);
  });

  it('reads a dashed query as a phone number only when it has three digits', () => {
    const list = [entry({ title: 'Maria', extra: ['+40 722 111 222'] })];
    expect(titles(list, '722-111')).toEqual(['Maria']);
    expect(titles(list, '7-2-9')).toEqual([]);
  });

  it('matches the subtitle', () => {
    const list = [entry({ title: 'Grace North', type: 'campus', subtitle: 'Cluj-Napoca, Romania' })];
    expect(titles(list, 'cluj')).toEqual(['Grace North']);
  });

  it('returns nothing for a blank query', () => {
    expect(titles(people, '')).toEqual([]);
    expect(titles(people, '   ')).toEqual([]);
  });
});

describe('searchIndexed ranking', () => {
  it('puts a title that starts with the query above one that only contains it', () => {
    const list = [
      entry({ title: 'Easter planning notes', type: 'note' }),
      entry({ title: 'Notes from Easter', type: 'note' }),
      entry({ title: 'Easter', type: 'note' }),
      entry({ title: 'Pre-Easter prayer', type: 'note' }),
    ];
    expect(titles(list, 'easter')).toEqual(['Easter', 'Easter planning notes', 'Notes from Easter', 'Pre-Easter prayer']);
  });

  it('scores the tiers in order: exact, starts with, word starts with, contains, found elsewhere', () => {
    const score = (e: SearchEntry, q: string) => scoreIndexed(indexEntry(e), normalizeText(q));
    expect(score(entry({ title: 'Grace' }), 'grace')).toBe(5);
    expect(score(entry({ title: 'Grace Church' }), 'grace')).toBe(4);
    expect(score(entry({ title: 'New Grace Church' }), 'grace')).toBe(3);
    expect(score(entry({ title: 'Disgraceful' }), 'grace')).toBe(2);
    expect(score(entry({ title: 'Welcome', extra: ['grace@example.org'] }), 'grace')).toBe(1);
    expect(score(entry({ title: 'Welcome' }), 'grace')).toBe(0);
  });

  it('puts a title match above an email-only match', () => {
    const list = [
      entry({ title: 'Welcome', extra: ['sam@example.org'] }),
      entry({ title: 'Wesam Khoury' }),
    ];
    expect(titles(list, 'sam')).toEqual(['Wesam Khoury', 'Welcome']);
  });

  it('breaks a tie by most recently updated, then by name', () => {
    const list = [
      entry({ title: 'Anna Old', updatedAt: 100 }),
      entry({ title: 'Anna New', updatedAt: 900 }),
      entry({ title: 'Anna Undated' }),
    ];
    expect(titles(list, 'anna')).toEqual(['Anna New', 'Anna Old', 'Anna Undated']);
  });
});

describe('groupHits', () => {
  const order: ContentTypeId[] = ['page', 'person', 'note', 'course'];
  const make = (type: ContentTypeId, n: number) =>
    Array.from({ length: n }, (_, i) => entry({ type, id: `${type}${i}`, title: `Grace ${type} ${i}` }));

  it('groups by type in the given order, caps each group and keeps the true total', () => {
    const hits = searchIndexed(indexEntries([...make('course', 2), ...make('note', 12), ...make('person', 1)]), 'grace');
    const groups = groupHits(hits, order);
    expect(groups.map((g) => g.type)).toEqual(['person', 'note', 'course']);
    expect(groups.find((g) => g.type === 'note')).toMatchObject({ total: 12 });
    expect(groups.find((g) => g.type === 'note')!.shown).toHaveLength(GROUP_LIMIT);
    expect(groups.find((g) => g.type === 'course')!.shown).toHaveLength(2);
  });

  it('drops a type that has no hits and a type that is not in the order', () => {
    const hits = searchIndexed(indexEntries([...make('event', 3)]), 'grace');
    expect(groupHits(hits, order)).toEqual([]);
  });
});
