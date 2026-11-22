import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepositoryReadError, type RepositoryFile, type RepositoryFileRequest, type WorkflowDispatchRequest, type WorkflowDispatchResult } from './scm-github.ts';
import { blobSha } from './memory-scm.ts';

/**
 * The `git` driver of the source-control seam (D22, extended by the maintainer's reading of it).
 *
 * GitHub is a wrapper over git; GitLab is a wrapper over git; the wrapper adds the things git has no concept
 * of -- issues, pull requests, **workflow dispatch**. So the seam splits honestly along that line:
 *
 * | Operation | `git` driver | `github-app` driver |
 * | --- | --- | --- |
 * | read one file at one ref | **yes** -- any forge, any host, over HTTPS or SSH | yes, via the Contents API |
 * | ask for a pipeline run | **no, and it says so** | yes |
 *
 * Two properties this driver has that the Contents API does not, and they are not incidental:
 *
 * 1. **It distinguishes a bad ref from a missing path.** GitHub answers the identical 404 with the identical
 *    body for both; `git fetch` fails with "couldn't find remote ref" while `git show` fails on the path. The
 *    contract's `ref-not-found` kind was previously reachable only by guessing at wording -- here it is
 *    observed. That is what a second implementation is for: it shows what the first one was hiding.
 * 2. **The blob SHA is native.** `git rev-parse <ref>:<path>` returns the same 40-hex blob identity GitHub
 *    reports in `content.sha`, computed rather than quoted. A test asserts the agreement, which is what turns
 *    "same field in two drivers" from a hope into a check.
 *
 * The failure kinds that do NOT apply are reported as inapplicable rather than skipped silently: git has no
 * inline-size cutoff, so `too-large` cannot occur here, and a conformance suite that quietly passed that check
 * would be certifying an absence.
 */
export interface GitScmConfig {
  /** Forge host for URL construction when a request names `owner/repo` rather than a full remote. */
  host?: string;
  transport?: 'https' | 'ssh';
  /**
   * HTTPS token (fine-grained PAT, installation token, or `gh auth token`). Supplied by the composition root
   * from the environment -- never a committed value, and never returned by any endpoint (D4). Omitted, git
   * uses whatever the host environment already provides: an SSH agent, a credential helper, or nothing.
   *
   * That last case matters for a deployment: ambient credentials are how a service works on a laptop and fails
   * in a container. The error text therefore says which remote was attempted and that no token was supplied,
   * instead of letting "fatal: could not read Username" stand as the whole explanation.
   */
  token?: string;
  /** Override for tests and unusual installs. */
  gitPath?: string;
  timeoutMs?: number;
}

/**
 * The git binary is not present. This is a packaging fact about the deployment, not a fact about the
 * repository, and it must never be dressed up as one: the first version classified it as a fetch failure, which
 * told an operator to go check credentials on a container that simply had no git.
 */
export class GitUnavailableError extends Error {
  constructor(binary: string) {
    super(`git is not available to this process: the "${binary}" binary was not found (ENOENT). The git driver shells out to it -- install it in the image (apps/control-plane/Dockerfile does) or select the github-app driver instead.`);
    this.name = 'GitUnavailableError';
  }
}

/** A forge-level operation asked of a driver that speaks only git. */
export class ForgeOperationUnsupportedError extends Error {
  readonly code = 'forge-operation-unsupported';
  constructor(operation: string, driver = 'git') {
    super(`"${operation}" is not a git operation; it needs a forge integration (the ${driver === 'git' ? 'github-app' : driver} driver). git reads commits and nothing else -- running a pipeline, opening a pull request, or commenting on an issue all live above it.`);
    this.name = 'ForgeOperationUnsupportedError';
  }
}

export class GitScm {
  private readonly config: Required<Pick<GitScmConfig, 'host' | 'transport' | 'gitPath' | 'timeoutMs'>> & Pick<GitScmConfig, 'token'>;

  constructor(config: GitScmConfig = {}) {
    this.config = {
      host: config.host ?? 'github.com',
      transport: config.transport ?? 'https',
      gitPath: config.gitPath ?? 'git',
      timeoutMs: config.timeoutMs ?? 60_000,
      ...(config.token === undefined ? {} : { token: config.token }),
    };
  }

