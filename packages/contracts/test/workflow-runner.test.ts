import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blobHash, classifyDrift, GithubWorkflowRunner, runState,
  type DispatchRequest,
} from '../src/index.ts';

const KNOWN = blobHash('name: platfolio\n');

interface Seen { method: string; url: string; body?: string }
function runner(handlers: (seen: Seen) => { status: number; json?: unknown }) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    const record = { method: init?.method ?? 'GET', url, ...(init?.body ? { body: init.body } : {}) };
    seen.push(record);
    const r = handlers(record);
    return {
      ok: r.status < 400, status: r.status,
      async json() { return r.json ?? {}; },
    } as Response;
  };
  return { seen, client: new GithubWorkflowRunner({ token: 't', fetch: fetchImpl as unknown as typeof globalThis.fetch }) };
}

test('the blob hash matches git for the same bytes', () => {
  // Value taken from `git hash-object` on the same content, so the comparison is against git rather than
  // against this function re-run.
  // `git hash-object` on these exact bytes returned 3fcdecf0..., so the expectation is git's, not this
  // function re-run against itself.
  assert.equal(KNOWN, '3fcdecf079e13d5026c9f08ec66fa79839f972ef');
  assert.equal(blobHash(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('drift is classified without ever overwriting', () => {
  assert.equal(classifyDrift('name: platfolio\n', KNOWN), 'in-sync');
  assert.equal(classifyDrift('name: platfolio\n', '0'.repeat(40)), 'changed');
  assert.equal(classifyDrift('name: platfolio\n', ''), 'missing');
  assert.equal(classifyDrift('name: platfolio\n', undefined), 'unknown', 'a read that failed is not a tenant edit');
});

test('a dispatch goes to the right endpoint with ref and inputs', async () => {
  const { seen, client } = runner(() => ({ status: 204 }));
  const request: DispatchRequest = { repo: 'o/r', workflow: 'platfolio-managed.yml', ref: 'main', inputs: { reason: 'reconcile' } };
  await client.dispatch(request);
  assert.equal(seen[0]?.method, 'POST');
  assert.equal(seen[0]?.url, 'https://api.github.com/repos/o/r/actions/workflows/platfolio-managed.yml/dispatches');
  assert.deepEqual(JSON.parse(seen[0]!.body ?? '{}'), { ref: 'main', inputs: { reason: 'reconcile' } });
});

test('a refused dispatch is reported, because a silent no-op is the failure mode we keep meeting', async () => {
  const { client } = runner(() => ({ status: 403 }));
  await assert.rejects(() => client.dispatch({ repo: 'o/r', workflow: 'w.yml', ref: 'main', inputs: {} }), /was not accepted \(403\)/);
});

test('status and conclusion are combined, and neither alone is trusted', () => {
  assert.equal(runState('completed', 'success'), 'success');
  assert.equal(runState('completed', 'failure'), 'failure');
  assert.equal(runState('in_progress', undefined), 'in-progress');
  assert.equal(runState('queued', undefined), 'queued');
  assert.equal(runState('completed', undefined), 'unknown', 'completed with no conclusion proves nothing');
  assert.equal(runState(undefined, undefined), 'unknown');
});

test('the latest run is correlated to a commit, not just to a name', async () => {
  const { client } = runner(() => ({ status: 200, json: { workflow_runs: [{ id: 2, status: 'completed', conclusion: 'success', head_sha: 'abc', html_url: 'https://gh/2' }] } }));
  const view = await client.latestRun('o/r', 'w.yml', 'main');
  assert.deepEqual(view, { runId: 2, state: 'success', headSha: 'abc', url: 'https://gh/2' });
});

test('a run with no commit is skipped rather than reported green', async () => {
  const { client } = runner(() => ({ status: 200, json: { workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success' }] } }));
  assert.equal(await client.latestRun('o/r', 'w.yml'), undefined);
});

test('file hash reads the contents endpoint and maps 404 to absent', async () => {
  const found = runner(() => ({ status: 200, json: { sha: KNOWN } }));
  assert.equal(await found.client.fileHash('o/r', '.github/workflows/platfolio-managed.yml', 'main'), KNOWN);
  const missing = runner(() => ({ status: 404 }));
  assert.equal(await missing.client.fileHash('o/r', '.github/workflows/x.yml', 'main'), '');
});

test('the runner cannot read logs -- no method, and no request ever made', async () => {
  const { seen, client } = runner((s) => (s.method === 'POST' ? { status: 204 } : { status: 200, json: { workflow_runs: [], sha: KNOWN } }));
  await client.dispatch({ repo: 'o/r', workflow: 'w.yml', ref: 'main', inputs: {} });
  await client.latestRun('o/r', 'w.yml', 'main');
  await client.fileHash('o/r', 'a/b.yml', 'main');
  for (const forbidden of ['logs', 'log', 'download', 'artifacts', 'output']) {
    assert.ok(!seen.some((s) => s.url.includes(`/${forbidden}`)), `a request touched ${forbidden}: ${seen.map((x) => x.url).join(' ')}`);
  }
  // Interface-shape check: logs would have to be added deliberately, and the type test catches that.
  const shape = client as unknown as Record<string, unknown>;
  for (const name of ['readLogs', 'getLogs', 'logs', 'downloadLogs']) assert.equal(shape[name], undefined, name);
});
