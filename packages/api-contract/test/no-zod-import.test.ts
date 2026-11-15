import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

/**
 * Nothing in this package may import `zod` -- measured, not trusted (#247).
 *
 * The generator turns StandardSchema definitions into the OpenAPI document, and the obvious way to write that
 * is to import the schema library and build a composition with it. The obvious way is wrong HERE, for a reason
 * that has nothing to do with taste: `zod` is not a dependency of `@platfolio/api-contract`, and a bare
 * `zod` specifier still resolves on a maintainer's machine -- out of the home directory,
 * `/home/adrian/node_modules/zod` -- where a checkout in CI has nothing. So the code would compile, pass
 * locally, and fail the build for whoever came next.
 *
 * The design avoids the whole question: `toJSONSchema` is a method on the schema VALUE, `extend` and `array`
 * are methods too, and the values arrive from `packages/contracts` -- which declares `zod@^4.6.7` properly and
 * is imported by path, the same way `scripts/check-api.ts` has always reached it. The composition is therefore
 * built from the definitions' own behaviour with no library import at all, and the lockfile never moves.
 *
 * This test is the load-bearing part. The rule above is prose, and prose about a dependency edge is exactly
 * the kind of claim that rots the first time someone "just needs" `z`.
 */

// By path, from the package that owns the definitions -- the same edge `scripts/check-api.ts` uses, and the
// reason no `zod` dependency is needed here.
import { InstanceEnvironmentStateSchema, InstanceSchema } from '../../contracts/src/index.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SRC = path.join(ROOT, 'packages/api-contract/src');
const SCRIPTS = path.join(ROOT, 'scripts');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ts$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? dir, entry.name));
}

test('no module in api-contract or scripts imports zod', () => {
  const files = [...sources(SRC), ...sources(SCRIPTS)];
  const offenders = files.filter((file) => /(?:from|import)\s*\(?\s*['"]zod(?:\/[^'"]*)?['"]/m.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), [],
    `zod resolves here only via the maintainer's home directory; these files would break in CI:\n${offenders.join('\n')}`);
});

test('the hazard is real: zod does NOT resolve from this package on its own', () => {
  // The other half of the guard. If `zod` ever DID resolve from api-contract, the rule above would be
  // protecting nothing and this assertion would say so -- a lint whose premise is false is worse than no lint.
  const req = createRequire(path.join(SRC, 'index.ts'));
  const fromScript = createRequire(path.join(SCRIPTS, 'check-api.ts'));
  for (const [where, resolve] of [['packages/api-contract/src', req], ['scripts', fromScript]] as const) {
    let target: string;
    try {
      target = resolve.resolve('zod/package.json');
    } catch {
      continue; // Unresolvable at all is the CI answer, and equally fine.
    }
    assert.ok(!target.startsWith(ROOT + path.sep),
      `${where} resolves zod to ${target} -- outside the repository. That is the leak: it works on this machine and nowhere else. Declare it through pnpm, or keep taking it from the schema values, which already carry toJSONSchema/extend/array.`);
  }
});

test('the composition works without it: extend and array are methods on the values', () => {
  // Not a restatement of the test above -- proof that the design's premise holds, i.e. that the schema values
  // really do carry the behaviour the generator depends on. If zod ever moved those methods behind an import,
  // this fails and the generator has to declare the dependency honestly instead.
  const instance = InstanceSchema as unknown as {
    extend: (extra: Record<string, unknown>) => { toJSONSchema: (p: { target: string }) => { required?: string[]; additionalProperties?: unknown } };
  };
  const rows = InstanceEnvironmentStateSchema as unknown as { array: () => unknown };
  const composed = instance.extend({ environments: rows.array() });
  const json = composed.toJSONSchema({ target: 'openapi-3.1' });
  assert.ok(Array.isArray(json.required) && json.required.includes('environments'), 'the composed response requires the rows');
  assert.equal(json.additionalProperties, false, 'and the record stays strict through extend');
});
