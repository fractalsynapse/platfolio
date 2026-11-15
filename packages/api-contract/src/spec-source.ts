import { isMap, isPair, isScalar, isSeq, parseDocument, type Pair } from 'yaml';

/**
 * The specification as *text*, before anything reads its meaning (#247).
 *
 * Two conditions, both learned the same day from the same file:
 *
 *  1. **A checker must fail with a finding, never crash.** `loadSpec` throws on a document that does not
 *     parse, which is right for a running server -- a control plane answering requests without a compiled
 *     validator is worse than one that refuses to boot -- and wrong for a gate. Measured on 2026-11-15: an
 *     unquoted scalar in `apps/control-plane/openapi.yaml` made the file unparseable and `api:check` printed
 *     a `YAMLParseError` stack trace and nothing else, which buries every other finding in `verify` and lets
 *     the absence of findings read as the presence of health. `checkSpecSource` is what the gates call first;
 *     `loadSpec` keeps throwing for the runtime, because those two consumers want opposite things and the
 *     seam should say so rather than pick one.
 *  2. **Prevent the class, not the instance.** The document is prose-heavy, and YAML reinterprets prose in
 *     three ways. Measured against this file's own styles:
 *
 *     | written | parsed | result |
 *     | --- | --- | --- |
 *     | `d: A. Distinct from refused: the point` | parse ERROR | loud -- the crash the fix above is about |
 *     | `d: Names # not a comment here` | `"Names"` | SILENT: the rest became a comment |
 *     | `a: { description: Names, because prose, minLength: 3 }` | `{description: "Names", "because prose": null, minLength: 3}` | SILENT: the sentence split into a truncated value and a NEW KEY |
 *
 *     The two silent rows are the dangerous ones: `unexpressedKeywords()` noticed the third shape after the
 *     fact, and an unknown keyword is only reported if a reader notices the warning. `checkSpecSource`
 *     refuses the *writing style* at the only layer where the quoting decision still exists -- the source
 *     text -- so it is a finding before it is a mystery. Prefer refusing over defaulting, applied to our own
 *     tooling.
 *
 * Both rules were measured against the current 2,082-line document and produce **zero findings** on it, which
 * is what makes them worth adding: a lint that fires on existing legitimate prose is a lint that gets
 * switched off. A plain scalar containing `: ` is deliberately *not* re-flagged here -- it fails the parse, so
 * flagging it again would be noise about a problem already reported louder.
 */

/** Either a usable document, or the findings that explain why there is none. */
export type ParsedSource<T> = { ok: true; doc: T } | { ok: false; problems: string[] };

/**
 * Parse a spec, turning a parse failure into a sentence with a position in it.
 *
 * `where` names the file the bytes came from: "the spec does not parse" without a path is a finding about a
 * document nobody can open.
 */
export function parseSpecSource<T = unknown>(text: string, where: string): ParsedSource<T> {
  const doc = parseDocument(text, { logLevel: 'silent' });
  if (doc.errors.length) return { ok: false, problems: doc.errors.map((error) => parseFinding(error, where, text)) };
  try {
    return { ok: true, doc: doc.toJS() as T };
  } catch (error) {
    return { ok: false, problems: [`${where}: the document parses but will not convert to values -- ${(error as Error).message}`] };
  }
}

function parseFinding(error: { message: string; linePos?: Array<{ line: number; col: number }> | null }, where: string, text: string): string {
  const at = error.linePos?.[0];
  // `yaml` puts the position in the message itself, so it is only appended when it is missing -- a finding
  // that says "at line 1634, column 34" twice reads like a bug in the tool reporting it.
  const head = error.message.split('\n')[0] ?? 'the document does not parse';
  const position = at === undefined ? ' at an unknown position' : head.includes('at line ') ? '' : ` at line ${String(at.line)}, column ${String(at.col)}`;
  const source = at ? (text.split('\n')[at.line - 1] ?? '') : '';
  const hint = /:\s/.test(source.slice(source.indexOf(':') + 1))
    ? '\n  A plain scalar containing ": " is read as a nested mapping. Quote the value, or write it as a block scalar with | -- this file is prose, and prose is exactly where YAML guesses wrong.'
    : '';
  return `${where} does not parse: ${head}${position}`
    + (source === '' ? '' : `\n  the line reads: ${JSON.stringify(source.trim().slice(0, 200))}`)
    + hint;
}

/**
 * Every quoting hazard in the document, as text.
 *
 * Returns `[]` for a document that does not parse, because the parse findings already name the position --
 * walking a half-built tree for a second opinion would report the same mistake twice, in two voices, one of
 * them wrong.
 */
export function checkSpecSource(text: string, where: string): string[] {
  const doc = parseDocument(text, { logLevel: 'silent' });
  if (doc.errors.length) return [];
  const found: string[] = [];
  walkNodes(doc.contents, (node) => {
    if (!isMap(node)) return;
    for (const item of node.items) {
      if (!isPair(item)) continue;
      const pair = item as Pair;
      const key = pair.key;
      const value = pair.value;
      // Rule 1: a key with a space in it is a sentence that leaked out of the value before it.
      if (isScalar(key) && key.type === 'PLAIN' && key.range) {
        const written = text.slice(key.range[0], key.range[1]);
        if (written.includes(' ')) {
          found.push(`${where} line ${String(lineOf(text, key.range[0]))}: ${JSON.stringify(written.slice(0, 60))} is being read as a KEY. A plain scalar inside a flow mapping ends at its first comma, so prose like { description: Names, because this is English } splits into a truncated value and a new keyword nothing validates -- quote the sentence, or write the mapping in block style.`);
        }
      }
      // Rule 2: a `#` after a plain value is a comment, and the comment ate the rest of the sentence.
      if (isScalar(value) && value.type === 'PLAIN' && value.range) {
        const trailing = text.slice(value.range[1], value.range[2]);
        if (trailing.includes('#')) {
          found.push(`${where} line ${String(lineOf(text, value.range[0]))}: the value ${JSON.stringify(String(value.value).slice(0, 50))} is followed by "#" on the same line, so everything after it became a COMMENT. Prose with a hash in it must be quoted; this description is shorter than the one someone typed.`);
        }
      }
    }
  });
  return found;
}

function walkNodes(node: unknown, visitNode: (n: unknown) => void): void {
  visitNode(node);
  if (isMap(node)) {
    for (const item of node.items) {
      if (!isPair(item)) continue;
      walkNodes((item as Pair).value, visitNode);
    }
    return;
  }
  if (isSeq(node)) node.items.forEach((child) => walkNodes(child, visitNode));
}

/** The 1-based line containing a character offset. */
function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}
