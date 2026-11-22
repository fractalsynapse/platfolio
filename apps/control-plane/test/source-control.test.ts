import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { buildPlan, parseCompose } from '@platfolio/manifest';
import { blobSha, createIdentityFixture, defaultIdentityConfig, reasonOf, signToken, type StoreResult } from '@platfolio/contracts';

/**
 * The two operations that put platfolio in touch with a tenant's repository (#172's middle): building a plan
 * from the tenant's own committed Compose, and asking GitHub to run the dispatch.
 *
 * GitHub is stubbed at the transport, which is what the seam's threaded `fetch` makes possible -- and what the
 * conformance suite caught it forking when the mint call ignored it. Nothing here contacts the network.
 */

const fixture = createIdentityFixture();
const scoped = () => signToken(fixture, { scope: 'platfolio.user' });
const build = { version: '9.9.9', commit: 'abcdef0123456789abcdef0123456789abcdef01', buildTime: '2026-11-12T00:00:00Z' };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

const REPO = 'acme/widget';
const COMMIT = 'cccccccccccccccccccccccccccccccccccccccc';

// A real-looking digest. `a`.repeat(64) was refused by the renderer's own placeholder check (#84) -- which is
// exactly the rule that exists to stop a stale or invented pin reaching a provider, so the fixture complies
// rather than the rule being bent.
const DIGEST = 'b1a2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef';
const PINNED_COMPOSE = [
  'name: widget',
  'services:',
  '  web:',
  `    image: nginx:alpine@sha256:${DIGEST}`,
  '    expose: ["8080"]',
  '    x-platfolio:',
  '      public: true',
  '      domains: [web.example.com]',
  'x-platfolio:',
  // kind and mode are required (D51) -- and this fixture failing was the schema doing its job: the API
  // reported the refusal rather than building a plan from a document that never said what it was.
  '  metadata: { name: widget, version: 1.0.0, title: Widget, summary: A tenant platform, kind: web, mode: hosted }',
  // All three environments are required by the schema, and `release` is what makes a first-party image
  // resolvable. A fixture that omits them is not a tenant document -- which the API told me, loudly, by
  // refusing to build a plan from it.
  '  environments:',
  '    production: { enabled: true, branch: main }',
  '    staging: { enabled: false }',
  '    preview: { enabled: false }',
  '  release: { registryImage: ghcr.io/acme/widget, tagPattern: "v*" }',
  '',
].join('\n');

// The same platform without a digest: what a tenant pushes before their image is published.
const UNPINNED_COMPOSE = PINNED_COMPOSE.replace(`    image: nginx:alpine@sha256:${DIGEST}`, '    build: { context: . }');

interface GithubState {
  files?: Record<string, string>;
  /** The installation cannot see the repository at all: GitHub's indistinguishable 404 pair (#130). */
  repoVisible?: boolean;
  dispatchStatus?: number;
  dispatchMessage?: string;
}

interface GithubStub {
  // `body: string | undefined` rather than `body?: string`: under exactOptionalPropertyTypes
  // recording a GET as `body: undefined` must be assignable.
  calls: { method: string; url: string; body: string | undefined }[];
  restore(): void;
}

