import ts from 'typescript';

/**
 * THE-346 - comment-stripped source, for every content grep this ticket makes.
 *
 * A SHARED MODULE RATHER THAN A HELPER INSIDE ONE SUITE, and that is not
 * tidiness: importing it out of a `.test.tsx` file drags that file's `vi.mock`
 * calls and its whole `describe` tree into whichever suite imported it, which
 * is exactly what happened on the first attempt.
 *
 * WHY IT IS TYPESCRIPT'S OWN SCANNER AND NOT A HAND-WRITTEN STATE MACHINE.
 *
 * Card 86bbxkawp records an inherited `code()` stripper that EATS ~150 LINES of
 * a file, and a stripper that swallows code turns every guard built on it into
 * one that reads something which is not the code - which is how thirteen guards
 * in this repo passed a planted defect. So the first version here was written
 * by hand, and it had the same class of bug one layer down:
 *
 *   A HAND-ROLLED SCANNER CANNOT READ JSX. In `code` mode it treats `'` as the
 *   start of a string, and JSX TEXT is full of apostrophes - "the founder's
 *   screenshot", "don't". One of those desynchronises the machine, and from
 *   there every `//` and `/*` inside what it wrongly believes is a string is
 *   left in place while real code is swallowed. It failed silently: the guard
 *   that greps for a class string then reports a comment as the code.
 *
 * A CONTEXT-FREE LEXER IS NOT ENOUGH EITHER, and that was the second attempt.
 * `ts.createScanner` is the compiler's own lexer, but it is context-free: it
 * cannot know whether it is standing in JSX text, so it reads the `//` in a
 * URL written as JSX TEXT - `https://{tenantId}.theharvest.app/event/{id}` in
 * AdminEvents - as the start of a line comment and eats the rest of the line.
 * Measured: stripping that file with the scanner left source with 342
 * syntax errors, from a file that had none. That is card 86bbxkawp's ~150
 * eaten lines, arrived at from a different direction.
 *
 * SO THE COMMENT RANGES COME FROM A REAL PARSE. `ts.createSourceFile` builds
 * the AST the compiler would build, and comment trivia is then read off the
 * token positions in it - `getLeadingCommentRanges` at each token's full
 * start. A parser knows it is in JSX; a lexer cannot.
 *
 * NEWLINES INSIDE A COMMENT ARE PRESERVED, so line numbers do not shift and a
 * failure message still points where a reader expects. Nothing else is
 * replaced: every non-comment token is copied through verbatim, so a class
 * string, a template literal and a JSX text run all survive byte for byte.
 *
 * AND IT IS CHECKED RATHER THAN TRUSTED, in
 * `THE-346.notes-menu-and-nav.test.tsx`: strip every file this ticket greps,
 * and the result must still parse as TypeScript. A line-shape heuristic cannot
 * make that check - this repo writes block comments whose continuation lines
 * carry no leading `*`, so "every line without a comment marker must survive"
 * condemns correct prose. Parsing the RESULT is the independent question.
 */
export function stripComments(src: string): string {
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const ranges: Array<[number, number]> = [];
  const seen = new Set<number>();
  const collect = (pos: number) => {
    if (seen.has(pos)) return;
    seen.add(pos);
    // BOTH, and that is not belt and braces. `getLeadingCommentRanges` skips a
    // comment that begins on the same line as the previous token - the compiler
    // calls that one TRAILING - so a `// note` at the end of a line of code is
    // invisible to the leading call and survives the strip.
    for (const r of ts.getLeadingCommentRanges(src, pos) ?? []) ranges.push([r.pos, r.end]);
    for (const r of ts.getTrailingCommentRanges(src, pos) ?? []) ranges.push([r.pos, r.end]);
  };

  const walk = (node: ts.Node) => {
    collect(node.getFullStart());
    collect(node.getEnd());
    for (const kid of node.getChildren(sf)) walk(kid);
  };
  walk(sf);
  // The trailing run after the last token, which has no node to hang off.
  collect(sf.endOfFileToken.getFullStart());

  if (ranges.length === 0) return src;
  ranges.sort((a, b) => a[0] - b[0]);

  let out = '';
  let cursor = 0;
  for (const [from, to] of ranges) {
    if (from < cursor) continue;
    out += src.slice(cursor, from);
    // Keep the newlines so line numbers do not move.
    out += src.slice(from, to).replace(/[^\n]/g, '');
    cursor = to;
  }
  return out + src.slice(cursor);
}
