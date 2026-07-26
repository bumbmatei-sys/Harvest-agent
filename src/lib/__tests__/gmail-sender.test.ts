import { describe, it, expect } from 'vitest';
import { normalizeSenderEmail } from '../gmail-sender';

describe('normalizeSenderEmail', () => {
  it('accepts a plain address and lowercases it', () => {
    expect(normalizeSenderEmail('Pastor@Church.org')).toBe('pastor@church.org');
    expect(normalizeSenderEmail('  admin@harvest.app  ')).toBe('admin@harvest.app');
  });

  it('accepts subdomains and plus-addressing', () => {
    expect(normalizeSenderEmail('a+crm@mail.church.org')).toBe('a+crm@mail.church.org');
  });

  it('rejects anything that is not an address', () => {
    for (const bad of [null, undefined, 42, '', '   ', 'not-an-email', 'no@tld', '@church.org', 'a@']) {
      expect(normalizeSenderEmail(bad), `${String(bad)} must be refused`).toBeNull();
    }
  });

  // The value becomes a `From` header, so a newline in it is header injection —
  // not a formatting nit.
  it('REFUSES CR/LF and other header-injection attempts', () => {
    expect(normalizeSenderEmail('a@church.org\nBcc: evil@attacker.test')).toBeNull();
    expect(normalizeSenderEmail('a@church.org\r\nSubject: spoofed')).toBeNull();
    expect(normalizeSenderEmail('a@church.org Bcc: evil@attacker.test')).toBeNull();
  });

  it('REFUSES multiple addresses and display-name forms', () => {
    expect(normalizeSenderEmail('a@church.org,b@evil.test')).toBeNull();
    expect(normalizeSenderEmail('a@church.org; b@evil.test')).toBeNull();
    expect(normalizeSenderEmail('Pastor <a@church.org>')).toBeNull();
    expect(normalizeSenderEmail('"Pastor" a@church.org')).toBeNull();
  });

  it('REFUSES an absurdly long value', () => {
    expect(normalizeSenderEmail(`${'a'.repeat(250)}@church.org`)).toBeNull();
  });
});
