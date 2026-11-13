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
export interface ScmUnderTests {
  label: string;
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
  // A ref that does not resolve answers the SAME status as a path that does not exist -- GitHub's own 404 body
  // is identical for both, so requiring `ref-not-found` here would be asking the implementation to invent a
  // distinction the transport does not provide. What the suite can demand is that the failed ref is NAMED in
  // the message, because that is the difference between "re-pin the commit" and "check the path", and it is
  // recoverable from the text alone. Both classifications are accepted; neither is asserted as GitHub's wording.
  const badRef = scm.readFailure ? await scm.readFailure('unknown-ref') : null;
  check(
    'an unresolvable ref is reported as a read failure that names the ref',
    badRef !== null && badRef !== undefined && ['ref-not-found', 'not-found'].includes(badRef.kind) && badRef.detail.includes(FIXTURE_FILE.ref),
    JSON.stringify(badRef),
  );
  await expectFailure(scm, check, 'directory-not-file', 'not-a-file');
  await expectFailure(scm, check, 'oversized-file', 'too-large');

  // 3. dispatch succeeds only when GitHub would find the workflow (#149), and the message says the two
  //    indistinguishable causes rather than guessing.
  const ok = await scm.dispatch({ repo: REPO, workflow: 'platfolio-managed.yml', ref: 'main', inputs: { action: 'apply', environment: 'production' } });
  check('dispatches a workflow that exists', ok.kind === 'requested', JSON.stringify(ok));
  const missing = await scm.dispatch({ repo: REPO, workflow: 'not-there.yml', ref: 'main', inputs: {} });
  check('refuses a workflow GitHub cannot find', missing.kind === 'workflow-not-found', JSON.stringify(missing));
  check('names the default-branch cause, since a typo looks identical', /default branch/i.test(missing.detail ?? ''), missing.detail ?? '');

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
export const FIXTURE_FILE = { path: FILE_PATH, content: CONTENT, repo: REPO, ref: 'main' } as const;
export const FIXTURE_BLOB_SHA = '818c21c9d0441ce16f7f0206079170aafcf85fb9';

/** Used by the tests to fail loudly if the suite silently ran zero checks. */
export function assertSuiteRan(label: string, results: string[]): void {
  assert.ok(results.length >= 12, `${label}: the conformance suite produced only ${String(results.length)} results -- it did not run`);
  const failed = results.filter((r) => r.includes('FAIL'));
  assert.deepEqual(failed, [], `${label}: ${String(failed.length)} conformance failure(s):\n${failed.join('\n')}`);
}
