export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface Block {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'li-ordered' | 'hr' | 'blank';
  text: string;
  runs?: TextRun[];
  index?: number;
}

function extractRuns(el: Element): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (node: Node, bold: boolean, italic: boolean) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const t = node.textContent || '';
      if (t) runs.push({ text: t, bold, italic });
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const tag = (node as Element).tagName.toLowerCase();
      const b = bold || tag === 'strong' || tag === 'b';
      const i = italic || tag === 'em' || tag === 'i';
      node.childNodes.forEach(child => walk(child, b, i));
    }
  };
  el.childNodes.forEach(child => walk(child, false, false));
  return runs;
}

export function parseHTMLToBlocks(html: string): Block[] {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const blocks: Block[] = [];
  let olIndex = 0;

  const process = (el: Element) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;
    const text = el.textContent || '';

    if (tag === 'h1') {
      blocks.push({ type: 'h1', text, runs: extractRuns(el) });
    } else if (tag === 'h2') {
      blocks.push({ type: 'h2', text, runs: extractRuns(el) });
    } else if (tag === 'h3') {
      blocks.push({ type: 'h3', text, runs: extractRuns(el) });
    } else if (tag === 'p') {
      if (!text.trim()) {
        blocks.push({ type: 'blank', text: '' });
      } else {
        blocks.push({ type: 'p', text, runs: extractRuns(el) });
      }
    } else if (tag === 'hr') {
      blocks.push({ type: 'hr', text: '' });
    } else if (tag === 'ul') {
      el.querySelectorAll(':scope > li').forEach(li => {
        blocks.push({ type: 'li', text: li.textContent || '', runs: extractRuns(li) });
      });
    } else if (tag === 'ol') {
      olIndex = 0;
      el.querySelectorAll(':scope > li').forEach(li => {
        olIndex++;
        blocks.push({ type: 'li-ordered', text: li.textContent || '', runs: extractRuns(li), index: olIndex });
      });
    } else if (tag === 'div' || tag === 'section' || tag === 'article') {
      Array.from(el.children).forEach(process);
    }
  };

  Array.from(div.children).forEach(process);
  return blocks;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const blocks = parseHTMLToBlocks(html);
  const lines: string[] = [];

  for (const block of blocks) {
    const runText = (runs?: TextRun[]) => {
      if (!runs || runs.length === 0) return block.text;
      return runs.map(r => {
        let t = r.text;
        if (r.bold && r.italic) t = `***${t}***`;
        else if (r.bold) t = `**${t}**`;
        else if (r.italic) t = `*${t}*`;
        return t;
      }).join('');
    };

    switch (block.type) {
      case 'h1': lines.push(`# ${runText(block.runs)}`); break;
      case 'h2': lines.push(`## ${runText(block.runs)}`); break;
      case 'h3': lines.push(`### ${runText(block.runs)}`); break;
      case 'p': lines.push(runText(block.runs)); break;
      case 'blank': lines.push(''); break;
      case 'li': lines.push(`- ${runText(block.runs)}`); break;
      case 'li-ordered': lines.push(`${block.index}. ${runText(block.runs)}`); break;
      case 'hr': lines.push('---'); break;
    }
  }

  return lines.join('\n');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string, mimeType: string) {
  downloadBlob(new Blob([text], { type: mimeType }), filename);
}

export async function exportToPDF(title: string, html: string): Promise<void> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const blocks = parseHTMLToBlocks(html);

  const addPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) addPage();
  };

  const wrapText = (text: string, maxW: number, sz: number, f: { widthOfTextAtSize: (t: string, s: number) => number }): string[] => {
    const words = text.split(' ');
    const linesList: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(test, sz) > maxW) {
        if (current) linesList.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) linesList.push(current);
    return linesList;
  };

  // Title
  const titleLines = wrapText(title, maxWidth, 22, boldFont);
  ensureSpace(titleLines.length * 30 + 16);
  for (const line of titleLines) {
    page.drawText(line, { x: margin, y, size: 22, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
    y -= 30;
  }
  y -= 16;

  for (const block of blocks) {
    if (block.type === 'blank') { y -= 8; continue; }
    if (block.type === 'hr') {
      ensureSpace(16);
      page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      y -= 16;
      continue;
    }

    const isH1 = block.type === 'h1';
    const isH2 = block.type === 'h2';
    const isH3 = block.type === 'h3';
    const fontSize = isH1 ? 18 : isH2 ? 15 : isH3 ? 13 : 11;
    const f = (isH1 || isH2 || isH3) ? boldFont : font;
    const lineHeight = fontSize * 1.5;
    const spaceBefore = isH1 ? 16 : isH2 ? 12 : isH3 ? 8 : 0;
    const prefix = block.type === 'li' ? '• ' : block.type === 'li-ordered' ? `${block.index}. ` : '';
    const fullText = prefix + block.text;

    const wrapped = wrapText(fullText, maxWidth, fontSize, f);
    ensureSpace(spaceBefore + wrapped.length * lineHeight + 4);
    y -= spaceBefore;

    for (const line of wrapped) {
      page.drawText(line, { x: margin, y, size: fontSize, font: f, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight;
    }
    y -= 4;
  }

  const bytes = await pdfDoc.save();
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${title}.pdf`);
}

export async function exportToDOCX(title: string, html: string): Promise<void> {
  const { Document, Paragraph, TextRun: DocxTextRun, HeadingLevel, Packer } = await import('docx');
  const blocks = parseHTMLToBlocks(html);

  const makeRuns = (block: Block, prefix = ''): InstanceType<typeof DocxTextRun>[] => {
    if (!block.runs || block.runs.length === 0) {
      return [new DocxTextRun({ text: prefix + block.text })];
    }
    const result: InstanceType<typeof DocxTextRun>[] = [];
    if (prefix) result.push(new DocxTextRun({ text: prefix }));
    block.runs.forEach(r => result.push(new DocxTextRun({ text: r.text, bold: r.bold, italics: r.italic })));
    return result;
  };

  const paragraphs = blocks.map(block => {
    switch (block.type) {
      case 'h1': return new Paragraph({ heading: HeadingLevel.HEADING_1, children: makeRuns(block) });
      case 'h2': return new Paragraph({ heading: HeadingLevel.HEADING_2, children: makeRuns(block) });
      case 'h3': return new Paragraph({ heading: HeadingLevel.HEADING_3, children: makeRuns(block) });
      case 'li': return new Paragraph({ children: makeRuns(block, '• ') });
      case 'li-ordered': return new Paragraph({ children: makeRuns(block, `${block.index}. `) });
      case 'hr': return new Paragraph({ children: [new DocxTextRun({ text: '────────────────────' })] });
      case 'blank': return new Paragraph({ children: [] });
      default: return new Paragraph({ children: makeRuns(block) });
    }
  });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new DocxTextRun({ text: title, bold: true })] }),
        ...paragraphs,
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${title}.docx`);
}

export function exportToMarkdown(title: string, html: string): void {
  const md = htmlToMarkdown(html);
  downloadText(`# ${title}\n\n${md}`, `${title}.md`, 'text/markdown');
}