  describe(): { driver: 'git'; host: string; transport: string; tokenSupplied: boolean } {
    return { driver: 'git', host: this.config.host, transport: this.config.transport, tokenSupplied: this.config.token !== undefined };
  }

  /** `owner/repo` -> a remote URL, honouring a full URL if the caller already has one (self-hosted forges). */
  remoteUrl(repo: string): string {
    if (/^(https?:\/\/|ssh:\/\/|git@|file:\/\/)/.test(repo)) return repo;
    if (this.config.transport === 'ssh') return `git@${this.config.host}:${repo}.git`;
    const token = this.config.token;
    // x-access-token is the username GitHub accepts for any token type; the secret goes in the URL, which is
    // why it never leaves this function -- see `run` for the masking that keeps it out of error text.
    const auth = token === undefined ? '' : `${encodeURIComponent('x-access-token')}:${encodeURIComponent(token)}@`;
    return `https://${auth}${this.config.host}/${repo}.git`;
  }

  async readRepositoryFile(request: Pick<RepositoryFileRequest, 'repo' | 'ref' | 'path'>): Promise<RepositoryFile> {
    if (!request.ref) throw new Error('a repository file read needs a ref; platfolio never reads a moving default');
    // Same rule as the Contents driver: a malformed repo is a caller bug, caught before any process runs, so a
    // typo cannot produce a git subprocess (and, with a token configured, an outbound request).
    // Accepts `owner/name`, an absolute local path remote (`file://`, including the empty-host `file:///`),
    // or an https/ssh/ssh-scp remote. Broad enough for self-hosted forges, narrow enough that a typo like
    // "acme" never reaches a subprocess.
    if (!/^(?:file:\/\/\/[^\s]+|https?:\/\/[^/\s]+\/.+|ssh:\/\/[^/\s]+\/.*|git@[^:\s]+:.+|[\w.-]+\/[\w.-]+)$/.test(request.repo)) {
      throw new Error(`repo must be owner/name or a full remote URL, got "${request.repo}"`);
    }
    const path = request.path.replace(/^\/+/, '');
    const dir = mkdtempSync(join(tmpdir(), 'platfolio-git-'));
    try {
      const remote = this.remoteUrl(request.repo);
      // --depth 1 keeps this a fetch of one object set rather than a clone of history, which is the whole
      // difference between reading one file and mirroring a tenant's repository into a control plane.
      try {
        this.run(['-c', 'credential.helper=', 'init', '-q', '--bare'], dir);
        this.run(['-c', 'credential.helper=', 'remote', 'add', 'origin', remote], dir);
        this.run(['-c', 'credential.helper=', 'fetch', '-q', '--depth', '1', '--no-tags', 'origin', request.ref], dir);
      } catch (error) {
        throw this.fetchFailure(error as Error, request, remote);
      }
      // Resolve the fetched object to a COMMIT and read from there. Two reasons, both learned by running it:
      // a depth-1 fetch leaves only FETCH_HEAD (no local branch ref), so `rev-parse main:path` fails on a
      // branch that fetched perfectly well; and `^{commit}` peels an annotated tag to the commit the tenant
      // pinned, instead of resolving a tag object and then finding "no such path".
      let commit = '';
      try {
        commit = this.run(['-c', 'credential.helper=', 'rev-parse', '--quiet', 'FETCH_HEAD^{commit}'], dir).trim();
      } catch {
        commit = '';
      }
      if (commit === '') {
        throw new RepositoryReadError({ kind: 'ref-not-found', detail: `${this.mask(this.remoteUrl(request.repo))} has no resolvable commit at "${request.ref}"` }, 404);
      }
      // `rev-parse <commit>:<path>` yields the blob (or tree) identity directly: git computes what GitHub quotes.
      let blob: string;
      try {
        blob = this.run(['-c', 'credential.helper=', 'rev-parse', '--quiet', `${commit}:${path}`], dir).trim();
      } catch {
        blob = '';
      }
      if (blob === '') {
        // The ref resolved (the fetch succeeded) and the path did not. This is the distinction the Contents
        // API refuses to make, available here for free.
        throw new RepositoryReadError({ kind: 'not-found', detail: `${request.repo}@${request.ref.slice(0, 12)} has no file at "${path}"` }, 404);
      }
      const type = this.run(['-c', 'credential.helper=', 'cat-file', '-t', blob], dir).trim();
      if (type !== 'blob') {
        throw new RepositoryReadError({ kind: 'not-a-file', detail: `"${path}" is a ${type}, not a file` }, 200);
      }
      const content = this.run(['-c', 'credential.helper=', 'cat-file', 'blob', blob], dir);
      return {
        path, ref: request.ref, repo: request.repo,
        sha: blob,
        size: Buffer.byteLength(content),
        // git returns bytes; a text read that mangles a CRLF would build a plan from content the tenant did
        // not commit, so the buffer is taken as-is and decoded once.
        content: Buffer.isBuffer(content) ? content.toString('utf8') : String(content),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Not supported, stated rather than emulated. A driver that returned success for a dispatch it could not
   * perform would be the worst kind of pluggability: the interface would lie. The message names what is
   * missing so an operator learns the seam's shape from the error instead of from a design doc.
   */
  async dispatchWorkflow(request: WorkflowDispatchRequest): Promise<WorkflowDispatchResult> {
    throw new ForgeOperationUnsupportedError(`dispatch ${request.workflow} in ${request.repo}`);
  }

  private fetchFailure(error: Error, request: Pick<RepositoryFileRequest, 'repo' | 'ref'>, remote: string): RepositoryReadError {
    const text = this.mask(error.message);
    // The classification order matters: ENOENT means the transport itself is missing, and reaching the
    // repository-wording matches below would turn "no git binary" into "check your credentials".
    if (/ENOENT/.test(text) || (error as { code?: string }).code === 'ENOENT') throw new GitUnavailableError(this.config.gitPath);
    if (/couldn't find remote ref|not our ref|reference is not a tree|^$/.test(text)) {
      return new RepositoryReadError({ kind: 'ref-not-found', detail: `${request.repo} has no ref "${request.ref}" (${this.mask(remote)})` }, 404);
    }
    // `Repository not found.` and `fatal: repository 'https://…' not found` are what GitHub and git each say,
    // in either order, so the match is on the phrase rather than on one spelling -- and `.*` because the quoted
    // remote sits between the two words in git's own wording.
    if (/repository.*not found|not found|does not exist|does not appear to be a git repository|could not read from remote repository|access denied|authentication required|could not read Username|invalid username or password|permission denied/i.test(text)) {
      return new RepositoryReadError({
        kind: 'forbidden',
        detail: `cannot read ${this.mask(remote)} -- it does not exist, or it needs credentials this process does not have. ${this.config.token === undefined ? 'No git token was supplied to the composition root (PLATFOLIO_GIT_TOKEN); ambient credentials were not used because a container rarely has them.' : 'A token was supplied and GitHub refused it for this repository.'}`,
      }, 403);
    }
    return new RepositoryReadError({ kind: 'not-found', detail: `git fetch failed for ${this.mask(remote)}@${request.ref}: ${text.slice(0, 220)}` }, 404);
  }

  /**
   * Credentials ride in the remote URL for HTTPS, so every string that could reach a log, an error, or an
   * endpoint has to have them removed. Done in one place rather than at each call site, because the place
   * someone forgets is the place that leaks.
   */
  private mask(text: string): string {
    return text.replace(/\/\/[^/@:]+:[^@/]+@/g, '//[credential-redacted]@');
  }

  private run(args: string[], cwd: string): string {
    try {
      return execFileSync(this.config.gitPath, args, { cwd, encoding: 'utf8', timeout: this.config.timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    } catch (error) {
      const e = error as { code?: string; message?: string; stderr?: string };
      if (e.code === 'ENOENT') {
        throw new GitUnavailableError(this.config.gitPath);
      }
      if (false) {
      }
      throw new Error(this.mask(`${e.message ?? 'git failed'}\n${e.stderr ?? ''}`));
    }
  }
}

/**
 * Does git's own computation agree with the one the GitHub driver quotes? Both drivers must be able to answer
 * the same question about the same bytes, or `source.files[].blobSha` means something different depending on
 * which driver a deployment chose -- a contract with two truths.
 */
export function gitAgreesWithGithubBlobIdentity(gitSha: string, content: string): boolean {
  return gitSha === blobSha(content);
}
