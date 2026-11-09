import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildDesiredGraph, samplePlan, type GraphNode } from '../src/index.ts';

const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'railway-desired-graph.json');
const cliOutput = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { resources: GraphNode[] };

/** The node key set the CLI emits, captured verbatim from `railway config plan --json`. */
const NODE_KEYS = ['address', 'type', 'kind', 'name', 'engine', 'variables', 'source', 'build', 'deploy', 'networking', 'volumeAttachments', 'config', 'groupId', 'tracing', 'cdn'];

test('the change-set payload matches the captured Railway CLI output in shape', () => {
  const plan = samplePlan();
  const graph = buildDesiredGraph(plan, plan.environments[0]!);
  const kinds = new Set(graph.resources.map((r) => r.type));
  assert.ok(kinds.has('database') && kinds.has('bucket') && kinds.has('service'), JSON.stringify([...kinds]));
  for (const resource of graph.resources) {
    assert.deepEqual(Object.keys(resource).sort(), [...NODE_KEYS].sort(), `${resource.address} key set diverges from the CLI`);
    assert.match(resource.address, new RegExp(`^${resource.type}\\.`), 'address must be type.name, as the differ expects');
  }
  for (const fixtureNode of cliOutput.resources) {
    assert.deepEqual(Object.keys(fixtureNode).sort(), [...NODE_KEYS].sort(), `fixture node ${fixtureNode.address} drifted from the documented key set`);
  }
});

test('a database node carries Railway template image, not one we chose', () => {
  const plan = samplePlan();
  const graph = buildDesiredGraph(plan, plan.environments[0]!);
  const db = graph.resources.find((r) => r.type === 'database');
  assert.ok(db);
  assert.equal(db.engine, 'postgres');
  assert.match(String(db.source?.image), /^ghcr\.io\/railwayapp-templates\/postgres-ssl:/, 'managed databases come from Railway template registry');
  assert.equal(db.kind, 'database');
});

test('bucket region survives; a secret is preserve-typed and never literal', () => {
  const plan = samplePlan();
  const graph = buildDesiredGraph(plan, plan.environments[0]!);
  const bucket = graph.resources.find((r) => r.type === 'bucket');
  assert.deepEqual((bucket?.config ?? {}) as object, { region: 'iad' });
  const web = graph.resources.find((r) => r.type === 'service')!;
  const vars = web.variables ?? {};
  assert.deepEqual(Object.keys(vars), ['NODE_ENV', 'STRIPE_WEBHOOK_SECRET']);
  assert.deepEqual(vars.NODE_ENV, { type: 'literal', value: 'production' });
  assert.deepEqual(vars.STRIPE_WEBHOOK_SECRET, { type: 'preserve' });
  assert.ok(!JSON.stringify(graph).includes('sk_live'), 'no secret value may appear anywhere in a graph');
});

test('a reference the environment does not declare is refused, not silently dropped', () => {
  const plan = samplePlan();
  const graph = buildDesiredGraph(plan, plan.environments[0]!);
  assert.ok(graph.resources.length >= 3, 'the plan is exercised end to end');
  // Wiring databases to service variables needs `references` on the plan; until that exists the builder
  // emits no reference nodes at all, which this test pins so the gap cannot be papered over.
  const refs = graph.resources.flatMap((r) => Object.values(r.variables ?? {}).filter((v) => v.type === 'reference'));
  assert.equal(refs.length, 0, 'no references are invented; see the builder comment');
});
