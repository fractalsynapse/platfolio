/**
 * Regenerate (or check) the pinned image in selfhost/compose.prod.yaml from the registry (#146, D29).
 *
 * The overlay is the one file in the repository whose correct content is a fact about a build server. Every
 * other pin here is authored; this one has to be *looked up*, which is why it drifted twice: a hand-typed
 * digest went stale when the service was renamed, and the file kept passing every check while pointing at
 * bytes no longer connected to any source we ship.
 *
 * `--check` is the gate: it asks the registry what `:staging` actually is and fails when the file disagrees.
 * CI does not auto-commit the fix -- a bot pushing to staging would trigger the pipeline that pushes it, and
 * an unreviewed write to an integration branch is a worse trade than one command at release time.
 */
import fs from 'node:fs';
import path from 'node:path';

const IMAGE = 'fractalsynapse/platfolio-control-plane';
const file = path.resolve(import.meta.dirname, '../selfhost/compose.prod.yaml');

async function registryDigest(tag: string): Promise<string> {
  const auth = await fetch(`https://ghcr.io/token?scope=repository:${IMAGE}:pull`).then((r) => r.json()) as { token?: string };
  if (typeof auth.token !== 'string') throw new Error('could not obtain an anonymous pull token from ghcr.io');
  const response = await fetch(`https://ghcr.io/v2/${IMAGE}/manifests/${encodeURIComponent(tag)}`, {
    method: 'HEAD',
    headers: {
      authorization: `Bearer ${auth.token}`,
      accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
    },
  });
  if (!response.ok) throw new Error(`registry answered ${String(response.status)} for ${IMAGE}:${tag}`);
  const digest = response.headers.get('docker-content-digest');
  if (digest === null || !/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`no usable digest header for ${IMAGE}:${tag}`);
  return digest;
}

function currentPin(text: string): { tag: string; digest: string } | null {
  const line = text.split('\n').find((l) => l.includes('image: ghcr.io/'));
  if (line === undefined) return null;
  const match = /image: ghcr\.io\/[^\s]+:(\S+)@(sha256:[0-9a-f]{64})/.exec(line);
  return match === null ? null : { tag: match[1] ?? '', digest: match[2] ?? '' };
}

const mode = process.argv.includes('--check') ? 'check' : 'write';
const tag = process.env.PLATFOLIO_IMAGE_TAG ?? 'staging';
const actual = registryDigest ? await registryDigest(tag) : '';
const before = fs.readFileSync(file, 'utf8');
const pinned = currentPin(before);

if (pinned === null) {
  console.error(`  ${file} has no pinned image line at all -- the file must name tag@digest, and a service with`);
  console.error('  no pin cannot be planned (buildPlan refuses placeholders, #84), so this is not a formatting nit.');
  process.exit(1);
}

console.log(`  file says  ${IMAGE}:${pinned.tag}@${pinned.digest.slice(0, 22)}…`);
console.log(`  registry   ${IMAGE}:${tag}@${actual.slice(0, 22)}…  (read from the docker-content-digest header)`);

if (mode === 'check') {
  if (pinned.tag !== tag || pinned.digest !== actual) {
    console.error(`\n  DRIFT: the overlay pins bytes the registry is not serving for :${tag}.`);
    console.error(`  Run: npx -y tsx scripts/render-selfhost-overlay.ts   (then commit the change with the release)`);
    process.exit(1);
  }
  console.log('  overlay matches the registry');
  process.exit(0);
}

const after = before.replace(
  /(image: ghcr\.io\/[^\s]+:)\S+(@sha256:[0-9a-f]{64})/,
  (_m, prefix: string) => `${prefix}${tag}@${actual}`,
);
if (after === before) {
  console.log('  already current, nothing written');
  process.exit(0);
}
fs.writeFileSync(file + '.tmp', after, 'utf8');
fs.renameSync(file + '.tmp', file);
console.log(`  rewrote ${path.relative(process.cwd(), file)} -> :${tag}@${actual.slice(0, 22)}…`);
console.log('  commit this with the release; it is a version decision, not a formatting change (D29).');
