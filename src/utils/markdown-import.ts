/**
 * Markdown → HTML converter for importing notes (Notion / Obsidian exports)
 * into Harvest Docs.
 *
 * The Docs editor (TipTap / RichTextEditor) stores its content as an HTML
 * string (`editor.getHTML()`), so we convert the imported markdown into the
 * HTML that TipTap understands rather than into a separate JSON schema. This
 * keeps imported notes fully editable with the existing editor.
 *
 * Supported syntax (per import spec):
 *   #/##/### headings, **bold**, *italic*, `code`, [links](url),
 *   - / * bullet lists, 1. ordered lists, --- horizontal rule,
 *   > blockquotes, and plain paragraphs.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convert inline markdown (bold, italic, code, links) within a line. */
function inline(text: string): string {
  let t = escapeHtml(text);
  // Bold before italic so **x** is not eaten by the single-asterisk rule.
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  t = t.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  // Links [text](url) — only allow safe protocols/relative paths.
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const trimmed = String(url).trim();
    const safe = /^(https?:|mailto:|\/)/i.test(trimmed) ? trimmed : '#';
    return `<a href="${safe}">${label}</a>`;
  });
  // Inline code.
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

const isHeading = (l: string) => /^(#{1,3})\s+/.test(l);
const isQuote = (l: string) => /^>\s?/.test(l);
const isBullet = (l: string) => /^[-*]\s+/.test(l);
const isOrdered = (l: string) => /^\d+\.\s+/.test(l);
const isRule = (l: string) => /^(-{3,}|\*{3,}|_{3,})$/.test(l);

/** Convert a markdown string into an HTML string for the TipTap editor. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let i = 0;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === '') { closeList(); i++; continue; }

    if (isRule(trimmed)) { closeList(); out.push('<hr>'); i++; continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (isQuote(trimmed)) {
      closeList();
      const quote: string[] = [];
      while (i < lines.length && isQuote(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`);
      continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(trimmed);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1].trim())}</li>`);
      i++;
      continue;
    }

    const ol = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1].trim())}</li>`);
      i++;
      continue;
    }

    // Paragraph: gather consecutive plain lines.
    closeList();
    const para: string[] = [];
    while (i < lines.length) {
      const lt = lines[i].trim();
      if (
        lt === '' || isHeading(lt) || isQuote(lt) ||
        isBullet(lt) || isOrdered(lt) || isRule(lt)
      ) break;
      para.push(lt);
      i++;
    }
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }

  closeList();
  return out.join('');
}

/**
 * Pick a document title: the first H1 in the markdown if present, otherwise the
 * filename without its extension.
 */
export function titleFromMarkdown(md: string, filename: string): string {
  const m = /^\s*#\s+(.+?)\s*$/m.exec(md);
  if (m && m[1].trim()) return m[1].trim();
  return filename.replace(/\.(md|markdown|txt)$/i, '').trim() || 'Untitled';
}
