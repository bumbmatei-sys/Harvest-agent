import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemberAvatar, PostHeader, PostText, relativeCommentTime } from './PostPresentation';

describe('community post presentation', () => {
  it('shows a level only when one exists and identifies pinned posts', () => {
    const header = renderToStaticMarkup(<PostHeader name="Alex" level={7} createdAt="2020-02-13T12:00:00Z" category="General" pinned />);
    expect(header).toContain('Level 7');
    expect(header).toContain('Pinned');
    expect(header).toContain('Feb 13 • General');
    expect(renderToStaticMarkup(<MemberAvatar name="Alex" />)).not.toContain('Level');
  });

  it('clamps a long body and offers a way to read it', () => {
    const post = renderToStaticMarkup(<PostText content={'Heading\n' + 'Body '.repeat(50)} />);
    expect(post).toContain('Heading');
    expect(post).toContain('line-clamp-2');
    expect(post).toContain('Read more');
  });

  it('does not invent a relative time for an invalid date', () => {
    expect(relativeCommentTime('invalid')).toBeNull();
  });
});
