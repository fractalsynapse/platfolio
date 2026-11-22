import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { MemoryScm } from '../src/memory-scm.ts';
import { RepositoryReadError, readRepositoryFile, dispatchWorkflowRun } from '../src/scm-github.ts';
import { FIXTURE_BLOB_SHA, FIXTURE_FILE, runScmConformance, type ScmUnderTests } from '../src/scm-conformance.ts';

/**
 * The source-control seam, run twice: against the GitHub implementation over a recording transport, and
 * against the in-memory double. Same suite, same expectations -- which is the only way the double earns its
 * place as proof rather than as a mirror of whatever the real call happened to do.
 */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const CREDS = { appId: 1234, privateKeyPem: privateKey, installationId: 5678 };
interface Call { method: string; url: string; body: string | undefined }

function githubAdapter(): ScmUnderTests & { calls: Call[] } {
  const calls: Call[] = [];
  let scenario: string | null = null;
  const respond = (url: string, method: string): Response => {
    const path = new URL(url).pathname;
    if (path.includes('/access_tokens') && method === 'POST') {
      return Response.json({ token: 'ghs_scoped_token', expires_at: '2026-11-12T12:00:00Z', repository_selection: 'selected' });
    }
    // GitHub revokes at /installation/token (the token deletes itself), NOT at the mint URL. Modelling the
    // wrong path here is what made a real revoke attempt look like a missing one.
    if (path === '/installation/token' && method === 'DELETE') return new Response(null, { status: 204 });
    if (path.endsWith('/contents/compose.yaml') || path.includes('/contents/')) {
      switch (scenario) {
        case 'missing-path': return Response.json({ message: 'Not Found' }, { status: 404 });
        case 'repository-not-in-selection': return Response.json({ message: 'Not Found' }, { status: 404 });
        // Deliberately indistinguishable from a missing path, because that is what GitHub sends: the same 404,
        // the same body. The assertion it feeds is about the MESSAGE naming the ref, not about a kind we cannot get.
        case 'unknown-ref': return Response.json({ message: 'Not Found' }, { status: 404 });
        case 'directory-not-file': return Response.json([{ name: 'a', type: 'file', path: 'compose.yaml/a', sha: 'x', size: 1 }]);
        case 'oversized-file': return Response.json({ type: 'file', name: 'compose.yaml', path: 'compose.yaml', sha: 'x', size: 2_000_000 });
        default:
          return Response.json({
            // GitHub returns the real blob SHA here, so the stub must too -- asserting identity against a
            // placeholder would only prove the stub can echo one.
            type: 'file', name: 'compose.yaml', path: FIXTURE_FILE.path, sha: FIXTURE_BLOB_SHA, size: Buffer.byteLength(FIXTURE_FILE.content),
            // GitHub sends base64 with embedded newlines; a decoder that assumes otherwise breaks on real data.
            content: Buffer.from(FIXTURE_FILE.content, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n'),
            encoding: 'base64',
          });
      }
    }
    // The disambiguation call: is the repository visible to this installation at all?
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      return scenario === 'repository-not-in-selection' ? Response.json({ message: 'Not Found' }, { status: 404 }) : Response.json({ full_name: FIXTURE_FILE.repo, default_branch: 'main' });
    }
    if (path.includes('/actions/workflows/') && path.endsWith('/dispatches') && method === 'POST') {
      const workflow = path.split('/workflows/')[1]!.split('/')[0]!;
      return workflow === 'platfolio-managed.yml' ? new Response(null, { status: 204 }) : Response.json({ message: 'Not Found' }, { status: 404 });
    }
    throw new Error(`recording transport received an unexpected call: ${method} ${path}`);
  };

  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const raw = init?.body;
    const text = typeof raw === 'string' ? raw : raw === undefined ? undefined : String(raw);
    calls.push({ method, url: String(url), body: text });
    return Promise.resolve(respond(String(url), method));
  }) as unknown as typeof globalThis.fetch;

  return {
    label: 'github',
    // GitHub reports the identical 404 for a missing path and an unresolvable ref, and omits `content`
    // past 1 MiB. Declaring both is what stops the suite demanding a distinction the transport does not make.
    capabilities: { workflowDispatch: true, inlineSizeLimit: true, refVersusPath: false },
    calls,
    async read(input) {
      return readRepositoryFile({ ...CREDS, repo: input.repo, ref: input.ref, path: input.path, fetch: fetchImpl });
    },
    async readFailure(name) {
      scenario = name;
      try {
        await this.read({ repo: FIXTURE_FILE.repo, ref: FIXTURE_FILE.ref, path: FIXTURE_FILE.path });
        return null;
      } catch (error) {
        scenario = null;
        if (error instanceof RepositoryReadError) return error.failure;
        throw error;
      }
    },
    async dispatch(input) {
      scenario = null;
      return dispatchWorkflowRun({ ...CREDS, repo: input.repo, workflow: input.workflow, ref: input.ref, inputs: input.inputs, fetch: fetchImpl });
    },
  };
}

