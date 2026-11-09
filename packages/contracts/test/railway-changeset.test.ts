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
  const db = graph.resources.find((r) => r.type === 'database')!;
  db.variables = { DATABASE_URL: { type: 'reference', resource: 'database.x', output: 'y' } };
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
  assert.deepEqual(Object.keys(vars).sort(), ['NODE_ENV', 'STRIPE_WEBHOOK_SECRET']);
  assert.deepEqual(vars.NODE_ENV, { type: 'literal', value: 'production' });
  assert.deepEqual(vars.STRIPE_WEBHOOK_SECRET, { type: 'preserve' });
  assert.ok(!JSON.stringify(graph).includes('sk_live'), 'no secret value may appear anywhere in a graph');
});

test('a declared reference becomes a graph reference node, not a preserve()', () => {
  const plan = samplePlan();
  const environment = plan.environments[0]!;
  environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'treedx-db', output: 'DATABASE_URL' }];
  const graph = buildDesiredGraph(plan, environment);
  const web = graph.resources.find((r) => r.type === 'service')!;
  assert.deepEqual(web.variables?.DATABASE_URL, { type: 'reference', resource: 'database.treedx-db', output: 'DATABASE_URL' });
});

test('a reference to an undeclared database throws instead of emitting a dangling link', () => {
  const plan = samplePlan();
  const environment = plan.environments[0]!;
  environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'does-not-exist' }];
  assert.throws(() => buildDesiredGraph(plan, environment), /does not declare/);
});

test('volumes become nodes and volumeAttachments on their service', () => {
  const plan = samplePlan();
  const environment = plan.environments[0]!;
  environment.volumes = [{ name: 'index-cache', service: 'api', mountPath: '/var/cache', sizeMB: 2048 }];
  const graph = buildDesiredGraph(plan, environment);
  const volumeNode = graph.resources.find((r) => r.type === 'volume');
  assert.ok(volumeNode, 'a volume node is emitted');
  assert.deepEqual(volumeNode.config, { sizeMB: 2048 });
  const web = graph.resources.find((r) => r.type === 'service')!;
  assert.deepEqual(web.volumeAttachments, { 'index-cache': { mountPath: '/var/cache', volume: 'volume.index-cache' } });
});
