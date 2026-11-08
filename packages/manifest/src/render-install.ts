import type { Manifest } from './schema.ts';
import { requiredSecrets } from './validate.ts';

export interface InstallFiles {
  /** Path relative to the tenant repository root -> content. */
  files: Record<string, string>;
  /** Names the tenant must populate themselves. Never values. */
  secrets: { service: string; name: string; source: string }[];
  /** Exactly the permissions the generated workflow asks for. */
  permissions: Record<string, string>;
  /** Pinned by commit SHA at install time; a tag alone is not a trust anchor. */
  actionPin: { name: string; ref: string };
}

export const WORKFLOW_PATH = '.github/workflows/platfolio-managed.yml';
export const IAC_PATH = '.railway/railway.ts';

/** Least privilege for the managed workflow. Anything broader is a regression, and a test says so. */
export const WORKFLOW_PERMISSIONS: Record<string, string> = {
  contents: 'read',
  'id-token': 'write',
  statuses: 'write',
  checks: 'write',
};

// GitHub expressions live in ordinary strings: a template literal would try to interpolate them.
const EXPR = {
  dispatchOrRef: "platfolio-${{ inputs.dispatch_id || github.run_id }}",
  action: "${{ inputs.action || 'deploy' }}",
  environment: '${{ inputs.environment }}',
  instance: '${{ inputs.instance_id }}',
  dispatch: '${{ inputs.dispatch_id }}',
  nonce: '${{ inputs.nonce }}',
  planHash: '${{ inputs.plan_hash }}',
  actionOut: '${{ steps.apply.outcome }}',
};

const sorted = <T>(items: T[], key: (t: T) => string): T[] => [...items].sort((a, b) => key(a).localeCompare(key(b)));

export interface InstallOptions {
  actionRepo: string;
  /** Commit SHA, not a tag: pinning by tag lets a later force-push change what runs. */
  actionSha: string;
  platfolioUrl: string;
}

/**
 * The files platfolio opens one reviewable pull request with (docs/design/04 § Install flow).
 *
 * Constraints encoded here, each covered by a test in packages/manifest/test/install.test.ts:
 *  - one PR a human merges; afterwards platfolio only dispatches and never writes to the repo;
 *  - the minimal `permissions:` block, nothing more;
 *  - production runs go through a GitHub environment, so required reviewers gate infrastructure writes;
 *  - no secret values anywhere, only the names the tenant must fill in;
 *  - the external action is pinned by commit SHA;
 *  - deleting the file stops platfolio while the stack keeps deploying from the tenant's pushes;
 *  - no empty `${{ }}` placeholder: one invalidated the whole workflow file in our own CI (#9).
 */
export function renderInstallPullRequest(m: Manifest, opts: InstallOptions): InstallFiles {
  const envs = m.spec.environments.staging.enabled ? ['production', 'staging'] : ['production'];
  const runner = m.metadata.architectures.includes('arm64') && m.metadata.architectures.length === 1 ? 'ubicloud-arm' : 'ubuntu-latest';
  const services = sorted(Object.keys(m.spec.services), (s) => s);

  const L: string[] = [
    '# Managed by platfolio. Review before merging.',
    '# Deleting this file stops platfolio managing the stack; ordinary deploys keep working,',
    '# because the push triggers below are the same ones your own workflow used.',
    'name: platfolio managed',
    '',
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      instance_id: { required: true, type: string }',
    '      dispatch_id: { required: true, type: string }',
    '      nonce: { required: true, type: string, description: "single-use, echoed back in the attestation" }',
    '      plan_hash: { required: true, type: string }',
    '      action: { required: true, type: choice, options: [apply, check, drift, suspend, export] }',
    `      environment: { required: true, type: choice, options: [${envs.join(', ')}] }`,
    '  push:',
    '    branches:',
    ...envs.map((e) => `      - ${e}`),
    '',
    'permissions:',
    ...Object.entries(WORKFLOW_PERMISSIONS).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k}: ${v}`),
    '',
    'concurrency:',
    `  group: ${EXPR.dispatchOrRef}`,
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  managed:',
    `    name: platfolio ${EXPR.action}`,
    `    runs-on: ${runner}`,
    '    timeout-minutes: 30',
    '    environment:',
    `      name: ${EXPR.environment}`,
    '    steps:',
    '      - uses: actions/checkout@v7',
    '',
    "      - name: Apply desired state with this repository's own credentials",
    `        uses: ${opts.actionRepo}@${opts.actionSha}`,
    '        with:',
    `          action: ${EXPR.action}`,
    `          environment: ${EXPR.environment}`,
    `          instance_id: ${EXPR.instance}`,
    `          dispatch_id: ${EXPR.dispatch}`,
    `          nonce: ${EXPR.nonce}`,
    `          plan_hash: ${EXPR.planHash}`,
    `          platfolio_url: ${opts.platfolioUrl}`,
    '',
    '      - name: Report the outcome for platfolio to verify by read-back',
    '        if: always()',
    `        run: echo "outcome=${EXPR.actionOut}"`,
    '        # The runner posts a signed attestation to platfolio from the action above; the control',
    '        # plane treats it as a claim and re-verifies against the provider before advancing.',
    '',
  ];

  const secretLines = requiredSecrets(m).map((s) => `- \`${s.name}\` (service \`${s.service}\`; resolved by \`${s.source}\`)`);
  const doc = [
    `# ${m.metadata.title} — managed by platfolio`,
    '',
    `Platform \`${m.metadata.name}\` \`${m.metadata.version}\` (\`${m.metadata.archetype}\`).`,
    '',
    '## What runs here',
    '',
    `- \`${WORKFLOW_PATH}\` applies \`${IAC_PATH}\` using **this repository's** credentials. platfolio`,
    '  dispatches it and verifies the result; it never writes to your infrastructure itself.',
    '- The provider credential is a per-environment project token stored as a GitHub environment',
    '  secret. platfolio stores no infrastructure credential of any kind.',
    '- Ordinary `git push` deploys still work, including when platfolio is offline.',
    '',
    '## Secrets you must set',
    '',
    secretLines.length ? secretLines.join('\n') : '_None declared by this platform._',
    '',
    'No secret value crosses platfolio. Set these in your own provider project or as environment',
    'secrets here; platfolio learns they are filled only from a healthy deployment.',
    '',
    '## Services',
    '',
    services.map((s) => `- \`${s}\``).join('\n'),
    '',
    '## Removing platfolio',
    '',
    `1. Delete \`${WORKFLOW_PATH}\`.`,
    '2. Revoke the platfolio GitHub App installation.',
    '3. Nothing else changes. The stack keeps deploying from your pushes and the desired-state file',
    '   remains yours.',
    '',
  ].join('\n');

  return {
    files: { [WORKFLOW_PATH]: `${L.join('\n')}\n`, 'PLATFOLIO.md': doc },
    secrets: requiredSecrets(m),
    permissions: { ...WORKFLOW_PERMISSIONS },
    actionPin: { name: opts.actionRepo, ref: opts.actionSha },
  };
}