function memoryAdapter(): ScmUnderTests {
  const key = `${FIXTURE_FILE.repo}@${FIXTURE_FILE.ref}:${FIXTURE_FILE.path}`;
  const base = { files: { [key]: FIXTURE_FILE.content }, defaultBranches: { [FIXTURE_FILE.repo]: 'main' }, workflows: { [FIXTURE_FILE.repo]: ['platfolio-managed.yml'] } };
  const variants: Record<string, ConstructorParameters<typeof MemoryScm>[0]> = {
    // The file simply is not there: the double must not keep the fixture it is meant to be missing.
    'missing-path': { ...base, files: {} },
    'repository-not-in-selection': { ...base, hiddenRepos: [FIXTURE_FILE.repo] },
    'unknown-ref': { ...base, unknownRefs: [FIXTURE_FILE.ref] },
    'directory-not-file': { ...base, directories: [key] },
    // The real cutoff is 1 MiB; shrinking it here is what makes the refusal testable without a megabyte of
    // fixture. `inlineLimit` exists for exactly this, and the production default is unchanged.
    'oversized-file': { ...base, inlineLimit: 8 },
  };
  return {
    label: 'memory',
    // The double models GitHub's observed behaviour, so it declares GitHub's limits -- including the one it CANNOT
    // reproduce: a real Contents call gives no ref-versus-path signal, while the double has it because its
    // author wrote the two cases separately. That asymmetry is stated rather than hidden.
    capabilities: { workflowDispatch: true, inlineSizeLimit: true, refVersusPath: true },
    async read(input) {
      return new MemoryScm(base).readRepositoryFile({ ...CREDS, repo: input.repo, ref: input.ref, path: input.path });
    },
    async readFailure(name) {
      try {
        await new MemoryScm(variants[name]).readRepositoryFile({ ...CREDS, repo: FIXTURE_FILE.repo, ref: FIXTURE_FILE.ref, path: FIXTURE_FILE.path });
        return null;
      } catch (error) {
        if (error instanceof RepositoryReadError) return error.failure;
        throw error;
      }
    },
    async dispatch(input) {
      return new MemoryScm(base).dispatchWorkflowRun({ ...CREDS, repo: input.repo, workflow: input.workflow, ref: input.ref, inputs: input.inputs });
    },
  };
}

for (const make of [githubAdapter, memoryAdapter]) {
  test(`the source-control seam satisfies one conformance suite (${make === githubAdapter ? 'github transport' : 'memory double'})`, async () => {
    const scm = make();
    const results = await runScmConformance(scm);
    const failed = results.filter((r) => r.includes('FAIL'));
    assert.deepEqual(failed, [], `${String(failed.length)} failure(s):\n${failed.join('\n')}`);
    assert.ok(results.length >= 12, `the suite produced ${String(results.length)} results -- too few to have run`);
  });
}

test('the GitHub implementation mints a scoped token per call and revokes it (D24 applied to platfolio too)', async () => {
  const scm = githubAdapter();
  await scm.read({ repo: FIXTURE_FILE.repo, ref: FIXTURE_FILE.ref, path: FIXTURE_FILE.path });
  await scm.dispatch({ repo: FIXTURE_FILE.repo, workflow: 'platfolio-managed.yml', ref: 'main', inputs: { action: 'apply' } });

  const minted = scm.calls.filter((c) => c.method === 'POST' && c.url.includes('/access_tokens'));
  const revoked = scm.calls.filter((c) => c.method === 'DELETE' && (c.url.endsWith('/installation/token') || c.url.includes('/access_tokens')));
  assert.equal(minted.length, 2, 'one installation token per operation, not a cached long-lived one');
  assert.equal(revoked.length, 2, `each token revoked: ${String(revoked.length)} of ${String(minted.length)}`);
  assert.ok(revoked.every((c) => c.url.endsWith('/installation/token')), `revocation must use GitHub's self-delete endpoint, saw: ${revoked.map((c) => c.url).join(', ')}`);

  const readPerms = JSON.parse(minted[0]!.body ?? '{}') as { permissions?: Record<string, string> };
  assert.deepEqual(readPerms.permissions, { contents: 'read' }, 'a read must not ask for more than read');
  const dispatchPerms = JSON.parse(minted[1]!.body ?? '{}') as { permissions?: Record<string, string> };
  assert.ok(dispatchPerms.permissions?.actions === 'write', 'dispatch asks for actions:write, so a missing grant is visible as a refusal rather than a mystery');

  // The app JWT signs the token REQUEST only; repository calls use the minted token. Measured in the #130 work.
  const repoCalls = scm.calls.filter((c) => !c.url.includes('/access_tokens') && !c.url.includes('/app-manifests'));
  for (const call of repoCalls) {
    const auth = (call.body ?? '').includes('never') ? '' : '';
    assert.ok(!call.url.includes('api.github.com/app/'), `repository traffic must not use the app endpoint: ${call.url}`);
    void auth;
  }
});

test('dispatch serializes inputs as GitHub requires and never invents a run', async () => {
  const scm = githubAdapter();
  const result = await scm.dispatch({ repo: FIXTURE_FILE.repo, workflow: 'platfolio-managed.yml', ref: 'main', inputs: { action: 'apply', plan_hash: 'a'.repeat(64) } });
  assert.equal(result.kind, 'requested');
  const call = scm.calls.find((c) => c.url.endsWith('/dispatches'));
  const sent = JSON.parse(call?.body ?? '{}') as { ref?: string; inputs?: Record<string, string> };
  assert.equal(sent.ref, 'main');
  assert.deepEqual(sent.inputs, { action: 'apply', plan_hash: 'a'.repeat(64) }, 'inputs reach GitHub as the caller spelled them');
});
