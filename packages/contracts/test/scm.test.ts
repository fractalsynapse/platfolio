import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_APP_PERMISSIONS,
  GithubAppProvider,
  GithubPatProvider,
  MANIFEST_KEYS,
  buildAppManifest,
  localDevManifest,
  type ScmProvider,
} from '../src/index.ts';

const app = new GithubAppProvider();
const CONFIG = {
  name: 'platfolio (dev)',
  url: 'https://platfolio.example',
  callbackUrl: 'https://platfolio.example/api/scm/github/registration-callback',
  description: 'Managed hosting control plane',
};

test('the manifest asks for exactly the permissions the design names', () => {
  const manifest = app.appManifest!(CONFIG) as unknown as { default_permissions?: Record<string, string>; default_events?: unknown[] };
  assert.deepEqual(manifest.default_permissions, { ...DEFAULT_APP_PERMISSIONS }, 'the documented object, not a string');
  assert.deepEqual(manifest.default_events, [], 'v1 registers no webhook events');
  assert.equal((manifest as Record<string, unknown>)['hook_attributes'], undefined, 'no webhook is registered when nothing can answer it');
});

test('a webhook is registered only when given a URL that can receive it', () => {
  const withHook = app.appManifest!({ ...CONFIG, webhookUrl: 'https://smee.io/abc' }) as unknown as { hook_attributes?: { url: string; active: boolean } };
  assert.deepEqual(withHook.hook_attributes, { url: 'https://smee.io/abc', active: false });
});

test('a permission widening is a visible diff, not a silent one', () => {
  const wider = app.appManifest!({ ...CONFIG, permissions: { ...DEFAULT_APP_PERMISSIONS, administration: 'write' } }) as unknown as { default_permissions?: Record<string, string> };
  assert.equal(wider.default_permissions?.administration, 'write');
  assert.ok(!('administration' in DEFAULT_APP_PERMISSIONS), 'administration must not be in the default set');
});

test('the registration URL is the POST target, with no manifest encoded into a GET', () => {
  const state = 'aB3-.x9_qZ7kLm21';
  const url = app.registrationUrl!(CONFIG, state);
  // The manifest is a POST form field. Asserting its absence is the only way this test can tell the
  // documented flow apart from the invented one that GitHub rejected with "not a valid manifest".
  assert.equal(url, 'https://github.com/settings/apps/new?state=aB3-.x9_qZ7kLm21');
  assert.ok(!url.includes('manifest='), 'no manifest in a GET link');
  assert.equal(
    app.registrationUrl!({ ...CONFIG, org: 'acme' }, state),
    'https://github.com/organizations/acme/settings/apps/new?state=aB3-.x9_qZ7kLm21',
  );
});

test('a short or guessable state is refused', () => {
  assert.throws(() => app.registrationUrl!(CONFIG, 'short'), /unguessable/);
});

test('the callback code is only accepted when the state matches', () => {
  const state = 'longenoughstatetoken1';
  assert.deepEqual(app.consumeRegistrationCallback!({ code: 'abc123', state }, state), { code: 'abc123' });
  assert.throws(() => app.consumeRegistrationCallback!({ code: 'abc123', state: 'otherlongenoughtoken' }, state), /does not match/);
  // State is verified before the code is even looked at, so a forged callback reports the mismatch.
  assert.throws(() => app.consumeRegistrationCallback!({}, state), /does not match/);
  assert.throws(() => app.consumeRegistrationCallback!({ socket: state }, state), /no one-time code/);
});

test('the install link is the whole per-tenant cost', () => {
  assert.equal(app.installUrl!('platfolio-hosting'), 'https://github.com/apps/platfolio-hosting/installations/new');
  assert.throws(() => app.installUrl!('not a slug'), /invalid app slug/);
});

test('operations that need a real installation say so instead of pretending', async () => {
  const info = app.describe();
  assert.ok(!info.operations.includes('listInstallations'), 'must not advertise what it cannot do');
  await assert.rejects(() => app.listInstallations!(), /requires app credentials/);
  for (const missing of ['openInstallPullRequest', 'dispatchWorkflow', 'putEnvironmentSecret', 'ensureEnvironment'] as const) {
    assert.ok(!(missing in app) || !(app as unknown as Record<string, unknown>)[missing], `${missing} must be absent, not a stub`);
  }
});

test('both scm implementations satisfy one interface contract', () => {
  const providers: ScmProvider[] = [app, new GithubPatProvider()];
  for (const p of providers) {
    const d = p.describe();
    assert.match(d.contract, /^\d+\.\d+\.\d+$/);
    assert.ok(Array.isArray(d.operations) && d.operations.length > 0);
    assert.ok(d.kind === 'github-app' || d.kind === 'github-pat');
  }
  assert.notDeepEqual(app.describe().operations, new GithubPatProvider().describe().operations, 'the modes must differ visibly');
});

test('a manifest carrying an undocumented key is refused locally, naming every offender', () => {
  // GitHub's own page reports only the FIRST bad key, so the schema has to enumerate them.
  assert.throws(
    () => buildAppManifest({ url: 'https://x.test', single_file_permissions: false, request_verification: false, webhook_active: false }),
    /invalid GitHub App manifest/,
  );
  try {
    buildAppManifest({ url: 'https://x.test', single_file_permissions: false, webhook_active: false });
    assert.fail('should have thrown');
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /single_file_permissions/);
    assert.match(message, /webhook_active/);
    assert.match(message, /Permitted keys:/, 'the error states the allowed set, since the docs page does not');
  }
});

test('every key we emit is one GitHub documents', () => {
  const emitted = [
    ...Object.keys(app.appManifest!(CONFIG) as Record<string, unknown>),
    ...Object.keys(localDevManifest({ port: 8077 }) as Record<string, unknown>),
    ...Object.keys(localDevManifest({ port: 8077, webhookUrl: 'https://smee.io/abc' }) as Record<string, unknown>),
  ];
  for (const key of new Set(emitted)) {
    assert.ok((MANIFEST_KEYS as readonly string[]).includes(key), `${key} is not a permitted manifest key`);
  }
});

test('default_permissions is an object of access levels', () => {
  // The historical bug was this field being the string 'read', plus a separate undocumented `permissions`.
  assert.throws(() => buildAppManifest({ url: 'https://x.test', default_permissions: 'read' }), /default_permissions/);
  assert.throws(() => buildAppManifest({ url: 'https://x.test', default_permissions: { contents: 'rw' } }), /default_permissions/);
});

test('callback_urls without redirect_url is refused, because the code would land nowhere', () => {
  assert.throws(() => buildAppManifest({ url: 'https://x.test', callback_urls: ['https://x.test/cb'] }), /nowhere to land/);
});

test('the local manifest keeps every URL on localhost and omits webhooks by default', () => {
  const m = localDevManifest({ port: 8077 }) as unknown as { url: string; hook_attributes?: unknown; default_events: unknown[] };
  assert.equal(m.url, 'http://localhost:8077');
  assert.equal('hook_attributes' in m, false);
  assert.deepEqual(m.default_events, []);
});

test('the PAT seam advertises fewer operations and says so', () => {
  const pat: ScmProvider = new GithubPatProvider();
  assert.deepEqual(pat.describe().operations, ['installUrl']);
  assert.throws(() => pat.installUrl!('platfolio-hosting'), /personal token has no app to install/);
});
