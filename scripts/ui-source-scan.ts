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
 * This is a character scanner with one piece of context, not a parser. It now distinguishes a regular-expression
 * literal from a division by the character that precedes it -- the same question a parser asks, answered from the
 * text it has already emitted -- because the cost of NOT asking was measured, not theorised: `['"]` inside a
 * pattern opened string mode and swallowed the remainder of the file, so a gate read the gate's own source as
 * code it had blanked. Both directions of that call are pinned in `test/source-scan.test.ts`.
 *
 * What is still out of reach: a `/` whose position this heuristic reads wrongly inside an expression too exotic
 * to name here. The failure direction is what matters and it is asymmetric on purpose -- a lost mode used to turn
 * *code into spaces*, which drops coverage in silence, and `test/gates-falsify.test.ts` is what catches that by
 * planting a violation at the end of a real file and requiring it still be found. The scanner never gains
 * coverage by inventing a token that was not there.
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

  /**
   * Would a `/` at this point begin a regular-expression literal rather than a division?
   *
   * Decided from what has already been emitted, which is the same question a JS parser asks: strip the trailing
   * whitespace, look at the last character. An identifier or `)`/`]` closes a value, so `/` divides. Anything
   * else -- `=`, `(`, `[`, `,`, `:`, `return`, `=>` -- is a value position, so `/` starts a literal.
   */
  const regexPosition = (): boolean => {
    const before = out.join('').replace(/\s+$/, '');
    if (before.length === 0) return true;
    const last = before[before.length - 1] as string;
    if (last === ')' || last === ']') return false;
    if (/[\w$]/.test(last)) {
      // `return /re/`, `typeof /re/`: the keyword is part of the value position, not an operand before it.
      return /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|=>)$/.test(before.slice(-24));
    }
    return true;
  };

  /**
   * Consume a regex literal, or refuse and treat the `/` as division.
   *
   * A literal cannot span a line, so hitting a newline (or the end of the text) before the closing slash means
   * this was not a regex after all and the caller re-reads the character as ordinary code. That fallback is the
   * whole reason this heuristic is safe to apply: the wrong guess costs one character of misread division, the
   * old behaviour cost the rest of the file.
   */
  const readRegex = (): string | null => {
    let j = i + 1;
    let inClass = false;
    while (j < text.length) {
      const c = text[j] as string;
      if (c === '\n') return null;
      if (c === '\\') { j += 2; continue; }
      if (inClass) { if (c === ']') inClass = false; j += 1; continue; }
      if (c === '[') { inClass = true; j += 1; continue; }
      if (c === '/') {
        j += 1;
        while (j < text.length && /[a-z]/i.test(text[j] as string)) j += 1;
        return text.slice(i, j);
      }
      j += 1;
    }
    return null;
  };

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
      // A regex literal is code, and it may contain quote characters: `['"]` is a character class, not the
      // start of a string. Without this branch the scanner used to open `sq` mode inside its own patterns and
      // swallow the rest of the file -- measured, and the reason gate TS0 in check-ui.ts reported the gate's
      // own pattern table as a violation. Emitting the literal verbatim keeps its text visible (it is real
      // code) without letting a quote inside it move the mode.
      if (ch === '/' && regexPosition()) {
        const literal = readRegex();
        if (literal !== null) { out.push(literal); i += literal.length; continue; }
      }
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
