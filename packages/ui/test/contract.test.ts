import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { z } from 'zod';
import { ContractViolation, defineComponent, draftableLeaf } from '../src/contract.ts';
import { SIGNAL_IDS } from '../src/signals.ts';
import { declareKnownSignalIds } from '../src/contract.ts';

// The contract validates `consumes`/`produces` against the ids the registry holds. `src/index.ts` seeds this at
// module load; a test that imports `contract.ts` directly must do the same, or every signal name would be
// reported unknown and the check would pass for the wrong reason.
declareKnownSignalIds(SIGNAL_IDS);

/**
 * 11 §1's contract, and the acceptance criteria in §5. The component built here is a **test double**, not a
 * screen: D49 permits a second implementation that proves a seam, and this one exists so the registration rules
 * can be exercised without shipping the UI those rules would govern.
 */

const noop = (): React.ReactNode => React.createElement('div');

const ExamplePropsSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  note: z.string().optional(),
  token: z.string().optional(),
}).strict();

const base = {
  id: 'example.panel',
  props: ExamplePropsSchema,
  slots: ['stack'] as const,
  render: noop,
};

test('a well-formed contract registers, and is frozen against later widening', () => {
  const c = defineComponent({
    ...base,
    reads: ['listInstances', 'getInstance'],
    consumes: ['context.switched'],
    produces: ['refresh.requested'],
    draftable: ['label', 'note'],
  });
  assert.ok(Object.isFrozen(c), 'a registered contract is mutable, so slots/reads can grow after review');
  assert.ok(Object.isFrozen(c.reads), 'the reads array is mutable');
  assert.ok(Object.isFrozen(c.slots), 'the slots array is mutable');
  assert.deepEqual([...c.draftable ?? []], ['label', 'note']);
});

/* ------------------------------------------------------------------ the refusals */

test('slots is required: there is no "fits anywhere" default', () => {
  const { slots: _omitted, ...withoutSlots } = base;
  assert.throws(
    () => defineComponent(withoutSlots as never),
    (error: unknown) => {
      assert.ok(error instanceof ContractViolation);
      assert.match(error.message, /slots is required and non-empty/);
      return true;
    },
  );
});

test('an empty slots array is refused, not read as "anywhere"', () => {
  assert.throws(() => defineComponent({ ...base, slots: [] }), /slots is required and non-empty/);
});

test('props must be a StandardSchemaV1 — a hand-written interface is #247 in a .tsx file (rule 1)', () => {
  assert.throws(
    () => defineComponent({ ...base, props: undefined as never }),
    /props must be a StandardSchemaV1/,
  );
  assert.throws(
    () => defineComponent({ ...base, props: { notASchema: true } as never }),
    /props must be a StandardSchemaV1/,
  );
});

test('a signal named in consumes/produces must exist in the registry (11 §3 acceptance (b))', () => {
  assert.throws(
    () => defineComponent({ ...base, consumes: ['context.switchen'] as never }),
    /not in the signal registry/,
  );
  assert.throws(
    () => defineComponent({ ...base, produces: ['instances.exploded'] as never }),
    /not in the signal registry/,
  );
  // And a real one is accepted, so the two assertions above are not a check that refuses everything.
  assert.ok(defineComponent({ ...base, consumes: ['context.switched'] }));
});

test('an unknown operation id reaches registration as an unvalidated string, and that limit is stated', () => {
  // There is no runtime list of OperationIds available *inside this package*: the generated table is types
  // only, and the one thing that could enumerate it — `loadSpec`/`operationsOf` in packages/api-contract — is
  // forbidden here by name (11 §6 acceptance (c): importing openapi.yaml parsing utilities into packages/ui is
  // a §9.2 failure). So `reads` is enforced by the compiler and not by this function, and pretending otherwise
  // would be a check that reads as protection while validating nothing.
  // The compile-time half is a real gate: `fixtures/reads-unknown-operation.negative.ts`, run by ui:check §9.1b.
  const c = defineComponent({ ...base, reads: ['listEvents'] as never });
  assert.deepEqual([...(c.reads ?? [])], ['listEvents'], 'the field was silently dropped instead of kept and reported');
});

/* ------------------------------------------------------------------ draftable is an allowlist */

test('draftableLeaf reaches the last segment of a path, so nesting cannot hide a credential', () => {
  assert.equal(draftableLeaf('token'), 'token');
  assert.equal(draftableLeaf('profile.token'), 'token');
  assert.equal(draftableLeaf('a.b.c.apiKey'), 'apiKey');
});

test('a value-bearing draftable path is refused at registration, not warned about (rule 4)', () => {
  for (const path of ['token', 'value', 'apiKey', 'clientSecret', 'password', 'profile.secretValue', 'note.value']) {
    assert.throws(
      () => defineComponent({ ...base, draftable: [path] }),
      (error: unknown) => {
        assert.ok(error instanceof ContractViolation, `${path}: threw ${(error as Error).name}`);
        assert.match(error.message, new RegExp(`draftable path "${path.replace(/[.]/g, '\\.')}" is value-bearing`));
        assert.match(error.message, /never hold a secret value \(D4, D53\)/);
        return true;
      },
      `"${path}" was accepted into a draft allowlist`,
    );
  }
});

