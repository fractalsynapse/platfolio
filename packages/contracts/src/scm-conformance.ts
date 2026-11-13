import assert from 'node:assert/strict';

/**
 * The source-control conformance suite (seam rule 3).
 *
 * One list of properties, run against the GitHub implementation (with a recording transport, so no network)
 * and against `MemoryScm`. The point is not coverage for its own sake: it is that a contract satisfied only by
 * the thing that wrote it is not yet a contract, and that the double cannot drift into certifying whatever the
 * real call happens to do.
 *
 * Each check names the behaviour it pins, and none of them accepts a silent skip: a capability an
 * implementation does not provide must fail the suite loudly, the way `railway-provider` refuses to map
 * `SUCCESS` onto a health claim it cannot support.
 */
/**
 * What a transport is actually able to distinguish. Declared, not inferred, because the suite must be able to
 * tell "this driver cannot do that" from "this driver did not do it", and the difference is the entire content
 * of two of the checks below.
 */
export interface ScmCapabilities {
  /**
   * Can this transport ask a forge to run a pipeline at all? git cannot: a workflow run is not a git concept.
   *
   * This field exists because the suite was wrong before it was declared. Written against the GitHub driver
   * only, it asserted "dispatch succeeds" and "the refusal names the default branch" for every implementation
   * -- so the git driver failed three checks for failing to do something no git transport can do. That is a
   * provider-shaped contract, which is precisely what a second implementation is supposed to expose. The suite
   * now asks a driver WITHOUT this capability to refuse, in words that say what is missing, and to never report
   * success.
   */
  workflowDispatch: boolean;
  /** GitHub omits `content` past 1 MiB; git has no such cutoff and returns the bytes. */
  inlineSizeLimit: boolean;
  /** git says "couldn't find remote ref" for a bad ref and fails on the path separately; the Contents API answers the same 404 for both. */
  refVersusPath: boolean;
}

export interface ScmUnderTests {
  label: string;
  capabilities: ScmCapabilities;
  /** Read one file. Mirrors both signatures: the GitHub call also takes credentials, which the suite supplies. */
  read(input: { repo: string; ref: string; path: string }): Promise<{ content: string; sha: string; size: number; path: string }>;
  /** The failure the implementation surfaced, or `null` if it wrongly succeeded. */
  readFailure?(scenario: string): Promise<{ kind: string; detail: string } | null>;
  dispatch(input: { repo: string; workflow: string; ref: string; inputs: Record<string, string> }): Promise<{ kind: string; detail?: string; status?: number }>;
}

const REPO = 'acme/widget';
const FILE_PATH = 'compose.yaml';
const CONTENT = 'services:\n  web:\n    image: nginx:alpine\n';

