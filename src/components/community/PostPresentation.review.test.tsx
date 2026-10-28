import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentActivity } from './PostPresentation';

afterEach(() => vi.useRealTimers());
describe('comment activity', () => {
  it('distinguishes recent, stale, and own comments', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2040-06-20T12:00:00Z'));
    const render = (createdAt: string, authorId: string) => renderToStaticMarkup(<CommentActivity comment={{ createdAt, authorId }} viewerId="me" />);
    expect(render('2040-06-20T11:50:00Z', 'other')).toContain('New comment 10m ago');
    expect(render('2040-06-20T11:50:00Z', 'other')).toContain('text-gold');
    expect(render('2040-06-13T12:00:00Z', 'other')).toContain('Last comment 7d ago');
    expect(render('2040-06-13T12:00:00Z', 'other')).toContain('text-muted');
    expect(render('2040-06-20T11:50:00Z', 'me')).toContain('Last comment 10m ago');
  });
});
