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
/** Where the action lives inside platfolio's repository; the install workflow references it by path. */
export const ACTION_PATH = '.github/actions/platfolio-managed';
// No IaC file ships in the install PR. The desired state lives with platfolio and is fetched per run, so a
// constant naming `.railway/railway.ts` was a trap: the tenant-facing document referenced it while nothing
// emitted it. If a future design writes plans into tenant repos, it will need to add the file AND the code
// that produces it, not resurrect this path.

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
  /**
   * Where the provider's projects live. Not a secret, and not derivable from one: the first real dispatch
   * authenticated correctly and then asked Railway for projects(workspaceId: ""), which answers Not
   * Authorized -- a credential with no coordinate is indistinguishable from a bad credential. It belongs in
   * the workflow because it is part of this instance's provisioning, decided at connect.
   */
  workspaceId: string;
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

    // A missing variable fails HERE, naming itself, rather than inside the action as a fetch to an empty
    // URL. This is the step that makes the D47 choice usable by someone who has never read a design doc.
    '      - name: Check the platfolio control-plane endpoint is configured',
        '        env:',
          '          PLATFOLIO_URL: ${{ vars.PLATFOLIO_URL }}',
        '        run: |',
          '          if [ -z "$PLATFOLIO_URL" ]; then',
            '            echo "::error::repository variable PLATFOLIO_URL is unset -- set it to the platfolio control-plane origin given with your install request,"',
            '            echo "::error::for example https://api.example.com. See README.md, managed by platfolio."',
            '            exit 1',
            '          fi',
            '          echo "reporting to the platfolio control plane configured for this repository"',

    '',
    "      - name: Apply desired state with this repository's own credentials",
    '        id: apply',
    // Path-qualified: the action ships inside platfolio's own repository, so a bare `owner/repo@sha` would
    // look for an action.yml at the root that is not there.
    `        uses: ${opts.actionRepo}/${ACTION_PATH}@${opts.actionSha}`,
    // The provider credential comes from the repository environment's own secret. Without this block the
    // action had no way to reach the provider at all -- plan, identity and trigger were all present, and the
    // one thing needed to act was missing. Names in the manifest, never values: GitHub resolves the secret
    // into the step process and platfolio never sees it.
    '        env:',
    '          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}',
    '          PLATFOLIO_DISPATCH_TOKEN: ${{ secrets.PLATFOLIO_DISPATCH_TOKEN }}',
    // Plain text, deliberately: the workspace id is configuration a tenant should see and be able to change
    // without touching any credential.
    `          RAILWAY_WORKSPACE_ID: ${opts.workspaceId}`,
    '        with:',
    `          action: ${EXPR.action}`,
    `          environment: ${EXPR.environment}`,
    `          instance_id: ${EXPR.instance}`,
    `          dispatch_id: ${EXPR.dispatch}`,
    `          nonce: ${EXPR.nonce}`,
    `          plan_hash: ${EXPR.planHash}`,
    // D47: the control-plane origin is NOT written into the file every fork commits. It is a repository
    // variable the owner sets once -- which is also what keeps a template usable by a stranger: a workflow
    // that names someone else's deployment is a template nobody else can install.
    '          platfolio_url: ${{ vars.PLATFOLIO_URL }}',
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
    // Instruction, not declaration. The origin platfolio was reached at belongs in the install PR's body,
    // which is ephemeral; putting it in a committed README is the same D47 mistake wearing prose.
    '## Before the first run',
    '',
    'Set one repository variable: **`PLATFOLIO_URL`**, the platfolio control-plane origin you were given with',
    'this install request (Settings → Secrets and variables → Actions → Variables). The workflow says that',
    'name in its failure message if it is missing, and nothing committed here names a deployment.',
    '',
    `# ${m.metadata.title} — managed by platfolio`,
    '',
    `Platform \`${m.metadata.name}\` \`${m.metadata.version}\` (\`${m.metadata.archetype}\`).`,
    '',
    '## What runs here',
    '',
    `- \`${WORKFLOW_PATH}\` applies the desired state platfolio holds, using **this repository's** credentials. platfolio`,
    '  dispatches it and verifies the result; it never writes to your infrastructure itself.',
    '  The plan is fetched per run and checked against a hash before anything is applied, so this',
    '  repository holds the trigger and the identity rather than a second copy of the desired state.',
    '- The provider credential is a per-environment project token stored as a GitHub environment',
    '  secret. platfolio stores no infrastructure credential of any kind.',
    '- Ordinary `git push` deploys still work, including when platfolio is offline.',
    '',
    '## Secrets you must set',
    '',
      // The provider token is listed because the workflow resolves it. Instructions that cover the
      // platform's own secrets while omitting the one credential the apply step runs on are how an
      // install looks complete and then fails on the first dispatch.
      '- `RAILWAY_TOKEN` — workflow-level, resolved from your environment secret by the managed step',
      '- `PLATFOLIO_DISPATCH_TOKEN` — how the runner proves it is talking to *its* control plane. The OIDC job',
      '  token travels alongside it as identity evidence and is **not yet verified**, so today this secret is',
      '  what authenticates; `/api/v1/attestations/capabilities` states the gap in those words.',
      ...(secretLines.length ? secretLines : ['_No additional platform secrets declared._']),
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
    '3. platfolio removes its own management records. **Your repository is never deleted** — keep it,',
    '   archive it, or delete it yourself; platfolio does not have that capability and will not ask for it.',
    '4. Nothing else changes. Ordinary pushes keep deploying, and every file here remains yours.',
    '',
  ].join('\n');

  return {
    files: { [WORKFLOW_PATH]: `${L.join('\n')}\n`, 'PLATFOLIO.md': doc },
    secrets: requiredSecrets(m),
    permissions: { ...WORKFLOW_PERMISSIONS },
    actionPin: { name: opts.actionRepo, ref: opts.actionSha },
  };
}
