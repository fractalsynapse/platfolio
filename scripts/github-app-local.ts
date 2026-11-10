#!/usr/bin/env tsx
/**
 * Register platfolio's GitHub App on a laptop (issue #113, M2 step 1).
 *
 * Why this exists rather than a paragraph in the runbook: the manifest flow needs a *reachable* place to
 * send the one-time code, and GitHub's own docs use `http://localhost:<port>` for exactly that. So the whole
 * round trip -- form, redirect, exchange, credentials -- can complete on this machine with no tunnel, no
 * public host and no webhook. platfolio polls installations (v1 has no inbound webhook by design), which is
 * what makes a local registration a real setup rather than a toy.
 *
 * Two details people get wrong and this file exists to get right:
 * - the manifest must be **POSTed** to `github.com/settings/apps/new`; a GET link with `?manifest=` is not
 *   the documented flow, which is why the previously generated link did not behave;
 * - `hook_attributes` is omitted unless a real forwarder is supplied, because an app that registers with an
 *   unreachable webhook starts failing deliveries against the tenant's events immediately.
 *
 * Nothing here prints a credential. The private key, client secret and webhook secret go to a 0600 file
 * under `.secrets/`, which the credential-hygiene gate already refuses to track.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createAppJwt,
  exchangeManifestCode,
  localDevManifest,
  localManifestTarget,
  type LocalManifestOptions,
} from '../packages/contracts/src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const port = Number(flag('port', '8077'));
const org = flag('org');
const appName = flag('name', 'platfolio (local)') ?? 'platfolio (local)';
const secretsFile = resolve('.secrets/platfolio-app.json');
const state = randomBytes(24).toString('base64url');

/** smee.io is GitHub's documented forwarder for local app development; a channel is one POST away. */
async function smeeChannel(): Promise<string | undefined> {
  if (!has('smee')) return undefined;
  try {
    const response = await fetch('https://smee.io/new', { method: 'POST' });
    const url = response.headers.get('location');
    if (!url) throw new Error('no Location header');
    return url;
  } catch (error) {
    console.error(`  smee channel unavailable (${(error as Error).message}); registering without a webhook instead.`);
    return undefined;
  }
}

function formHtml(manifest: Record<string, unknown>, target: string): string {
  const encoded = JSON.stringify(manifest).replace(/</g, '\\u003c');
  // Auto-submitting POST: GitHub only accepts the manifest as a form body, and requiring a second click
  // here would just invite a copy-paste mistake.
  return `<!doctype html><meta charset=utf-8><title>Register platfolio</title>
<body style="font:14px/1.5 system-ui;max-width:60ch;margin:4rem auto">
<p>GitHub is about to receive platfolio's manifest. You will land on its app-creation form, where the only
thing left to choose is the app's name and who owns it.</p>
<form id=f action="${target}?state=${state}" method=post>
  <input type=hidden name=manifest value='${encoded}'>
  <button type=submit>Create the GitHub App</button>
</form>
<script>document.getElementById('f').submit()</script>
</body>`;
}

function writeSecrets(values: Record<string, unknown>): void {
  if (!existsSync('.secrets')) mkdirSync('.secrets', { mode: 0o700 });
  const previous = existsSync(secretsFile)
    ? JSON.parse(readFileSync(secretsFile, 'utf8')) as Record<string, unknown>
    : {};
  writeFileSync(secretsFile, `${JSON.stringify({ ...previous, ...values, registeredAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

async function pollInstallations(appId: number, privateKeyPem: string, slug: string): Promise<void> {
  const deadline = Date.now() + 15 * 60_000;
  console.log(`\n  Waiting for the installation. Open:\n    https://github.com/apps/${slug}/installations/new\n  and select this repository (or your org). Polling every 5s for 15 minutes.`);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const response = await fetch('https://api.github.com/app/installations', {
        headers: { authorization: `Bearer ${createAppJwt({ appId, privateKeyPem })}`, accept: 'application/vnd.github+json', 'user-agent': 'platfolio' },
      });
      if (!response.ok) { console.log(`  installations read failed (${String(response.status)}) -- retrying`); continue; }
      const list = await response.json() as { id: number; account: { login: string }; repositories_selection?: string }[];
      const found = list.find((i) => i.account?.login === (org ?? 'fractalsynapse')) ?? list[0];
      if (found) {
        writeSecrets({ installationId: found.id, account: found.account.login });
        console.log(`\n  Installed: installation ${String(found.id)} on ${found.account.login}`);
        console.log(`  Credentials in ${secretsFile} (0600, untracked). Next step: environments and the install PR.`);
        return;
      }
      process.stdout.write('.');
    } catch (error) {
      console.log(`  poll error: ${(error as Error).message}`);
    }
  }
  console.log('\n  No installation seen within 15 minutes. The app is registered; install it and re-run with --watch-only.');
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const webhookUrl = await smeeChannel();
  const manifestOptions: LocalManifestOptions = { port, name: appName, ...(org ? { org } : {}), ...(webhookUrl ? { webhookUrl } : {}) };
  const manifest = localDevManifest(manifestOptions);
  const target = localManifestTarget(org);

  if (has('check')) {
    console.log('  POST target :', target);
    console.log('  manifest    :', JSON.stringify(manifest, null, 2));
    console.log('  redirect    :', manifest.redirect_url);
    return;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(port)}`);
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(formHtml(manifest, target));
      return;
    }
    if (url.pathname === '/platfolio/callback') {
      const code = url.searchParams.get('code');
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('state mismatch: this callback did not start from this run');
        // Stay up: the operator can go back and click the form again, and tearing the listener down here
        // would turn a stale tab into a dead run. The state is only ever matched, never consumed.
        console.error('\n  Refused a callback with the wrong state. This run is still listening; reload the page and try again.');
        return;
      }
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('no code on the callback');
        // No code means the registration was cancelled or rejected on GitHub's side. Keeping the listener
        // alive matters most here: GitHub's form errors usually say what to fix, and the fix is a second
        // click, not a new run with a new state.
        console.error('\n  GitHub returned no code -- the form was cancelled or rejected. Still listening; submit again.');
        return;
      }
      void exchangeManifestCode(code)
        .then((creds) => {
          writeSecrets({ appId: creds.appId, slug: creds.slug, clientId: creds.clientId, clientSecret: creds.clientSecret, webhookSecret: creds.webhookSecret, privateKeyPem: creds.privateKeyPem });
          res.writeHead(200, { 'content-type': 'text/plain' }).end(`App registered as "${creds.slug}" (id ${String(creds.appId)}). Credentials saved. Install it now, then leave this window open.`);
          console.log(`\n  Registered: ${creds.slug} (app id ${String(creds.appId)}). No credential values printed.`);
          void pollInstallations(creds.appId, creds.privateKeyPem, creds.slug).then(() => server.close());
        })
        .catch((error: Error) => {
          res.writeHead(502, { 'content-type': 'text/plain' }).end(`Manifest exchange failed: ${error.message}`);
          console.error(`\n  Exchange failed: ${error.message}`);
          process.exitCode = 1;
          server.close();
        });
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(port, () => {
    console.log(`  Listening on http://localhost:${String(port)} -- open that URL to start registration.`);
    console.log('  The page POSTs the manifest to GitHub and GitHub redirects back here with a one-time code.');
  });
}

void main();
