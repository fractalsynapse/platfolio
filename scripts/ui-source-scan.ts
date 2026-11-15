/**
 * The source scanner `check-ui.ts` reads through, extracted so `packages/ui/test/gates-falsify.test.ts` can
 * point it at a violation and assert it is still seen.
 *
 * A gate whose *reading* is untested is the coin-flip defect from `docs/ui-architecture.md` rule 3: the
 * assertion passes, and tests nothing. Here the lexer is the part that can silently make every pattern below
 * it vacuous — if `stripComments` gets stuck inside a string, it erases real code and every gate reports
 * PASS over a tree that violates it. So the lexer has its own tests, both directions.
 *
 * ## What it does
 *
 * Blanks comments and string/template *bodies*, emitting the same character count and the same newlines, so a
 * match offset still maps to the line a reviewer is sent to. Delimiters are kept: they are syntax.
 *
 * ## Why it exists at all
 *
 * This repository's prose names the things it forbids. `docs/ui-architecture.md` contains the string
 * `window.dispatchEvent` in the sentence refusing it. A gate over raw text would fire on the refusal, and a
 * gate that cries wolf is a gate that gets widened, disabled, or deleted — the failure mode `check-api.ts`
 * documents for a gate that "cannot explain itself".
 *
 * ## The limit, stated rather than hidden
 *
 * This is a character scanner, not a parser. A division operator that begins what looks like a `//` comment,
 * or a regex literal containing an unmatched quote, can shift the mode. The failure direction is deliberate:
 * a lost mode turns *code into spaces*, which drops coverage on the affected lines, and `test/gates-falsify`
 * catches that by planting a violation at the end of a real file and requiring it still be found. The scanner
 * never gains coverage by inventing a token that was not there.
 */

/**
 * Blank comments and string bodies; preserve offsets and line structure.
 *
 * `keepStrings` exists for the one rule whose subject *is* a string: rule 5 refuses the word "live" in a
 * component, and rendered copy lives in literals. A gate that blanks them cannot see the label it is policing,
 * which `test/gates-falsify.test.ts` discovered by planting `() => "live"` and watching it pass.
 */
export function stripComments(text: string, keepStrings = false): string {
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'template' | 'interp';
  const stack: Mode[] = ['code'];
  const top = (): Mode => stack[stack.length - 1] as Mode;
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    const mode = top();
    const two = text.slice(i, i + 2);
    const ch = text[i] as string;

    if (mode === 'code' || mode === 'interp') {
      if (two === '//') { stack.push('line'); i += 2; out.push('  '); continue; }
      if (two === '/*') { stack.push('block'); i += 2; out.push('  '); continue; }
      if (ch === "'") { stack.push('sq'); out.push(ch); i += 1; continue; }
      if (ch === '"') { stack.push('dq'); out.push(ch); i += 1; continue; }
      if (ch === '`') { stack.push('template'); out.push(ch); i += 1; continue; }
      if (mode === 'interp' && ch === '}') { stack.pop(); out.push(ch); i += 1; continue; }
      out.push(ch); i += 1; continue;
    }

    if (mode === 'line') {
      if (ch === '\n') { stack.pop(); out.push(ch); i += 1; continue; }
      i += 1; out.push(' '); continue;
    }
    if (mode === 'block') {
      if (two === '*/') { stack.pop(); i += 2; out.push('  '); continue; }
      i += 1; out.push(ch === '\n' ? '\n' : ' '); continue;
    }

    // Inside a literal. An escape consumes both characters so `\'` does not close the string.
    if (ch === '\\') { i += 2; out.push('  '); continue; }
    if (mode === 'sq' && ch === "'") { stack.pop(); out.push(ch); i += 1; continue; }
    if (mode === 'dq' && ch === '"') { stack.pop(); out.push(ch); i += 1; continue; }
    if (mode === 'template') {
      if (ch === '`') { stack.pop(); out.push(ch); i += 1; continue; }
      if (two === '${') { stack.push('interp'); out.push(two); i += 2; continue; }
      if (keepStrings) { out.push(ch); i += 1; continue; }
      i += 1; out.push(ch === '\n' ? '\n' : ' '); continue;
    }
    i += 1;
    // Single- and double-quoted bodies land here. Blanked by default: the first draft pushed `ch` unchanged,
    // which left every string body visible to the gate's patterns, so a `note: 'Route-level document. …'` read
    // as a touch on `document.` and §9.2 fired on prose.
    if (keepStrings) { out.push(ch); continue; }
    out.push(ch === '\n' ? '\n' : ' ');
  }
  return out.join('');
}

/** CSS has one comment form, the block. String bodies stay intact: a `content:` value is data, not prose. */
export function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 1-based, because that is what an editor takes to the line. */
export function lineOf(clean: string, index: number): number {
  return clean.slice(0, index).split('\n').length;
}
