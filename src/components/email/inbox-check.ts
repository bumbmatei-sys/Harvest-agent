export interface InboxTip {
  readonly id: string;
  readonly kind: 'fix' | 'tip';
  readonly title: string;
  readonly detail: string;
}

export function plainWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ').trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * The inbox check. Computed in the browser from what is on screen, and phrased
 * as guidance: words alone rarely send an email to spam, so none of this is a
 * score and none of it blocks a send except an empty subject.
 */
export function inboxCheck(input: { subject: string; preheader: string; bodyHtml: string }): InboxTip[] {
  const tips: InboxTip[] = [];
  const subject = input.subject.trim();
  if (!subject) {
    tips.push({ id: 'subject', kind: 'fix', title: 'Add a subject', detail: 'Emails with no subject look like spam, and most people skip them.' });
  } else {
    if (subject.length > 60) tips.push({ id: 'long', kind: 'tip', title: 'Shorten the subject', detail: 'Phones show about 40 characters. Put the important words first.' });
    const letters = subject.replace(/[^A-Za-z]/g, '');
    if (letters.length > 6 && letters === letters.toUpperCase()) tips.push({ id: 'caps', kind: 'fix', title: 'Avoid ALL CAPS', detail: 'Shouting subjects are one of the clearest spam signals.' });
    if ((subject.match(/!/g) ?? []).length > 1) tips.push({ id: 'bang', kind: 'tip', title: 'Use one exclamation mark at most', detail: 'Several in a row read as promotional.' });
  }
  if (!input.preheader.trim()) tips.push({ id: 'preheader', kind: 'tip', title: 'Add preview text', detail: 'Inboxes show it after the subject. Without it, they show your first line, which may not be your best.' });
  if (plainWords(input.bodyHtml) < 5) tips.push({ id: 'short', kind: 'tip', title: 'Say a little more', detail: 'An email with almost no text is more likely to be filtered.' });
  return tips;
}

export function inboxSummary(tips: readonly InboxTip[]): string {
  const fixes = tips.filter((t) => t.kind === 'fix').length;
  const hints = tips.length - fixes;
  if (tips.length === 0) return 'Looks good';
  const parts: string[] = [];
  if (fixes) parts.push(`${fixes} ${fixes === 1 ? 'thing' : 'things'} to fix`);
  if (hints) parts.push(`${hints} ${hints === 1 ? 'tip' : 'tips'}`);
  return parts.join(', ');
}
