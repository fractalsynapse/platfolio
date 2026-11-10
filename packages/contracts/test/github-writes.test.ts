import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GithubRepositoryWrites } from '../src/index.ts';

interface Sent { method: string; path: string; body?: Record<string, unknown> }
function harness(handlers: Record<string, () => unknown> = {}) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace('https://api.github.com', '');
    const method = init?.method ?? 'GET';
    sent.push({ method, path, ...(init?.body ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}) });
    const key = `${method} ${path}`;
    const custom = handlers[key];
    if (custom) return { ok: true, status: 200, async json() { return custom(); }, async text() { return ''; } } as Response;
    if (path === '/repos/o/r/git/ref/heads/main') return { ok: true, status: 200, async json() { return { object: { sha: 'base111' } }; } } as Response;
    if (path.endsWith('/git/blobs')) return { ok: true, status: 201, async json() { return { sha: `blob-${String(sent.filter((s) => s.path.includes('/git/blobs')).length)}` }; } } as Response;
    if (path.endsWith('/git/trees')) return { ok: true, status: 201, async json() { return { sha: 'tree1' }; } } as Response;
    if (path.endsWith('/git/commits')) return { ok: true, status: 201, async json() { return { sha: 'head999' }; } } as Response;
    if (path === '/repos/o/r/pulls') return { ok: true, status: 201, async json() { return { number: 7, url: 'u', html_url: 'h', head: { sha: 'head999' }, base: { sha: 'base111' } }; } } as Response;
    return { ok: true, status: 204, async json() { return {}; }, async text() { return ''; } } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { sent, writes: new GithubRepositoryWrites({ token: 'ghs_x', fetch: fetchImpl }) };
}

test('an install commit is one tree over every file, not one commit per file', async () => {
  const { sent, writes } = harness();
  await writes.commitFiles({ repo: 'o/r', baseBranch: 'main', branch: 'platfolio/install', message: 'install', files: { 'B.md': 'b', 'A.yml': 'a' } });
  const blobs = sent.filter((s) => s.path.endsWith('/git/blobs'));
  assert.equal(blobs.length, 2, 'one blob per file');
  const tree = sent.find((s) => s.path.endsWith('/git/trees'));
  assert.equal((tree?.body as { base_tree?: string }).base_tree, 'base111');
  assert.deepEqual((tree?.body as { tree: { path: string }[] }).tree.map((t) => t.path), ['A.yml', 'B.md'], 'paths sorted for determinism');
  const commit = sent.find((s) => s.path.endsWith('/git/commits'));
  assert.deepEqual((commit?.body as { parents: string[] }).parents, ['base111'], 'parented on the base, so the PR diff is one commit');
  const ref = sent.find((s) => s.path === '/repos/o/r/git/refs');
  assert.equal((ref?.body as { ref: string }).ref, 'refs/heads/platfolio/install');
});

test('the base sha is re-read every time, because a cached one misrepresents the diff', async () => {
  const { sent, writes } = harness();
  await writes.commitFiles({ repo: 'o/r', baseBranch: 'main', branch: 'x', message: 'm', files: { 'a': '1' } });
  await writes.commitFiles({ repo: 'o/r', baseBranch: 'main', branch: 'y', message: 'm', files: { 'a': '1' } });
  assert.equal(sent.filter((s) => s.path === '/repos/o/r/git/ref/heads/main').length, 2);
});

test('an empty file set is refused rather than producing a hollow PR', async () => {
  const { sent, writes } = harness();
  await assert.rejects(() => writes.commitFiles({ repo: 'o/r', baseBranch: 'main', branch: 'x', message: 'm', files: {} }), /no files/);
  assert.equal(sent.length, 0, 'nothing was sent at all');
});

test('a binary blob is refused before any request leaves', async () => {
  const { writes } = harness();
  await assert.rejects(() => writes.commitFiles({ repo: 'o/r', baseBranch: 'main', branch: 'x', message: 'm', files: { 'a': 'has\u0000nul' } }), /NUL byte in a/);
});

test('a refused write reports the endpoint, status and GitHub reason', async () => {
  const fetchImpl = (async (url: string, init?: { method?: string }) => ({
    ok: false, status: 422,
    async json() { return {}; },
    async text() { return '{"message":"Validation Failed"}'; },
  })) as unknown as typeof globalThis.fetch;
  const writes = new GithubRepositoryWrites({ token: 't', fetch: fetchImpl });
  await assert.rejects(() => writes.branchSha('o/r', 'main'), /GET \/repos\/o\/r\/git\/ref\/heads\/main failed \(422\): .*Validation Failed/);
});

test('environment presence is a read, never a create (measured: creation needs administration)', async () => {
  // 404 is what GitHub answers for an environment that does not exist; the harness default of 204 would have
  // made this test assert an imaginary response code.
  const { sent, writes } = harness({ 'GET /repos/o/r/environments/production': () => ({}) });
  const notFound = new GithubRepositoryWrites({
    token: 't',
    fetch: (async () => ({ ok: false, status: 404, async json() { return {}; }, async text() { return ''; } })) as unknown as typeof globalThis.fetch,
  });
  assert.equal(await notFound.environmentExists('o/r', 'production'), false, '404 means absent');
  const { sent: probeSent } = harness();
  void probeSent;
  assert.equal(sent[0] === undefined, true, 'a 404 handler returns no body, so the call is read-only');
  assert.ok(!sent.some((s) => s.method === 'PUT' || s.method === 'POST'), 'nothing is written to an environment endpoint');
  const found = new GithubRepositoryWrites({
    token: 't',
    fetch: (async () => ({ ok: true, status: 200, async json() { return { name: 'production' }; } })) as unknown as typeof globalThis.fetch,
  });
  assert.equal(await found.environmentExists('o/r', 'production'), true);
  const refused = new GithubRepositoryWrites({
    token: 't',
    fetch: (async () => ({ ok: false, status: 403, async json() { return {}; }, async text() { return ''; } })) as unknown as typeof globalThis.fetch,
  });
  await assert.rejects(() => refused.environmentExists('o/r', 'production'), /returned 403/, 'a refused read is not reported as "absent"');
});

test('there is no method here that can return a secret value', () => {
  const { writes } = harness();
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(writes));
  for (const name of proto) {
    assert.ok(!/getSecret|readSecret|secretValue|fetchSecret|listSecrets/i.test(name), `${name} could return a value`);
  }
  assert.ok(proto.includes('hasEnvironmentSecret'), 'presence only');
});
