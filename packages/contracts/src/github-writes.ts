import { z } from 'zod';

/**
 * The write path for the install pull request (D30, runbook step 3).
 *
 * This is the only moment platfolio writes to a tenant repository, and the design says so on purpose: after
 * this PR is merged (or refused) platfolio dispatches workflows and never edits the repo again. Everything
 * here exists to make that single write reviewable -- one branch, one commit, one pull request -- and to make
 * the alternative (force-pushing files into someone's main) impossible by omission.
 *
 * Three deliberate properties:
 *
 * - **Commit via the Git data API, not the contents API.** The contents endpoint commits one file at a time,
 *   so a four-file install would land as four commits with four chances to be half-applied. A tree is atomic.
 * - **The base is read, never assumed.** A stale cached sha produces a PR against a moving target; refetching
 *   means the commit's parent is what GitHub currently believes.
 * - **No secret values enter these payloads.** Only file content and names; the secrets the install needs are
 *   written by the write-once path, into the repository's own environment, and never through a commit.
 */

const Repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'owner/repo');

export interface WriteConfig {
  /** An installation access token, scoped to this repository. Never the app JWT. */
  token: string;
  githubApi?: string;
  fetch?: typeof globalThis.fetch;
}

export interface PullRequestResult {
  number: number;
  url: string;
  htmlUrl: string;
  headSha: string;
  baseSha: string;
}

export class GithubRepositoryWrites {
  private readonly api: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: WriteConfig) {
    this.api = config.githubApi ?? 'https://api.github.com';
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.headers = {
      authorization: `Bearer ${config.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'platfolio',
    };
  }

  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await this.fetchImpl(`${this.api}${path}`, {
      method: init?.method ?? 'GET',
      headers: { ...this.headers, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 240).replace(/\s+/g, ' ');
      throw new Error(`github ${init?.method ?? 'GET'} ${path} failed (${String(response.status)})${detail ? `: ${detail}` : ''}`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  /** The sha GitHub currently believes for a branch. Called every time; a cached value is how half-applied installs happen. */
  async branchSha(repo: string, branch: string): Promise<string> {
    Repo.parse(repo);
    const data = await this.call<{ object: { sha: string } | null }>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!data.object?.sha) throw new Error(`github: no commit for ${repo} ${branch}`);
    return data.object.sha;
  }

  /** One atomic commit containing every install file, on a fresh branch off the current base. */
  async commitFiles(input: { repo: string; baseBranch: string; branch: string; message: string; files: Record<string, string> }): Promise<{ headSha: string; baseSha: string }> {
    Repo.parse(input.repo);
    const paths = Object.keys(input.files).sort();
    if (paths.length === 0) throw new Error('github: refusing to open an install PR with no files');
    const baseSha = await this.branchSha(input.repo, input.baseBranch);

    const blobs = await Promise.all(paths.map(async (path) => {
      const content = input.files[path]!;
      if (content.includes('\u0000')) throw new Error(`github: refusing to commit a NUL byte in ${path}`);
      const blob = await this.call<{ sha: string }>(`/repos/${input.repo}/git/blobs`, { method: 'POST', body: { content } });
      return { path, sha: blob.sha, mode: '100644' as const };
    }));

    const tree = await this.call<{ sha: string }>(`/repos/${input.repo}/git/trees`, {
      method: 'POST',
      body: { base_tree: baseSha, tree: blobs },
    });
    const commit = await this.call<{ sha: string }>(`/repos/${input.repo}/git/commits`, {
      method: 'POST',
      body: { message: input.message, parents: [baseSha], tree: tree.sha },
    });
    await this.call(`/repos/${input.repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${input.branch}`, sha: commit.sha } });
    return { headSha: commit.sha, baseSha };
  }

  async openPullRequest(input: { repo: string; title: string; body: string; head: string; base: string; draft?: boolean }): Promise<PullRequestResult> {
    Repo.parse(input.repo);
    const pr = await this.call<{ number: number; url?: string; html_url?: string; head?: { sha?: string }; base?: { sha?: string } }>(
      `/repos/${input.repo}/pulls`,
      { method: 'POST', body: { title: input.title, body: input.body, head: input.head, base: input.base, draft: input.draft ?? false } },
    );
    if (typeof pr.number !== 'number') throw new Error('github: pull request response had no number');
    return {
      number: pr.number,
      url: pr.url ?? '',
      htmlUrl: pr.html_url ?? '',
      headSha: pr.head?.sha ?? '',
      baseSha: pr.base?.sha ?? '',
    };
  }

  /**
   * Does this repository environment exist?
   *
   * **Check only -- platfolio does not create environments, and that is a measured constraint, not a choice
   * we are working around.** An installation token with `environments: write` gets 403 from
   * `PUT /repos/{repo}/environments/{name}`, and requesting `administration: write` is refused because the
   * app was never granted it: creating an environment is a repository-administration act, and the permission
   * that would allow it would also allow editing settings, branch protection and worse.
   *
   * Two consequences, both better than the alternative. The tenant creates the environment and attaches
   * required reviewers -- so the human who owns the production gate configures it, which is the point of the
   * gate -- or the environment appears implicitly on the workflow's first run and the gate is added after.
   * Either way platfolio's permission set stays what D25 claims it is.
   */
  async environmentExists(repo: string, name: string): Promise<boolean> {
    Repo.parse(repo);
    const response = await this.fetchImpl(`${this.api}/repos/${repo}/environments/${encodeURIComponent(name)}`, { headers: this.headers });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw new Error(`github: environment presence check returned ${String(response.status)}`);
  }

  /**
   * Presence check for an environment secret. Deliberately the only read in this class, because it returns a
   * 204/404 and no value -- see D32. There is no method here that could return a secret.
   */
  async hasEnvironmentSecret(repo: string, environment: string, name: string): Promise<boolean> {
    Repo.parse(repo);
    const response = await this.fetchImpl(`${this.api}/repos/${repo}/environments/${encodeURIComponent(environment)}/secrets/${encodeURIComponent(name)}`, { headers: this.headers });
    if (response.status === 204 || response.status === 200) return true;
    if (response.status === 404) return false;
    throw new Error(`github: environment secret presence check returned ${String(response.status)}`);
  }
}
