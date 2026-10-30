import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { stripComments } from './__fixtures__/the-346-strip-comments';

const root = path.resolve(__dirname, '../..');
const rawTags = new Set(['button', 'input', 'textarea', 'select']);
function controls(file: string) {
  const source = stripComments(readFileSync(path.join(root, 'src/components', file), 'utf8'));
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
  function walk(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) nodes.push(node);
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return { tree, nodes };
}

describe('#556 shadcn controls', () => {
  // Upper bounds from the reviewed main sources; no git invocation or diff dependency.
  it.each([['AdminEvents.tsx', 46], ['PublicEventRegistration.tsx', 13], ['UserEvents.tsx', 5]] as const)(
    '%s has no raw-control growth', (file, cap) => {
      const { tree, nodes } = controls(file);
      expect(nodes.filter(node => rawTags.has(node.tagName.getText(tree))).length).toBeLessThanOrEqual(cap);
    },
  );
  it.each([
    ['AdminEvents.tsx', 'data-registration-questions'],
    ['PublicEventRegistration.tsx', 'data-public-question-step'],
  ])('%s question controls all use primitives', (file, marker) => {
    const { tree, nodes } = controls(file);
    const container = nodes.find(node => node.attributes.properties.some(attr => attr.name?.getText(tree) === marker));
    expect(container, 'question editor/stepper must exist').toBeDefined();
    const parent = container!.parent;
    const children = nodes.filter(node => node.getStart(tree) > parent.getStart(tree) && node.end < parent.end);
    expect(children.filter(node => ['Button', 'Input', 'Textarea'].includes(node.tagName.getText(tree))).length).toBeGreaterThan(1);
    expect(children.filter(node => rawTags.has(node.tagName.getText(tree))).map(node => node.getText(tree))).toEqual([]);
  });
  it.each([
    ['AdminEvents.tsx', 'form.recurrenceUntil', 'Input'],
    ['AdminEvents.tsx', 'form.recurrenceCount', 'Input'],
    ['AdminEvents.tsx', 'form.location', 'Input'],
    ['AdminEvents.tsx', 'regSearch', 'Input'],
    ['AdminEvents.tsx', 'copyRegUrl', 'Button'],
    ['AdminEvents.tsx', 'setShowCancelEventConfirm(true)', 'Button'],
    ['AdminEvents.tsx', 'setExpandedRegId', 'Button'],
    ['AdminEvents.tsx', 'exportCSV', 'Button'],
    ['AdminEvents.tsx', 'cancelRun(run.runDate)', 'Button'],
    ['PublicEventRegistration.tsx', 'data-public-add-to-calendar', 'Button'],
    ['PublicEventRegistration.tsx', 'data-public-run-option', 'Button'],
    ['PublicEventRegistration.tsx', 'selectTicket(t.id)', 'Button'],
    ['PublicEventRegistration.tsx', 'data-public-submit', 'Button'],
    ['UserEvents.tsx', 'data-ticket-add-to-calendar', 'Button'],
  ])('%s %s is a %s', (file, needle, primitive) => {
    const { tree, nodes } = controls(file);
    const matches = nodes.filter(node => node.attributes.properties.some(attr => (['value', 'onClick'].includes(attr.name?.getText(tree) || '') && attr.getText(tree).includes(needle)) || attr.name?.getText(tree) === needle));
    expect(matches.length, `${needle} must have a control`).toBeGreaterThan(0);
    expect(matches.map(node => node.tagName.getText(tree))).toEqual(matches.map(() => primitive));
  });
});
