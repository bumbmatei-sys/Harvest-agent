import { describe, it, expect } from 'vitest';
import {
  assertSendOnlyGmailScopes,
  GmailScopeError,
  GMAIL_SEND_SCOPE,
} from '../gmail-scopes';

function cfg(overrides: Partial<{ toolkitSlug: string; isComposioManaged: boolean; scopes: string[] | null }> = {}) {
  return {
    toolkitSlug: 'gmail',
    isComposioManaged: false,
    scopes: [GMAIL_SEND_SCOPE],
    ...overrides,
  };
}

describe('assertSendOnlyGmailScopes', () => {
  it('accepts an auth config that requests exactly gmail.send', () => {
    expect(assertSendOnlyGmailScopes(cfg())).toEqual([GMAIL_SEND_SCOPE]);
  });

  it('accepts gmail.send alongside the identity scopes', () => {
    const scopes = [
      GMAIL_SEND_SCOPE,
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',
    ];
    expect(assertSendOnlyGmailScopes(cfg({ scopes }))).toEqual(scopes);
  });

  // ── Fail closed ──────────────────────────────────────────────────────────
  // "No scopes declared" is the case where Composio falls back to its broad
  // defaults, so it must be a refusal and never a pass.
  it('REFUSES an auth config that declares no scopes', () => {
    expect(() => assertSendOnlyGmailScopes(cfg({ scopes: null }))).toThrow(GmailScopeError);
    expect(() => assertSendOnlyGmailScopes(cfg({ scopes: [] }))).toThrow(GmailScopeError);
  });

  it('REFUSES every scope that can read a mailbox', () => {
    const readScopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/gmail.settings.basic',
    ];
    for (const scope of readScopes) {
      expect(
        () => assertSendOnlyGmailScopes(cfg({ scopes: [GMAIL_SEND_SCOPE, scope] })),
        `${scope} must be refused`,
      ).toThrow(GmailScopeError);
    }
  });

  it('names the offending scope so a misconfiguration is diagnosable', () => {
    expect(() => assertSendOnlyGmailScopes(cfg({
      scopes: [GMAIL_SEND_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly'],
    }))).toThrow(/gmail\.readonly/);
  });

  it('REFUSES a config with identity scopes but no send scope', () => {
    expect(() => assertSendOnlyGmailScopes(cfg({
      scopes: ['https://www.googleapis.com/auth/userinfo.email'],
    }))).toThrow(/missing/i);
  });

  it('REFUSES an auth config belonging to another toolkit', () => {
    expect(() => assertSendOnlyGmailScopes(cfg({ toolkitSlug: 'mailchimp' }))).toThrow(GmailScopeError);
  });

  it('passes a Composio-managed config whose scopes are send-only', () => {
    // Managed vs custom is a consent-screen *branding* question, not a mailbox
    // access one — narrowed scopes are honoured on managed auth configs too.
    expect(() => assertSendOnlyGmailScopes(cfg({ isComposioManaged: true }))).not.toThrow();
  });
});