function stubGithub(state: GithubState): GithubStub {
  const real = globalThis.fetch;
  const calls: { method: string; url: string; body: string | undefined }[] = [];
  const files = state.files ?? { 'compose.yaml': PINNED_COMPOSE };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://api.github.com/')) return real(input as string | URL, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ method, url, body });
    const path = new URL(url).pathname;
    if (path.includes('/access_tokens') && method === 'POST') {
      return Response.json({ token: 'ghs_stub', expires_at: '2026-11-12T13:00:00Z', repository_selection: 'selected' });
    }
    if (path === '/installation/token' && method === 'DELETE') return new Response(null, { status: 204 });
    const contents = path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (contents) {
      const wanted = decodeURIComponent(contents[1]!);
      const ref = new URL(url).searchParams.get('ref');
      const content = files[wanted];
      if (content === undefined) {
        // GitHub's 404 for a missing path; the repository probe below is what separates it from an
        // installation that cannot see the repository at all (#130).
        return Response.json({ message: 'Not Found' }, { status: 404 });
      }
      // Serve the fixture at a real-looking commit (40 hex) or at the branches this suite names, and refuse
      // anything else the way GitHub does. The earlier version accepted only one constant ref, which meant a
      // test that pinned a DIFFERENT commit was failing against the stub's preference rather than the
      // implementation's behaviour -- and the assertion worth having is exactly that the operation reads the
      // commit the instance cites.
      if (!/^([0-9a-f]{40}|main|staging)$/.test(String(ref))) {
        return Response.json({ message: 'Not Found' }, { status: 404 });
      }
      return Response.json({
        type: 'file', name: wanted, path: wanted, sha: blobSha(content), size: Buffer.byteLength(content),
        content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64',
      });
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      return state.repoVisible === false
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : Response.json({ full_name: REPO, default_branch: 'main' });
    }
    if (path.endsWith('/dispatches') && method === 'POST') {
      if (state.dispatchStatus && state.dispatchStatus !== 204) {
        return Response.json({ message: state.dispatchMessage ?? 'Not Found' }, { status: state.dispatchStatus });
      }
      return new Response(null, { status: 204 });
    }
    throw new Error(`stub github transport received an unmodelled call: ${method} ${path}`);
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

function must<T>(result: StoreResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} refused: ${reasonOf(result)}`);
}

async function start(options: { scmConfigured?: boolean } = {}) {
  process.env.PLATFOLIO_RECONCILE_INTERVAL_MS = '120';
  const ctx: KernelContext = await createKernel({
    provider: 'fake',
    custody: 'strict',
    identity: defaultIdentityConfig(fixture),
    identityKeys: [fixture.jwk],
    store: { driver: 'memory' },
    server: { port: 0 },
    ...(options.scmConfigured === false
      ? { scm: { driver: 'none' as const } }
      : { scm: { driver: 'github-app' as const, appId: 1, installationId: 2, privateKeyPem: privateKey } }),
    extensions: buildCapabilities({ build }),
    requiredServices: ['identity', 'server', 'store', 'extensions', 'scm'],
  });
  const base = () => `http://127.0.0.1:${String(ctx.server.address.port)}`;
  const call = async (p: string, init: RequestInit = {}) => {
    const response = await fetch(base() + p, init);
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text) as unknown; } catch { body = text; }
    return { status: response.status, body, text };
  };
  const token = scoped();
  const asUser = () => ({ headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const teamId = must(await ctx.store.createTeam({ name: `t-${Math.random().toString(36).slice(2, 8)}` }), 'createTeam').id;
  const person = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'resolvePerson');
  must(await ctx.store.putTeamMember({ teamId, personId: person.person.id, role: 'owner' }), 'putTeamMember');
  const instance = must(await ctx.store.createInstance({ teamId, name: 'widget', template: 'starter-web', templateRef: { repo: REPO, commitSha: COMMIT } }), 'createInstance');
  return { ctx, call, asUser, token, teamId, instanceId: instance.id };
}

const fromRepo = (id: string) => `/api/v1/instances/${id}/plan/from-repository`;

