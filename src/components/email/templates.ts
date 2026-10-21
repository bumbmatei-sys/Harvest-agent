export interface EmailTemplate {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly subject: string;
  readonly preheader: string;
  readonly bodyHtml: string;
}

/** Starter letters. `{{first_name}}` and `{{sender_name}}` are filled in per person at send time. */
export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    blurb: 'Start from a greeting and your name.',
    subject: '',
    preheader: '',
    bodyHtml: '<p>Hi {{first_name}},</p><p></p><p>{{sender_name}}</p>',
  },
  {
    id: 'weekly',
    name: 'Weekly update',
    blurb: 'What is happening this Sunday and this week.',
    subject: 'This Sunday at church',
    preheader: 'Service time, what we are studying, and one thing to pray about.',
    bodyHtml: '<p>Hi {{first_name}},</p><p>Here is what is coming up this week.</p><h2>Sunday</h2><p>Service starts at 10:00. We are continuing our series, and we would love to have you with us.</p><h2>This week</h2><ul><li>Midweek small groups meet Wednesday evening</li><li>Volunteers are needed for the welcome team</li></ul><p>See you soon,</p><p>{{sender_name}}</p>',
  },
  {
    id: 'event',
    name: 'Event invitation',
    blurb: 'Invite people to one event, with a button.',
    subject: 'You are invited',
    preheader: 'Save the date and bring a friend.',
    bodyHtml: '<p>Hi {{first_name}},</p><p>We are gathering for a special evening and want you there.</p><p><a href="https://example.org" data-button="true">Reserve your seat</a></p><p>Bring a friend, family is welcome.</p><p>{{sender_name}}</p>',
  },
  {
    id: 'prayer',
    name: 'Prayer and praise',
    blurb: 'Share requests and answered prayers.',
    subject: 'Praying with you this week',
    preheader: 'Answered prayers and requests we are carrying together.',
    bodyHtml: '<p>Hi {{first_name}},</p><h2>Praise</h2><p>Share what God has done this week.</p><h2>Requests</h2><ul><li>Add a request</li><li>Add another</li></ul><blockquote>Rejoice always, pray continually, give thanks in all circumstances.</blockquote><p>{{sender_name}}</p>',
  },
  {
    id: 'thanks',
    name: 'Thank you',
    blurb: 'A short, warm note of gratitude.',
    subject: 'Thank you',
    preheader: 'A note of gratitude from all of us.',
    bodyHtml: '<p>Hi {{first_name}},</p><p>Thank you for being part of what God is doing here. Your time and prayers make a difference every week.</p><p>With gratitude,</p><p>{{sender_name}}</p>',
  },
];

/** One block of a starter letter, reduced to what a thumbnail needs to draw it. */
export type ThumbBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 }
  | { readonly kind: 'text'; readonly lines: number }
  | { readonly kind: 'list'; readonly items: number }
  | { readonly kind: 'button' }
  | { readonly kind: 'quote'; readonly lines: number };

const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
/** About how many lines of body text a paragraph of this many characters wraps to, at a letter's width. */
const wrapped = (chars: number) => Math.min(3, Math.max(1, Math.ceil(chars / 52)));

/**
 * Reads a template's own HTML into the shape a thumbnail draws, so each
 * thumbnail is that letter and not a stock placeholder. Starter templates are
 * fixed strings written in this file, which is why a small tag reader is enough.
 */
export function templateBlocks(html: string): ThumbBlock[] {
  const out: ThumbBlock[] = [];
  const block = /<(h[1-3]|p|ul|ol|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (let m = block.exec(html); m; m = block.exec(html)) {
    const [, tag, inner] = m;
    const text = plain(inner);
    if (tag === 'ul' || tag === 'ol') out.push({ kind: 'list', items: Math.max(1, (inner.match(/<li\b/g) ?? []).length) });
    else if (tag === 'blockquote') out.push({ kind: 'quote', lines: wrapped(text.length) });
    else if (tag.startsWith('h')) out.push({ kind: 'heading', level: Number(tag[1]) as 1 | 2 | 3 });
    else if (/data-button/.test(inner)) out.push({ kind: 'button' });
    else if (text) out.push({ kind: 'text', lines: wrapped(text.length) });
  }
  return out;
}
