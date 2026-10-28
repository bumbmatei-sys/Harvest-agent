import { describe, expect, it } from 'vitest';
import { defaultCommunitySettings, needsCommunityEntry, prepareCommunitySettings, readCommunitySettings, requiredQuestionsAnswered } from './settings';

describe('community settings', () => {
  it('preserves existing modules for a missing document and rejects malformed data', () => {
    expect(Object.values(readCommunitySettings(undefined).modules).every(Boolean)).toBe(true);
    expect(() => readCommunitySettings({})).toThrow('Invalid community settings');
  });
  it('increments the rules version only when rules change', () => {
    const previous = defaultCommunitySettings();
    expect(prepareCommunitySettings(previous, { ...previous, isPublic: true }).rules.version).toBe(0);
    expect(prepareCommunitySettings(previous, { ...previous, rules: { ...previous.rules, enabled: true, items: ['Be kind'] } }).rules.version).toBe(1);
  });
  it('requires reacceptance after a rules change and valid required answers', () => {
    const settings = defaultCommunitySettings();
    settings.rules = { enabled: true, items: ['Be kind'], version: 2 };
    expect(needsCommunityEntry(settings, { rulesAcceptedVersion: 1 })).toBe(true);
    expect(needsCommunityEntry(settings, { rulesAcceptedVersion: 2 })).toBe(false);
    const questions = [{ id: 'q', type: 'choice' as const, label: 'Choose', options: ['A', 'B'], required: true }];
    expect(requiredQuestionsAnswered(questions, { q: 'C' })).toBe(false);
    expect(requiredQuestionsAnswered(questions, { q: 'A' })).toBe(true);
  });
});