test('the refusal reuses page-schema\'s predicate rather than a second secret list (D63)', async () => {
  // If this package grew its own name list, the two would drift and one would be wrong — the exact defect
  // `docs/ui-architecture.md` open gap 1 records as closed on 2026-11-15. The assertion: page-schema alone
  // decides, and a name it starts rejecting is rejected here on the same commit.
  const pageSchema = await import('@platfolio/page-schema');
  const credentialShaped = ['token', 'apiKey', 'clientSecret', 'secretValue', 'passphrase', 'bearer'];
  for (const key of credentialShaped) {
    assert.ok(pageSchema.isValueBearingKey(key), `page-schema no longer rejects "${key}"; the predicate moved and this test is now telling someone`);
    assert.throws(() => defineComponent({ ...base, draftable: [key] }), /value-bearing/, `"${key}" reached a draft allowlist`);
  }
  // Two questions, kept apart: what the *predicate* rejects, and what *registration* rejects. Registration
  // additionally demands the path name a real prop, so the benign list here is props this schema actually has.
  for (const benign of ['label', 'note', 'text', 'custody', 'satisfied']) {
    assert.ok(!pageSchema.isValueBearingKey(benign), `page-schema over-rejects "${benign}" — the predicate widened and a screen is about to lose a field for nothing`);
  }
  for (const benign of ['label', 'note']) {
    assert.ok(defineComponent({ ...base, draftable: [benign] }), `"${benign}" was refused by registration`);
  }
});

test('a draftable path must name a real prop, or the allowlist is not describing anything', () => {
  assert.throws(
    () => defineComponent({ ...base, draftable: ['notAProp'] }),
    /not a prop of this component/,
  );
  assert.throws(
    () => defineComponent({ ...base, draftable: ['tokenDeep.missing'] }),
    /not a prop of this component|value-bearing/,
    'a nested path under a non-existent root must not be accepted on the strength of its last segment alone',
  );
  // The real roots are accepted.
  assert.ok(defineComponent({ ...base, draftable: ['label', 'note'] }));
});

test('an absent draftable means "never drafted", and is not treated as "everything"', () => {
  const c = defineComponent(base);
  assert.equal(c.draftable, undefined);
  // The rule the registry depends on: nothing persists unless it is named. A default of "all string props"
  // would be a denylist wearing an allowlist's name.
  assert.equal((c.draftable ?? []).length, 0);
});

test('a schema whose props cannot be enumerated cannot carry an allowlist (fail closed)', () => {
  const opaque = {
    '~standard': { version: 1 as const, vendor: 'opaque', validate: (v: unknown) => ({ value: v as object }) },
  };
  assert.throws(
    () => defineComponent({ ...base, props: opaque as never, draftable: ['label'] }),
    /exposes no property names, so the allowlist cannot be checked/,
  );
  // Without a draftable declaration the opaque schema is fine: there is nothing to check.
  assert.ok(defineComponent({ ...base, props: opaque as never }));
});

/* ------------------------------------------------------------------ reporting shape */

test('every problem is reported at once, not one per CI run', () => {
  let message = '';
  try {
    defineComponent({
      id: '',
      props: undefined as never,
      slots: [],
      draftable: ['token'],
      consumes: ['nope'] as never,
      render: noop,
    });
  } catch (error) {
    message = (error as ContractViolation).message;
  }
  const lines = message.split('\n').filter((l) => l.trim().startsWith('- '));
  assert.ok(lines.length >= 4, `expected every violation listed together, got:\n${message}`);
  assert.match(message, /id must be a non-empty string/);
  assert.match(message, /props must be a StandardSchemaV1/);
  assert.match(message, /slots is required/);
  assert.match(message, /value-bearing/);
  assert.match(message, /not in the signal registry/);
});

test('ContractViolation carries the id and the problem list as data, for a caller that reports rather than throws', () => {
  try {
    defineComponent({ ...base, slots: [] });
    assert.fail('expected a refusal');
  } catch (error) {
    assert.ok(error instanceof ContractViolation);
    assert.equal(error.id, 'example.panel');
    assert.ok(Array.isArray(error.problems) && error.problems.length === 1);
  }
});

/* ------------------------------------------------------------------ the props schema is the one that runs */

test('the registered props schema validates the same strictness the page model uses', () => {
  const c = defineComponent(base);
  // StandardSchemaV1's validate may return a promise, so the union has to be narrowed before either branch's
  // fields are readable. A helper rather than four inline `instanceof Promise` checks.
  const issuesOf = (value: unknown): readonly unknown[] | undefined => {
    const result = c.props['~standard'].validate(value);
    assert.ok(!(result instanceof Promise), 'these fixtures use synchronous schemas');
    return (result as { issues?: readonly unknown[] }).issues;
  };
  assert.equal(issuesOf({ id: 'x', label: 'hi' }), undefined, 'a minimal valid prop set was rejected');
  assert.ok(issuesOf({ id: 'x', label: 'hi', unlistedKey: 'v' })?.length, 'a strict() props schema accepted an unlisted key, so an unknown prop reaches render()');
  assert.ok(issuesOf({ id: 'x' })?.length, 'a missing required prop was accepted');
});

test('a secret-shaped prop can exist in a schema and still be undraftable (the two rules are different)', () => {
  // `token` is a legal *prop* — a component may hold one in memory to render a masked value. What it may never
  // become is a drafted field. Refusing the prop would be over-broad and would push people to rename around it.
  const c = defineComponent({ ...base, draftable: ['note'] });
  assert.ok(!c.draftable?.includes('token'));
  assert.ok(ExamplePropsSchema.shape.token !== undefined, 'the schema lost the prop entirely');
});
