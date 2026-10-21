import { BRAND_PALETTE as B } from '@/lib/email/render';

/**
 * The public unsubscribe page: a plain HTML document, because it is served from
 * an API route with none of the app's CSS. It carries the brand navy and gold
 * from one palette constant and follows the reader's light or dark setting.
 * The ministry name comes from a database field a ministry typed, so it is
 * escaped like any user text.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface UnsubscribePageInput {
  readonly title: string;
  readonly body: string;
  /** The ministry the link came from. Null when the link could not be read. */
  readonly ministry: string | null;
  /** The URL the confirm button posts to. Absent on a result page. */
  readonly action?: string;
}

const STYLE = `
:root{color-scheme:light dark;--page:${B.gold50};--card:#ffffff;--ink:${B.navy900};--muted:${B.navy600};--line:${B.gold100};--band:${B.navy900};--band-ink:#ffffff;--accent:${B.gold500};--accent-ink:${B.navy900}}
@media (prefers-color-scheme:dark){:root{--page:${B.navy950};--card:${B.navy800};--ink:#f4efe6;--muted:#b9c3d6;--line:${B.navy600};--band:${B.navy900};--accent-ink:${B.navy950}}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--page);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5}
.band{background:var(--band);color:var(--band-ink);padding:18px 20px;border-bottom:3px solid var(--accent)}
.band span{display:block;max-width:480px;margin:0 auto;padding:0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:.02em}
main{max-width:480px;margin:40px auto;padding:0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
.eyebrow{margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
h1{margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;font-weight:600}
p{margin:0;color:var(--muted);font-size:16px}
form{margin:24px 0 0}
button{min-height:44px;padding:0 24px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-ink);font-size:16px;font-weight:600;cursor:pointer}
button:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
`.replace(/\n/g, '');

export function renderUnsubscribePage({ title, body, ministry, action }: UnsubscribePageInput): string {
  const name = ministry ? escapeHtml(ministry) : null;
  const form = action
    ? `<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="view" value="page"><button type="submit">Unsubscribe</button></form>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>`
    + `<body><div class="band"><span>Harvest</span></div><main><div class="card">${name ? `<p class="eyebrow">${name}</p>` : ''}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${form}</div></main></body></html>`;
}
