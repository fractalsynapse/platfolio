import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_APP_PERMISSIONS, GithubAppProvider, GithubPatProvider, type ScmProvider } from '../src/index.ts';

const app = new GithubAppProvider();
const CONFIG = {
  name: 'platfolio (dev)',
  url: 'https://platfolio.example',
  callbackUrl: 'https://platfolio.example/api/scm/github/registration-callback',
  description: 'Managed hosting control plane',
};

test('the manifest asks for exactly the permissions the design names', () => {
  const manifest = app.appManifest!(CONFIG) as { permissions: Record<string, string>; events: unknown[] };
  assert.deepEqual(manifest.permissions, { ...DEFAULT_APP_PERMISSIONS });
  assert.deepEqual(manifest.events, [], 'v1 registers no webhook events');
  assert.equal((manifest as Record<string, unknown>)['webhook_active'], false);
});

test('a permission widening is a visible diff, not a silent one', () => {
  const wider = app.appManifest!({ ...CONFIG, permissions: { ...DEFAULT_APP_PERMISSIONS, administration: 'write' } }) as { permissions: Record<string, string> };
  assert.equal(wider.permissions.administration, 'write');
  assert.ok(!('administration' in DEFAULT_APP_PERMISSIONS), 'administration must not be in the default set');
});

test('the registration URL is a manifest flow with an unguessable state', () => {
  const state = 'aB3-.x9_qZ7kLm21';
  const url = app.registrationUrl!(CONFIG, state);
  assert.match(url, /^https:\/\/github\.com\/settings\/apps\/new\?manifest=[A-Za-z0-9_-]+&socket=aB3-\.x9_qZ7kLm21$/);
  const encoded = new URL(url).searchParams.get('manifest')!;
  const round = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { name: string; permissions: unknown };
  assert.equal(round.name, 'platfolio (dev)');
  assert.deepEqual(round.permissions, { ...DEFAULT_APP_PERMISSIONS });
});

test('a short or guessable state is refused', () => {
  assert.throws(() => app.registrationUrl!(CONFIG, 'short'), /unguessable/);
});

test('the callback code is only accepted when the state matches', () => {
  const state = 'longenoughstatetoken1';
  assert.deepEqual(app.consumeRegistrationCallback!({ code: 'abc123', socket: state }, state), { code: 'abc123' });
  assert.throws(() => app.consumeRegistrationCallback!({ code: 'abc123', socket: 'otherlongenoughtoken' }, state), /does not match/);
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
