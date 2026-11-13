import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { GitScm, ForgeOperationUnsupportedError } from '../src/git-scm.ts';
import { RepositoryReadError, type RepositoryReadFailure } from '../src/scm-github.ts';
import { blobSha } from '../src/memory-scm.ts';
import { FIXTURE_BLOB_SHA, FIXTURE_FILE, runScmConformance, type ScmUnderTests } from '../src/scm-conformance.ts';

/**
 * The `git` driver: same seam, different transport, and the check that two drivers mean the same thing.
 *
 * Runs against a local repository (no network, no credentials), because a driver test that reaches the internet
 * is a flaky integration test wearing a unit test's name. The live GitHub case exists too, at the bottom, and
 * is skipped unless someone asks for it -- a skip that states itself, rather than a silent absence.
 */

function localRepository(): { url: string; sha: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'platfolio-git-fixture-'));
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 'fixture@platfolio.test']);
  run(['config', 'user.name', 'platfolio fixture']);
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'compose.yaml'), FIXTURE_FILE.content);
  writeFileSync(join(dir, 'nested', 'inner.yaml'), 'nested: true\n');
  writeFileSync(join(dir, FIXTURE_FILE.largePath), FIXTURE_FILE.largeContent);
  run(['add', '-A']);
  run(['commit', '-qm', 'the fixture platform']);
  return { url: `file://${dir}`, sha: run(['rev-parse', 'HEAD']).trim(), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function kindOf(error: unknown): RepositoryReadFailure | null {
  if (error instanceof RepositoryReadError) return error.failure;
  return null;
}

function gitAdapter(repo: { url: string; sha: string }): ScmUnderTests {
  const scm = new GitScm({});
  // The suite names a repo as `acme/widget`; this driver reads remotes, so the adapter maps the fixture name
  // to the local repository and lets every other value through untouched -- which is what makes the
  // malformed-repo assertions real checks rather than a pass.
  const read = (input: { repo: string; ref: string; path: string }) =>
    scm.readRepositoryFile({ repo: input.repo === FIXTURE_FILE.repo ? repo.url : input.repo, ref: input.ref, path: input.path });
  return {
    label: 'git',
    // git has no inline size cutoff, and -- the property that made this driver worth adding -- it CAN tell an
    // unresolvable ref from a missing path, because they fail in different commands.
    capabilities: { workflowDispatch: false, inlineSizeLimit: false, refVersusPath: true },
    read,
    async readFailure(scenario) {
      try {
        switch (scenario) {
          case 'missing-path':
            return await read({ repo: FIXTURE_FILE.repo, ref: FIXTURE_FILE.ref, path: 'not-committed.yaml' }) && null;
          case 'repository-not-in-selection':
            return await read({ repo: 'file:///nonexistent/fixture-repo', ref: FIXTURE_FILE.ref, path: FIXTURE_FILE.path }) && null;
          case 'unknown-ref':
            return await read({ repo: FIXTURE_FILE.repo, ref: `${FIXTURE_FILE.ref}-does-not-exist`, path: FIXTURE_FILE.path }) && null;
          case 'directory-not-file':
            return await read({ repo: FIXTURE_FILE.repo, ref: FIXTURE_FILE.ref, path: 'nested' }) && null;
          case 'oversized-file':
            // Declared as a driver without a cutoff, so the suite never asks for this refusal. Asking anyway
            // would be testing a fiction, so the adapter says so instead of inventing an error.
            throw new Error('the git driver has no inline size limit; the suite must not request too-large from it');
          default:
            throw new Error(`unmodelled scenario ${scenario}`);
        }
      } catch (error) {
        const failure = kindOf(error);
        if (failure) return failure;
        throw error;
      }
    },
    async dispatch(input) {
      try {
        return await scm.dispatchWorkflow({ appId: 0, privateKeyPem: '', installationId: 0, repo: input.repo, workflow: input.workflow, ref: input.ref, inputs: input.inputs });
      } catch {
        // The driver refuses; the caller's contract is that a refusal is not a success.
        return { kind: 'forge-operation-unsupported' };
      }
    },
  };
}

// Built lazily and torn down by `after`, NOT by a try/finally at module scope: an earlier draft did the
// latter, and node:test registers these bodies to run later -- so the fixture repository had been deleted
// before a single test executed, and every git read reported an unreachable remote. A test that fails for a
// reason unrelated to the code under test is still a signal, if you read the message; this one did say so.
let repo: { url: string; sha: string; cleanup(): void } | undefined;
const fixture = () => {
  repo ??= localRepository();
  return repo;
};
after(() => {
  repo?.cleanup();
  repo = undefined;
});

{
  test('the git driver satisfies the same conformance suite as the GitHub driver', async () => {
    const results = await runScmConformance(gitAdapter(fixture()));
    const failed = results.filter((r) => r.includes('FAIL'));
    assert.deepEqual(failed, [], `${String(failed.length)} failure(s):\n${failed.join('\n')}`);
    assert.ok(results.some((r) => r.includes('a transport that CAN tell a bad ref from a missing path does so')), `the capability-specific assertion did not run: ${results.join(' | ')}`);
    assert.ok(results.some((r) => r.includes('returns the whole file')), 'the no-cutoff branch must assert the bytes, not skip');
  });

  test('git computes the blob identity that GitHub quotes -- one fact, two drivers', async () => {
    const viaGit = await new GitScm({}).readRepositoryFile({ repo: fixture().url, ref: FIXTURE_FILE.ref, path: FIXTURE_FILE.path });
    assert.equal(viaGit.sha, FIXTURE_BLOB_SHA, 'git\'s rev-parse and GitHub Contents API must report the same blob id for the same bytes');
    assert.equal(viaGit.sha, blobSha(viaGit.content), 'and the identity must be reproducible from the content alone');
    assert.equal(viaGit.content, FIXTURE_FILE.content, 'byte-identical, including line endings');
  });

  test('a pinned commit and a branch resolve to the same content, and an unknown ref is refused at fetch time', async () => {
    const bySha = await new GitScm({}).readRepositoryFile({ repo: fixture().url, ref: fixture().sha, path: FIXTURE_FILE.path });
    const byBranch = await new GitScm({}).readRepositoryFile({ repo: fixture().url, ref: 'main', path: FIXTURE_FILE.path });
    assert.equal(bySha.content, byBranch.content);
    await assert.rejects(
      () => new GitScm({}).readRepositoryFile({ repo: fixture().url, ref: 'main-that-does-not-exist', path: FIXTURE_FILE.path }),
      (error: unknown) => error instanceof RepositoryReadError && error.failure.kind === 'ref-not-found',
      'a bad ref must be ref-not-found, which is the distinction the Contents API cannot make',
    );
  });

  test('dispatch through git refuses in its own words rather than returning success', async () => {
    await assert.rejects(
      () => new GitScm({}).dispatchWorkflow({ appId: 0, privateKeyPem: '', installationId: 0, repo: 'a/b', workflow: 'platfolio-managed.yml', ref: 'main', inputs: {} }),
      (error: unknown) => error instanceof ForgeOperationUnsupportedError && /not a git operation/.test(error.message),
    );
  });

  test('a token is never echoed back in an error message', async () => {
    // `github.invalid` is reserved by RFC 2606 and cannot resolve, so this exercises the credential-bearing URL
    // without reaching a real forge -- and it does not squat the publishing org with a made-up repository,
    // which is exactly what my own D49 gate caught this file doing on the first CI run. A gate that fires on
    // the change that introduced it is a gate that works.
    const scm = new GitScm({ token: 'ghp_Sup3rS3cretTokenValue', host: 'github.invalid' });
    try {
      await scm.readRepositoryFile({ repo: 'acme/does-not-exist', ref: 'main', path: 'compose.yaml' });
      assert.fail('expected a read failure');
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(!message.includes('Sup3rS3cretTokenValue'), `the token appeared in an error: ${message.slice(0, 200)}`);
      assert.match(message, /credential-redacted|token was supplied|does not exist/, message.slice(0, 200));
    }
  });
}

// The live case. Kept in the suite and explicitly skipped, because "we ran this against a real forge once" is
// evidence that belongs next to the code rather than in a commit message nobody reads.
test('the git driver reads a real GitHub repository over HTTPS', { skip: process.env.PLATFOLIO_LIVE_GIT === '1' ? false : 'set PLATFOLIO_LIVE_GIT=1 (and PLATFOLIO_GIT_TOKEN) to exercise the live forge' }, async () => {
  const scm = new GitScm(process.env.PLATFOLIO_GIT_TOKEN === undefined ? {} : { token: process.env.PLATFOLIO_GIT_TOKEN });
  const file = await scm.readRepositoryFile({ repo: 'fractalsynapse/platfolio', ref: 'staging', path: 'apps/control-plane/openapi.yaml' });
  assert.match(file.content.slice(0, 200), /^openapi:/, file.content.slice(0, 80));
  assert.equal(file.sha, blobSha(file.content), 'the live forge and git\'s own computation must agree');
});
