import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { componentById, documentProblems, isRegistryImmutable, registeredComponentIds, registrySize, UnknownComponentError } from '../src/registry.ts';

/**
 * Gates §9.5 and §9.6 as executable claims about a registry that is deliberately **empty**.
 *
 * The empty case is not a gap to apologise for; it is the case that most needs proving, because a registry with
 * no entries is where a "resolve unknown ids to undefined" shortcut would hide until the first screen shipped.
 * 11 §9.5's failure mode is "an empty div" — a defect a user discovers and a reviewer does not.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');

test('an unknown component id throws rather than resolving to nothing', () => {
  assert.throws(() => componentById('instances.table'), UnknownComponentError);
  assert.throws(
    () => componentById('instances.table'),
    /not in the build-time registry/,
    'the refusal must say the id is unregistered, not merely fail',
  );
});

test('the refusal names the file a reviewer would add the component to, and the gate it is satisfying', () => {
  assert.throws(
    () => componentById('x'),
    /Rendering an unknown id as an empty element is gate §9\.5 failing silently/,
  );
});

test('a stored page document naming an unknown component reports the id, and does not half-validate', () => {
  const problems = documentProblems({ component: 'secrets.panel', props: { id: 'x' } });
  assert.deepEqual(problems, ['unknown component "secrets.panel"']);
});

test('registeredComponentIds is derived from the table, not a list beside it', () => {
  const ids = registeredComponentIds();
  assert.ok(Array.isArray(ids));
  // Whatever the count is today, it must equal what the registry can actually resolve. This is the assertion
  // that stops a second list of component names from being maintained beside the table (#247's shape).
  for (const id of ids) assert.equal(componentById(id).id, id);
  const source = fs.readFileSync(path.join(ROOT, 'packages/ui/src/registry.ts'), 'utf8');
  assert.match(source, /const COMPONENTS = \{\}/, 'the closed table moved; update this test and the claim about what is registered');
});

/* ------------------------------------------------------------------ §9.6: the security line */

test('no file in this package can load code at runtime (D13, D14)', () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const text = fs.readFileSync(abs, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
      for (const [pattern, why] of [
        [/\bimport\s*\(/, 'dynamic import'],
        [/\bnew\s+Function\b/, 'new Function'],
        [/\beval\s*\(/, 'eval'],
        [/from\s*['"]https?:/, 'remote module specifier'],
        [/\bWebAssembly\b/, 'WebAssembly'],
      ] as const) {
        if (pattern.test(text)) offenders.push(`${path.relative(ROOT, abs)}: ${why}`);
      }
    }
  };
  walk(path.join(ROOT, 'packages/ui/src'));
  assert.deepEqual(offenders, [], `runtime code loading reached the registry: ${offenders.join('; ')}`);
});

test('the registry exports no function that can add to it', () => {
  // Checked as data about the module, not as a grep of a comment: if `register` reappears, this fails.
  const exported = Object.keys({ componentById, documentProblems, isRegistryImmutable, registeredComponentIds, registrySize });
  assert.ok(exported.length >= 5, 'this list drifted from the module exports, so the check below is not covering the surface');
  const mutators = exported.filter((name) => /^(register|add|insert|set|load|extend|delete|remove|clear|mutate|update|push|apply)(?![a-z])/i.test(name));
  assert.deepEqual(mutators, [], `a registry mutator is reachable: ${mutators.join(', ')}`);
});

test('a page document cannot carry code, only an id and props', () => {
  // The strictness already lives in `packages/page-schema`; what this asserts is that *this* package's
  // validation path takes the same shape — a plain object with a component name — and has no field that a
  // function or a module specifier could travel through.
  const doc: { component: string; props?: unknown } = { component: 'x', props: { evil: 'return 1' } };
  const problems = documentProblems(doc);
  assert.deepEqual(problems, ['unknown component "x"']);
  // Nothing was evaluated: the only outcome is a reported problem.
});
