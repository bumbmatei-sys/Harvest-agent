import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';

describe('group picker scope', () => {
  it('uses the capped scoped loader for the picker and admin roster', () => {
    const source = stripComments(readFileSync('src/components/AdminCommunity.tsx', 'utf8'));
    const picker = source.slice(source.indexOf('const openNewChannel'), source.indexOf('const startAdminDm'));
    expect(picker).toContain('loadScopedUserDocs(tenantId, includeNullTenant, 200)');
    const calls = /loadScopedUserDocs\(tenantId, includeNullTenant, 200\)/g;
    expect(picker.match(calls)).toHaveLength(2);
    const mutated = picker.replace('loadScopedUserDocs(tenantId, includeNullTenant, 200)', 'getDocs(unboundedUsers)');
    expect(mutated.match(calls)).toHaveLength(1);
    expect(picker).not.toContain("getDocs(query(collection(db, 'users')");
  });
});