export async function runScmConformance(scm: ScmUnderTests): Promise<string[]> {
  const results: string[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    results.push(`${scm.label}: ${name} -- ${ok ? 'PASS' : `FAIL (${detail})`}`);
  };

  // 1. a committed file comes back byte-identical. Anything else (line endings, base64 whitespace, encoding)
  //    would be a plan built from a document the tenant never wrote.
  try {
    const file = await scm.read({ repo: REPO, ref: 'main', path: FILE_PATH });
    check('reads a file verbatim', file.content === CONTENT, JSON.stringify(file.content.slice(0, 40)));
    check('reports the path it was asked for', file.path === FILE_PATH, file.path);
    check('reports a byte size, not a character count', file.size === Buffer.byteLength(CONTENT), `${String(file.size)} vs ${String(CONTENT.length)}`);
    // GitHub's blob identity: sha1("blob <bytes>\0content"). Pinning the exact value here means the double and
    // the real transport agree with what `git hash-object` prints, which is the only thing a caller can verify.
    const expected = '818c21c9d0441ce16f7f0206079170aafcf85fb9';
    check('reports GitHub blob identity', file.sha === expected, file.sha);
  } catch (error) {
    check('reads a file verbatim', false, (error as Error).message);
  }

  // 2. a missing path is not the same fact as an invisible repository. Collapsing them costs an operator a
  //    debugging session per wrong guess (#130: the installation selection, not the path, was the problem).
  await expectFailure(scm, check, 'repository-not-in-selection', 'forbidden');
  await expectFailure(scm, check, 'missing-path', 'not-found');
  // A ref that does not resolve and a path that does not exist are DIFFERENT facts, and whether a transport
  // can tell them apart is a property of the transport, not of the contract. GitHub's Contents API answers the
  // identical 404 with the identical body; git fails at fetch for the ref and at rev-parse for the path. So the
  // suite asserts the strong form only where the driver declared it can, and asserts the weak form (the failed
  // ref must be NAMED, because that is what distinguishes "re-pin the commit" from "check the path") always.
  const badRef = scm.readFailure ? await scm.readFailure('unknown-ref') : null;
  check(
    'an unresolvable ref is reported as a read failure that names the ref',
    badRef !== null && badRef !== undefined && badRef.detail.includes(FIXTURE_FILE.ref),
    JSON.stringify(badRef),
  );
  if (scm.capabilities.refVersusPath) {
    check(
      'a transport that CAN tell a bad ref from a missing path does so',
      badRef !== null && badRef !== undefined && badRef.kind === 'ref-not-found',
      JSON.stringify(badRef),
    );
  } else {
    check(
      'a transport that cannot tell them apart says so by reporting not-found rather than inventing a kind',
      badRef !== null && badRef !== undefined && badRef.kind === 'not-found',
      JSON.stringify(badRef),
    );
  }
  await expectFailure(scm, check, 'directory-not-file', 'not-a-file');
  if (scm.capabilities.inlineSizeLimit) {
    await expectFailure(scm, check, 'oversized-file', 'too-large');
  } else {
    // No cutoff, no refusal -- but the bytes must still arrive intact, which is the assertion that replaces
    // the skip. A check that merely disappeared for git would let a truncating transport pass as "no limit".
    const big = await scm.read({ repo: FIXTURE_FILE.repo, ref: FIXTURE_FILE.ref, path: 'huge.yaml' });
    check('a transport without a size limit returns the whole file', big.size === FIXTURE_FILE.largeSize && big.content.length === FIXTURE_FILE.largeSize, `${String(big.size)} bytes`);
  }

  // 3. dispatch: what a driver CAN promise is checked strictly; what it cannot is required to refuse loudly.
  if (scm.capabilities.workflowDispatch) {
    const ok = await scm.dispatch({ repo: REPO, workflow: 'platfolio-managed.yml', ref: 'main', inputs: { action: 'apply', environment: 'production' } });
    check('dispatches a workflow that exists', ok.kind === 'requested', JSON.stringify(ok));
    const missing = await scm.dispatch({ repo: REPO, workflow: 'not-there.yml', ref: 'main', inputs: {} });
    check('refuses a workflow GitHub cannot find', missing.kind === 'workflow-not-found', JSON.stringify(missing));
    check('names the default-branch cause, since a typo looks identical', /default branch/i.test(missing.detail ?? ''), missing.detail ?? '');
  } else {
    const refused = await scm.dispatch({ repo: REPO, workflow: 'platfolio-managed.yml', ref: 'main', inputs: { action: 'apply' } });
    check('a driver without forge dispatch refuses instead of reporting success', refused.kind !== 'requested', JSON.stringify(refused));
    check('the refusal says which capability is missing, not that it failed', /git|forge|dispatch/i.test(refused.kind), refused.kind);
  }

  // 4. arguments are validated before a credential is ever minted, so a typo cannot produce a GitHub call.
  for (const bad of ['acme', 'acme/widget/extra', '']) {
    let threw = false;
    try {
      await scm.read({ repo: bad, ref: 'main', path: 'x' });
    } catch {
      threw = true;
    }
    check(`rejects malformed repo "${bad}" locally`, threw, 'no error thrown');
  }

  return results;
}

async function expectFailure(
  scm: ScmUnderTests,
  check: (name: string, ok: boolean, detail: string) => void,
  scenario: string,
  kind: string,
): Promise<void> {
  if (!scm.readFailure) {
    check(`failure ${scenario}`, false, 'the implementation under test provides no failure harness');
    return;
  }
  const found = await scm.readFailure(scenario);
  if (found === null || found === undefined) {
    check(`failure ${scenario}`, false, 'no failure surfaced');
    return;
  }
  check(`failure ${scenario} is reported as ${kind}`, found.kind === kind, `${found.kind}: ${found.detail}`);
}

/** A file content shared by both implementations so a byte-level assertion means the same thing in each. */
export const LARGE_CONTENT = 'x\n'.repeat(70_000);
export const FIXTURE_FILE = { path: FILE_PATH, content: CONTENT, repo: REPO, ref: 'main', largePath: 'huge.yaml', largeContent: LARGE_CONTENT, largeSize: Buffer.byteLength(LARGE_CONTENT) } as const;
export const FIXTURE_BLOB_SHA = '818c21c9d0441ce16f7f0206079170aafcf85fb9';

/** Used by the tests to fail loudly if the suite silently ran zero checks. */
export function assertSuiteRan(label: string, results: string[]): void {
  assert.ok(results.length >= 12, `${label}: the conformance suite produced only ${String(results.length)} results -- it did not run`);
  const failed = results.filter((r) => r.includes('FAIL'));
  assert.deepEqual(failed, [], `${label}: ${String(failed.length)} conformance failure(s):\n${failed.join('\n')}`);
}