test('a plan is built from the tenant repository and recorded with the digest buildPlan computed', async () => {
  const github = stubGithub({});
  const app = await start();
  try {
    const response = await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(response.status, 200, response.text);
    const body = response.body as { instanceId: string; planHash: string; source: { repo: string; ref: string; files: { path: string; blobSha: string }[] }; summary: { services: number; environments: string[] } };
    assert.equal(body.instanceId, app.instanceId);
    assert.equal(body.source.repo, REPO);
    assert.equal(body.source.ref, COMMIT, 'the read must be against the pinned commit, not a branch (D29)');
    assert.deepEqual(body.source.files.map((f) => f.path), ['compose.yaml'], 'the missing overlay is allowed and not reported as read');
    assert.equal(body.source.files[0]!.blobSha, blobSha(PINNED_COMPOSE), 'the blob identity must be the one GitHub reported for the bytes used');

    // The digest has ONE home. Recomputed here from the same text, it must agree with what the service stored:
    // an API that re-derived hashes is the bug that made every honest attestation fail with 400.
    const parsed = parseCompose(PINNED_COMPOSE);
    assert.ok(parsed.manifest, JSON.stringify(parsed.issues));
    const expected = buildPlan(parsed.manifest!, { instanceId: app.instanceId, teamId: app.teamId });
    assert.equal(body.planHash, expected.planHash);
    assert.equal(body.summary.services, expected.environments.reduce((n, e) => n + e.services.length, 0));
    assert.deepEqual(body.summary.environments, ['production']);

    const stored = await app.ctx.store.getPlan(app.instanceId);
    assert.ok(stored.ok, 'the plan was not recorded');
    const after = await app.ctx.store.getInstance(app.instanceId);
    assert.equal(after.ok && after.value.desiredPlanHash, body.planHash, 'pending, with the new digest as the desired state');

    // Reads mint a token, use it, and revoke it. The mint/revocation pair is asserted because a leak of the
    // first kind and a leak of the second look identical from the outside.
    const minted = github.calls.filter((c) => c.url.includes('/access_tokens') && c.method === 'POST');
    const revoked = github.calls.filter((c) => c.url === 'https://api.github.com/installation/token' && c.method === 'DELETE');
    assert.ok(minted.length >= 1, 'no installation token was minted');
    assert.equal(revoked.length, minted.length, `minted ${String(minted.length)}, revoked ${String(revoked.length)}`);
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('an unpinned first-party image is refused with the renderer’s own reason, not a paraphrase', async () => {
  const github = stubGithub({ files: { 'compose.yaml': UNPINNED_COMPOSE } });
  const app = await start();
  try {
    const response = await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(response.status, 400, response.text);
    const body = response.body as { error: string; message: string };
    assert.equal(body.error, 'manifest-invalid');
    // #84's refusal mentions the service and why. The API quoting it means one voice owns the truth.
    assert.match(body.message, /web/, body.message);
    assert.ok(/pin|digest|image/i.test(body.message), body.message);
    const stored = await app.ctx.store.getPlan(app.instanceId);
    assert.equal(stored.ok, false, 'a refused manifest must not leave a plan registered');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('a repository the installation cannot see is 403, distinguishable from a missing path', async () => {
  const github = stubGithub({ repoVisible: false, files: {} });
  const app = await start();
  try {
    const response = await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(response.status, 403, response.text);
    const body = response.body as { error: string; message: string };
    assert.equal(body.error, 'repository-not-installed');
    assert.match(body.message, /installation/, body.message);
    assert.match(body.message, /#130/, 'the message should lead the operator to the limit that explains it');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('a missing compose.yaml is 400 source-unreadable, a different answer from an invisible repository', async () => {
  const github = stubGithub({ files: {}, repoVisible: true });
  const app = await start();
  try {
    const response = await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(response.status, 400, response.text);
    const body = response.body as { error: string; message: string };
    assert.equal(body.error, 'source-unreadable');
    assert.match(body.message, /compose\.yaml/, body.message);
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('without source control configured the answer is 503, not an empty plan', async () => {
  const app = await start({ scmConfigured: false });
  try {
    const response = await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(response.status, 503, response.text);
    assert.equal((response.body as { error: string }).error, 'source-control-not-configured');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('an instance that cites no commit cannot have a plan built, and says so', async () => {
  const github = stubGithub({});
  const app = await start();
  try {
    const loose = must(await app.ctx.store.createInstance({ teamId: app.teamId, name: 'floaty', template: 'starter-web' }), 'createInstance unref');
    const response = await app.call(fromRepo(loose.id), { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(response.status, 400, response.text);
    assert.equal((response.body as { error: string }).error, 'no-pinned-source');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('triggering asks GitHub to run the tenant workflow, carrying all six inputs the workflow requires', async () => {
  const github = stubGithub({});
  const app = await start();
  try {
    const built = await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(built.status, 200, built.text);
    const dispatched = await app.call(`/api/v1/instances/${app.instanceId}/dispatches`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ action: 'apply', environment: 'production' }),
    });
    assert.equal(dispatched.status, 201, dispatched.text);
    const intent = (dispatched.body as { intent: { dispatchId: string; nonce: string; planHash: string } }).intent;

    const before = github.calls.length;
    const trigger = await app.call(`/api/v1/instances/${app.instanceId}/dispatches/${intent.dispatchId}/trigger`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ ref: 'main' }),
    });
    assert.equal(trigger.status, 202, trigger.text);
    const body = trigger.body as { state: string; repo: string; ref: string; workflow: string };
    assert.deepEqual([body.state, body.repo, body.ref, body.workflow], ['requested', REPO, 'main', 'platfolio-managed.yml']);

    const sent = github.calls.slice(before).find((c) => c.url.endsWith('/dispatches'));
    assert.ok(sent, 'no dispatch call reached GitHub');
    const payload = JSON.parse(sent.body ?? '{}') as { ref: string; inputs: Record<string, string> };
    assert.equal(payload.ref, 'main');
    // Exactly the six inputs the rendered workflow declares required. A seventh name here would be a workflow
    // that fails at "Set up job" with a missing input, and none of these belongs in audit (the nonce does).
    assert.deepEqual(Object.keys(payload.inputs).sort(), ['action', 'dispatch_id', 'environment', 'instance_id', 'nonce', 'plan_hash']);
    assert.equal(payload.inputs.plan_hash, intent.planHash);
    assert.equal(payload.inputs.dispatch_id, intent.dispatchId);
    assert.equal(payload.inputs.nonce, intent.nonce);

    // The store exposes `recentAudit(limit)` with no per-instance filter, so the test filters -- and the
    // limit is generous because other operations in this test wrote rows first.
    const audit = await app.ctx.store.recentAudit(50);
    const row = audit.find((r) => r.action === 'dispatch.trigger' && r.target === app.instanceId);
    assert.ok(row, 'the trigger was not audited');
    assert.equal(JSON.stringify(row!.detail).includes(intent.nonce), false, 'the single-use nonce must not be copied into the audit trail');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('a dispatch already fetched by a runner cannot be triggered again', async () => {
  const github = stubGithub({});
  const app = await start();
  try {
    await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    const dispatched = await app.call(`/api/v1/instances/${app.instanceId}/dispatches`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ action: 'apply', environment: 'production' }),
    });
    const id = (dispatched.body as { intent: { dispatchId: string } }).intent.dispatchId;
    // A runner fetch consumes the nonce: the same read twice is a replay, not a retry.
    const fetched = await app.call(`/api/v1/instances/${app.instanceId}/dispatches/${id}`);
    assert.equal(fetched.status, 200, fetched.text);

    const trigger = await app.call(`/api/v1/instances/${app.instanceId}/dispatches/${id}/trigger`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ ref: 'main' }),
    });
    assert.equal(trigger.status, 409, trigger.text);
    assert.equal((trigger.body as { error: string }).error, 'dispatch-consumed');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('GitHub’s refusal is forwarded, because a run that never started leaves no logs behind', async () => {
  const github = stubGithub({ dispatchStatus: 404, dispatchMessage: 'Not Found' });
  const app = await start();
  try {
    await app.call(fromRepo(app.instanceId), { method: 'POST', ...app.asUser(), body: '{}' });
    const dispatched = await app.call(`/api/v1/instances/${app.instanceId}/dispatches`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ action: 'apply', environment: 'production' }),
    });
    const id = (dispatched.body as { intent: { dispatchId: string } }).intent.dispatchId;
    const trigger = await app.call(`/api/v1/instances/${app.instanceId}/dispatches/${id}/trigger`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ ref: 'main' }),
    });
    assert.equal(trigger.status, 502, trigger.text);
    const body = trigger.body as { error: string; message: string };
    assert.equal(body.error, 'workflow-not-found');
    assert.match(body.message, /default branch/, 'the #149 cause has to be said: an unmerged install PR and a typo are the same 404');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

/**
 * The assertion that would have caught the first live run. `POST /api/v1/instances` documents `templateRef`,
 * the entity stores it, and `plan/from-repository` is impossible without it -- yet the handler picked only
 * three fields from a STRICT schema, so the documented body was refused with `Unrecognized key`. Found by
 * calling the real service, which is the only reason it was found at all: spec, storage and handler each agreed
 * with themselves and none of them was checked against the other two until an HTTP request did it.
 */
test('a created instance carries the pinned source the spec promises, and the new operation can use it', async () => {
  const github = stubGithub({});
  const app = await start();
  try {
    const commitSha = 'ab'.repeat(20);
    const created = await app.call('/api/v1/instances', {
      method: 'POST', ...app.asUser(),
      body: JSON.stringify({ teamId: app.teamId, name: 'pinned', template: 'starter-web', templateRef: { repo: REPO, commitSha } }),
    });
    assert.equal(created.status, 201, created.text);
    const read = await app.call(`/api/v1/instances/${(created.body as { id: string }).id}`, { ...app.asUser() });
    assert.deepEqual((read.body as { templateRef?: { repo: string; commitSha: string } }).templateRef, { repo: REPO, commitSha }, 'the pin must survive the round trip');

    const built = await app.call(`/api/v1/instances/${(created.body as { id: string }).id}/plan/from-repository`, { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(built.status, 200, built.text);
    assert.equal((built.body as { source: { ref: string } }).source.ref, commitSha, 'the operation must read the commit the instance cites, not a branch');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

/**
 * D54: the release pipeline reports its digest instead of committing one, and the renderer accepts the
 * consequences -- a platform described by `build:` alone becomes installable once a build has run, with no
 * `compose.prod.yaml` in the repository at all. This is the end of #217.
 */
const BUILD_ONLY = [
  'name: fork',
  'services:',
  '  web:',
  '    build: { context: . }',
  '    expose: ["8080"]',
  '    healthcheck:',
  `      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`,
  '    x-platfolio:',
  '      public: true',
  '      domains: [fork.example.com]',
  '      secrets: [{ name: APP_SECRET, source: shared-variable }]',
  'x-platfolio:',
  '  metadata: { name: fork, version: 1.0.0, title: Fork, summary: A tenant platform, kind: web, mode: hosted }',
  '  environments:',
  '    production: { enabled: true, branch: main }',
  '    staging: { enabled: false }',
  '    preview: { enabled: false }',
  '  release: { registryImage: ghcr.io/acme/fork, tagPattern: "v*" }',
  '',
].join('\n');

const REAL_DIGEST = `sha256:${'c5'.repeat(32)}`;

async function forkInstance(app: Awaited<ReturnType<typeof start>>) {
  const created = await app.call('/api/v1/instances', {
    method: 'POST', ...app.asUser(),
    body: JSON.stringify({
      teamId: app.teamId, name: 'fork', template: 'starter-web',
      templateRef: { repo: REPO, commitSha: 'ab'.repeat(20) },
    }),
  });
  const id = (created.body as { id?: string }).id;
  assert.ok(id, created.text);
  return id!;
}

test('a build-only platform refuses until a release is reported, and names the pipeline as the fix', async () => {
  const github = stubGithub({ files: { 'compose.yaml': BUILD_ONLY } });
  const app = await start();
  try {
    const id = await forkInstance(app);
    const refused = await app.call(`/api/v1/instances/${id}/plan/from-repository`, { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(refused.status, 400, refused.text);
    const message = (refused.body as { message: string }).message;
    // Not "invalid document": the true cause is a pipeline that has not run, and the message has to say so.
    assert.match(message, /publish one/, message);
    assert.match(message, /artifacts/, 'the message must name the operation that fixes it');
    assert.match(message, /web/, 'and the service that is missing an artifact');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('reporting the artifact makes the same platform installable with no pin file in the repository (D54)', async () => {
  const github = stubGithub({ files: { 'compose.yaml': BUILD_ONLY } });  // deliberately no compose.prod.yaml
  const app = await start();
  try {
    const id = await forkInstance(app);
    const bad = await app.call(`/api/v1/instances/${id}/artifacts`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ service: 'web', image: 'ghcr.io/acme/fork', digest: 'latest' }),
    });
    assert.equal(bad.status, 400, 'a tag is not a digest');
    assert.match((bad.body as { message: string }).message, /digest/, JSON.stringify(bad.body));

    const reported = await app.call(`/api/v1/instances/${id}/artifacts`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ service: 'web', image: 'ghcr.io/acme/fork', digest: REAL_DIGEST, sourceRef: 'ab'.repeat(20) }),
    });
    assert.equal(reported.status, 201, reported.text);
    const record = reported.body as { digest: string; reportedAt: string; service: string };
    assert.equal(record.digest, REAL_DIGEST);
    assert.ok(record.reportedAt.length > 0);

    const built = await app.call(`/api/v1/instances/${id}/plan/from-repository`, { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(built.status, 200, built.text);
    const body = built.body as { source: { files: { path: string }[] }; summary: { services: number }; planHash: string };
    assert.deepEqual(body.source.files.map((f) => f.path), ['compose.yaml'], 'the plan came from ONE file -- no generated overlay exists in this repository');
    assert.equal(body.summary.services, 1);
    assert.match(body.planHash, /^[0-9a-f]{64}$/);

    // A second release replaces the first: the plan must move, because a stale artifact is the same failure in
    // a new place, and "newest report wins" is what makes the record mean "what is live".
    const newer = `sha256:${'d9'.repeat(32)}`;
    await app.call(`/api/v1/instances/${id}/artifacts`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ service: 'web', image: 'ghcr.io/acme/fork', digest: newer }),
    });
    const rebuilt = await app.call(`/api/v1/instances/${id}/plan/from-repository`, { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(rebuilt.status, 200, rebuilt.text);
    assert.notEqual((rebuilt.body as { planHash: string }).planHash, body.planHash, 'a new artifact must produce a new plan hash');

    const audit = await app.ctx.store.recentAudit(60);
    const row = audit.find((r) => r.action === 'artifact.report');
    assert.ok(row, 'the report was not audited');
    assert.equal(JSON.stringify(row!.detail).includes('APP_SECRET'), false, 'unrelated names must not appear in an artifact row');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('secrets are delivered and read back as presence; the value never comes out again (D53)', async () => {
  const github = stubGithub({ files: { 'compose.yaml': BUILD_ONLY } });
  const app = await start();
  try {
    const id = await forkInstance(app);
    await app.call(`/api/v1/instances/${id}/artifacts`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ service: 'web', image: 'ghcr.io/acme/fork', digest: REAL_DIGEST }),
    });
    const built = await app.call(`/api/v1/instances/${id}/plan/from-repository`, { method: 'POST', ...app.asUser(), body: '{}' });
    assert.equal(built.status, 200, built.text);

    // Before anything is applied, presence is `unverifiable`, NOT `missing`. The provider has no such instance,
    // and answering "the credential is absent" would be platfolio inventing a fact about a project it has not
    // touched -- the same class of overclaim as reporting a certificate as issued because a hostname exists.
    const neverApplied = await app.call(`/api/v1/instances/${id}/secrets?environment=production&service=web`, { ...app.asUser() });
    assert.equal(neverApplied.status, 200, neverApplied.text);
    assert.deepEqual((neverApplied.body as { presence: { state: string }[] }).presence.map((x) => x.state), ['unverifiable'],
      'presence is a provider question; an unapplied instance cannot be asked');

    // Apply the plan through the provider, as the controller would, so the instance exists in the driver.
    const registered = await app.ctx.store.getPlan(id);
    assert.ok(registered.ok, 'the plan was not registered');
    const applied = await app.ctx.infra.applyPlan(registered.value.plan as Parameters<typeof app.ctx.infra.applyPlan>[0]);
    assert.equal(applied.verified, true, JSON.stringify(applied.failures));

    const before = await app.call(`/api/v1/instances/${id}/secrets?environment=production&service=web`, { ...app.asUser() });
    assert.equal(before.status, 200, before.text);
    const presenceBefore = (before.body as { presence: { name: string; state: string }[] }).presence;
    // Now the question is answerable, and the answer is `missing`: the plan declares the name, nobody filled it.
    assert.deepEqual(presenceBefore, [{ name: 'APP_SECRET', state: 'missing' }], 'the plan declares the name; nothing is filled yet');

    // A second principal at member role, granted through the store rather than assumed: the 403 must come from
    // the policy table meeting a real membership, not from a token nobody can resolve.
    const member = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'member-subject' }), 'member person');
    must(await app.ctx.store.putTeamMember({ teamId: app.teamId, personId: member.person.id, role: 'member' }), 'putTeamMember');
    const asMember = { headers: { authorization: `Bearer ${signToken(fixture, { subject: 'member-subject', scope: 'platfolio.user' })}`, 'content-type': 'application/json' } };

    const secret = 's3cr3t-value-that-must-not-come-back-out';
    const wrongRole = await app.call(`/api/v1/instances/${id}/secrets/APP_SECRET`, {
      method: 'PUT', ...asMember, body: JSON.stringify({ service: 'web', environment: 'production', value: secret }),
    });
    assert.equal(wrongRole.status, 403, wrongRole.text);

    const put = await app.call(`/api/v1/instances/${id}/secrets/APP_SECRET`, {
      method: 'PUT', ...app.asUser(), body: JSON.stringify({ service: 'web', environment: 'production', value: secret }),
    });
    assert.equal(put.status, 204, put.text);
    assert.equal(put.text, '', '204 must carry no body: an echo of a credential is the leak');

    const after = await app.call(`/api/v1/instances/${id}/secrets?environment=production&service=web`, { ...app.asUser() });
    assert.equal(after.status, 200, after.text);
    assert.deepEqual((after.body as { presence: { state: string }[] }).presence.map((p) => p.state), ['set']);
    assert.equal(JSON.stringify(after.body).includes(secret), false, 'the delivered value appeared in a read-back');
    assert.equal(JSON.stringify(put.body ?? '').includes(secret), false);

    const audit = await app.ctx.store.recentAudit(60);
    const row = audit.find((r) => r.action === 'secret.deliver');
    assert.ok(row, 'delivery was not audited');
    assert.equal(JSON.stringify(row!.detail).includes(secret), false, 'the audit trail is a leak surface like any other (D4)');
    assert.deepEqual(Object.keys(row!.detail ?? {}).sort(), ['environment', 'name', 'service']);
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

test('a member cannot deliver a credential, and an empty write is refused rather than treated as deletion', async () => {
  const github = stubGithub({ files: { 'compose.yaml': BUILD_ONLY } });
  const app = await start();
  try {
    const id = await forkInstance(app);
    const empty = await app.call(`/api/v1/instances/${id}/secrets/APP_SECRET`, {
      method: 'PUT', ...app.asUser(), body: JSON.stringify({ service: 'web', environment: 'production', value: '' }),
    });
    assert.equal(empty.status, 400, empty.text);
    assert.match((empty.body as { message: string }).message, /no delete verb/i, empty.text);

    const lower = await app.call(`/api/v1/instances/${id}/secrets/app_secret`, {
      method: 'PUT', ...app.asUser(), body: JSON.stringify({ service: 'web', environment: 'production', value: 'x' }),
    });
    assert.equal(lower.status, 400, 'a variable name is uppercase by convention and a lowercase one is a typo waiting to shadow');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});

/**
 * D52 and D53 meet here: the platform description decides WHERE a credential lives, and platfolio refuses to
 * decide otherwise. Four distinct refusals, each with a different fix, and one audit assertion.
 */
test('secret delivery is governed by the platform description, not by the caller', async () => {
  const github = stubGithub({ files: { 'compose.yaml': BUILD_ONLY } });
  const app = await start();
  try {
    const id = await forkInstance(app);
    const value = 'x'.repeat(24);
    const put = (name: string, body: Record<string, unknown>) => app.call(`/api/v1/instances/${id}/secrets/${name}`, {
      method: 'PUT', ...app.asUser(), body: JSON.stringify(body),
    });

    // (1) No registered plan. create-instance stores the instance and attaches NO plan, so platfolio genuinely
    // does not know where anything belongs -- and guessing is how a credential ends up in a variable no
    // deployment was told to read.
    const noPlan = await put('APP_SECRET', { service: 'web', environment: 'production', value });
    assert.equal(noPlan.status, 400, noPlan.text);
    assert.equal((noPlan.body as { error: string }).error, 'no-plan', noPlan.text);

    // Register and apply the plan, so the provider has a project to deliver into.
    await app.call(`/api/v1/instances/${id}/artifacts`, {
      method: 'POST', ...app.asUser(), body: JSON.stringify({ service: 'web', image: 'ghcr.io/acme/fork', digest: REAL_DIGEST }),
    });
    assert.equal((await app.call(`/api/v1/instances/${id}/plan/from-repository`, { method: 'POST', ...app.asUser(), body: '{}' })).status, 200);
    const registered = await app.ctx.store.getPlan(id);
    assert.ok(registered.ok, 'the plan is registered');
    const applied = await app.ctx.infra.applyPlan(registered.value.plan as Parameters<typeof app.ctx.infra.applyPlan>[0]);
    assert.equal(applied.verified, true, JSON.stringify(applied.failures));

    // (2) Declared by the composition as `source: shared-variable` -> accepted, and the scope travelled from the
    // description rather than from this request body, which never mentions scope at all.
    const declared = await put('APP_SECRET', { service: 'web', environment: 'production', value });
    assert.equal(declared.status, 204, declared.text);
    assert.equal(declared.text, '', '204 carries no body: an echo of a credential is the leak');

    // (3) A name the description never mentions. This is the one that matters most.
    const undeclared = await put('SOMETHING_UNDECLARED', { service: 'web', environment: 'production', value });
    assert.equal(undeclared.status, 400, undeclared.text);
    assert.equal((undeclared.body as { error: string }).error, 'secret-not-declared', undeclared.text);
    assert.match((undeclared.body as { message: string }).message, /platform description/i, 'the refusal names where to fix it');

    // (4) Right name, service that environment does not contain: the lookup is per (environment, service)
    // because both presence and delivery answer about the deployment that will read the value.
    const wrongService = await put('APP_SECRET', { service: 'nosuchservice', environment: 'production', value });
    assert.equal(wrongService.status, 400, wrongService.text);
    assert.equal((wrongService.body as { error: string }).error, 'secret-not-declared', wrongService.text);

    const seen = await app.call(`/api/v1/instances/${id}/secrets?environment=production&service=web`, { ...app.asUser() });
    assert.equal(seen.status, 200, seen.text);
    assert.deepEqual((seen.body as { presence: unknown }).presence, [{ name: 'APP_SECRET', state: 'set' }], 'presence agrees with delivery');
    assert.equal(JSON.stringify(seen.body).includes(value), false, 'the delivered value came back out');

    const audit = await app.ctx.store.recentAudit(60);
    const row = audit.find((r) => r.action === 'secret.deliver');
    assert.ok(row, 'the accepted delivery was audited');
    assert.deepEqual(Object.keys(row!.detail ?? {}).sort(), ['environment', 'name', 'service']);
    assert.equal(JSON.stringify(row!.detail).includes(value), false, 'the audit trail is a leak surface like any other (D4)');
  } finally {
    github.restore();
    await disposeKernel(app.ctx);
  }
});
