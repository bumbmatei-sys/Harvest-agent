import { describe, expect, it } from 'vitest';
import { communityHref, communityIdFromPath, communityJoinPath, communitySignupPath, communitySource, safeCommunityReturnPath } from './navigation';
describe('same-origin community navigation', () => {
  it.each(['https://evil.test/community/a', '//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/community/a%0a', '/community/a\n', '/auth', 'javascript:alert(1)', '/community/../admin', '/community/a/extra', '/community/a%5c', '/community/a?next=\n'])('refuses unsafe return path %s', path => {
    expect(safeCommunityReturnPath(path)).toBeNull();
  });
  it('hands tenant-host discovery to the central origin without changing host identity', () => {
    expect(communityHref('/community/a?join=1', 'grace.theharvest.app')).toBe('https://theharvest.app/community/a?join=1');
    expect(communityHref('/community/a', 'theharvest.app')).toBe('/community/a');
    expect(communityHref('/community/a', 'localhost')).toBe('/community/a');
  });
  it('round trips a direct community link through the existing free signup', () => {
    const path = communityJoinPath('tenant-a', 'website');
    expect(path).toBe('/community/tenant-a?join=1&src=website');
    const signup = new URL(communitySignupPath(path), 'https://theharvest.app');
    expect(signup.pathname).toBe('/auth'); expect(signup.searchParams.get('signup')).toBe('free');
    expect(safeCommunityReturnPath(signup.searchParams.get('returnTo'))).toBe(path);
    expect(() => communitySignupPath('//evil.test')).toThrow();
  });
  it('distinguishes the three acquisition sources and restricts selected scope to member pages', () => {
    expect(communitySource('?src=discover&join=1')).toBe('discover');
    expect(communitySource('?join=1')).toBe('link');
    expect(communitySource('?src=website')).toBe('website');
    expect(communityIdFromPath('/community/a')).toBe('a');
    expect(communityIdFromPath('/admin/a')).toBeNull();
    expect(communityIdFromPath('/community/a/admin')).toBeNull();
  });
});
