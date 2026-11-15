/**
 * The decision register must be one table, not several shapes wearing a table's syntax (#250).
 *
 * Measured before this gate existed, in a file that is the project's canonical decision record:
 *  - D52 and D53 each carried a FOURTH pipe-delimited cell inside a three-column table, so their consequence text
 *    rendered one column left and the final cell fell off the end of the row entirely;
 *  - D53 existed TWICE -- a 562-character row and a 1138-character row whose first 562 characters were identical,
 *    i.e. one decision with two definitions, one of which would be edited alone;
 *  - one row lost its head and its `| D17 |` label in merge `d4a2dc8` (the commit that first wrote the file),
 *    leaving a line starting with a colon that GitHub renders as stray text between tables.
 *
 * `checkMarkdown` could not see any of it, because to a linter a table row is prose. This is the class D61 was
 * written about: a rule stated in prose and enforced by nobody rots within a week.
 *
 * Two subtleties that are the whole difficulty:
 *  1. The expected column count is DERIVED from the header row, never hardcoded, so widening the register is a
 *     legitimate edit rather than a gate failure.
 *  2. A pipe inside inline code is CONTENT to a reader and a SEPARATOR to a renderer. That disagreement is exactly
 *     how `development | staging | production` inside backticks broke a row while looking correct in the file, so
 *     the counter treats it as content (matching what a human means) and the unescaped-pipe check flags it
 *     (matching what a browser will do). The two rules are deliberately not the same parser, and the gap between
 *     them is the bug.
 */

import { readFileSync } from 'node:fs';

const RELATIVE = 'docs/design/01-product-and-decisions.md';

/** Split a table row into cells, treating pipes inside inline code spans as content. */
export function registerCells(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inCode = false;
  for (const ch of line) {
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.slice(1, -1).map((s) => s.trim());
}

export function checkDecisionRegister(root: string): string[] {
  const problems: string[] = [];
  let text: string;
  try {
    text = readFileSync(`${root}/${RELATIVE}`, 'utf8');
  } catch {
    return [`${RELATIVE}: the decision register is missing`];
  }
  const lines = text.split('\n');

  const headerIndex = lines.findIndex((l) => /^\|\s*#\s*\|\s*Decision\s*\|/.test(l));
  if (headerIndex < 0) return [`${RELATIVE}: the decision register's header row was not found`];
  const columns = registerCells(lines[headerIndex]!).length;
  if (columns === 0) return [`${RELATIVE}: the register header parses to zero columns`];

  const rowsSeen = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/^\| D[0-9]+ \|/.test(line)) continue;
    const cells = registerCells(line);
    const id = cells[0] ?? `line ${String(i + 1)}`;
    if (cells.length !== columns) {
      problems.push(
        `${RELATIVE}:${String(i + 1)} decision ${id} has ${String(cells.length)} columns; the register declares `
        + `${String(columns)}. A stray pipe shifts every later cell left and drops the last one off the rendered row.`,
      );
    }
    // A pipe inside a code span that is not escaped: fine in the file, wrong on the page.
    const codeSpans = line.match(/`[^`]*`/g) ?? [];
    const badSpan = codeSpans.find((span) => span.includes('|') && !span.includes('\\|'));
    if (badSpan !== undefined) {
      problems.push(
        `${RELATIVE}:${String(i + 1)} decision ${id} has an unescaped pipe inside inline code (${badSpan.slice(0, 60)}). `
        + 'The renderer treats it as a column separator; write it as `a \\| b`.',
      );
    }
    const at = rowsSeen.get(id) ?? [];
    at.push(i + 1);
    rowsSeen.set(id, at);
  }

  for (const [id, at] of rowsSeen) {
    if (at.length > 1) {
      problems.push(`${RELATIVE}:${at.join(',')} decision ${id} is declared ${String(at.length)} times -- one decision, one row.`);
    }
  }

  // Orphan fragments: a line that is table content but has no label, sitting where the register's rows live.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/^[^|].*\|\s*$/.test(line)) continue; // must not start with a pipe, must end with one
    if (!line.startsWith(':') && !/\*\*$/.test(line)) continue;
    if (i === 0 || !/^\| D[0-9]+ \|/.test(lines[i - 1] ?? '')) continue;
    problems.push(
      `${RELATIVE}:${String(i + 1)} an orphan table fragment with no \`| D<nn> |\` label -- a row lost its head. `
      + 'Recover it from history or mark it as lost; never invent the missing sentence.',
    );
  }

  return problems;
}
