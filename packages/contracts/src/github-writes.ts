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
    // Create-or-update. A first run creates the ref; every later run -- a plan changed, an approval came
    // back, the tenant asked for a fresh PR -- must move it. POST on an existing branch answers 422
    // "Reference already exists", which made a second install attempt against the same tenant fail outright.
    try {
      await this.call(`/repos/${input.repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${input.branch}`, sha: commit.sha } });
    } catch (error) {
      const message = (error as Error).message;
      if (!/Reference already exists/.test(message)) throw error;
      await this.call(`/repos/${input.repo}/git/refs/heads/${encodeURIComponent(input.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: true } });
    }
    return { headSha: commit.sha, baseSha };
  }

  /**
   * Get the first commit into a repository that has none.
   *
   * The Git data API cannot be used to bootstrap an empty repository: `POST /git/blobs` answers
   * **409 "Git Repository is empty"** -- measured, against a repository created seconds earlier. So the
   * branch has to be brought into existence through the contents endpoint, which does permit a first write,
   * and only then can the tree path do what it is good at: one commit carrying every remaining file.
   *
   * Two commits rather than one is the cost, and it is worth paying deliberately rather than pretending:
   * the alternative is a repository whose history starts with a commit that says "seed", which is honest
   * about what happened, versus a publisher that cannot publish at all.
   *
   * Returns the head sha after the full file set is committed.
   */
  async seedAndCommit(input: { repo: string; branch: string; seedFile: { path: string; content: string }; message: string; files: Record<string, string> }): Promise<{ headSha: string; seeded: boolean }> {
    Repo.parse(input.repo);
    const paths = Object.keys(input.files).sort();
    if (paths.length === 0) throw new Error('github: refusing to create an empty commit');
    let seeded = false;
    try {
      await this.branchSha(input.repo, input.branch);
    } catch {
      await this.call<unknown>(`/repos/${input.repo}/contents/${input.seedFile.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        body: { message: `${input.message} (initial branch)`, content: Buffer.from(input.seedFile.content, 'utf8').toString('base64'), branch: input.branch },
      });
      seeded = true;
    }
    const { headSha } = await this.commitFiles({ ...input, baseBranch: input.branch });
    return { headSha, seeded };
  }

  /** First-line messages on a branch, newest first. Used to tell "ours" from "theirs" before pushing. */
  async listCommits(repo: string, branch: string): Promise<string[]> {
    Repo.parse(repo);
    // The endpoint answers with a bare array, not an object -- reading `.commits` returned undefined, which
    // looked like "no history", which silently routed both publish cases down the pull-request path. A
    // response-shape assumption that fails *quietly* is worse than one that throws, so both shapes are read.
    const data = await this.call<{ commits?: { commit?: { message?: string } }[] } | { commit?: { message?: string } }[]>(
      `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=20`,
    );
    const list = Array.isArray(data) ? data : (data.commits ?? []);
    return list.map((c) => (c.commit?.message ?? '').split('\n')[0] ?? '');
  }

  /** Whether the installation can see a repository at all -- the #130 check, made explicit. */
  async repositoryVisible(repo: string): Promise<boolean> {
    Repo.parse(repo);
    const response = await this.fetchImpl(`${this.api}/repos/${repo}`, { headers: this.headers });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw new Error(`github: repository visibility check returned ${String(response.status)}`);
  }

  async openPullRequest(input: { repo: string; title: string; body: string; head: string; base: string; draft?: boolean }): Promise<PullRequestResult> {
    Repo.parse(input.repo);
    let pr: { number: number; url?: string; html_url?: string; head?: { sha?: string }; base?: { sha?: string } };
    try {
      pr = await this.call<typeof pr>(
        `/repos/${input.repo}/pulls`,
        { method: 'POST', body: { title: input.title, body: input.body, head: input.head, base: input.base, draft: input.draft ?? false } },
      );
    } catch (error) {
      // Re-offering an install is normal -- the plan changed, an approval came back -- and GitHub refuses a
      // second PR from the same head to the same base. Updating the existing review is the right answer;
      // opening a duplicate would split the conversation a human is reading.
      if (!/A pull request already exists/i.test((error as Error).message)) throw error;
      const existing = await this.call<{ number?: number }[]>(`/repos/${input.repo}/pulls?state=open&head=${encodeURIComponent(`${input.repo.split('/')[0]}:${input.head}`)}`);
      const number = Array.isArray(existing) ? existing[0]?.number : undefined;
      if (typeof number !== 'number') throw new Error('github: an install PR already exists for this branch but it could not be found');
      pr = await this.call<typeof pr>(`/repos/${input.repo}/pulls/${String(number)}`, { method: 'PATCH', body: { title: input.title, body: input.body } });
      if (typeof pr?.number !== 'number') pr = { number, head: { sha: '' }, base: { sha: '' } };
    }
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
   * Create or update a repository environment (needs `administration: write`; measured 403 without it), and
   * optionally attach the human gate: `PUT` accepts `reviewers` with type `User` or `Team` and rejects `App`.
   * Both halves measured live (issue #126), which is why platfolio can create a production environment *with*
   * its required reviewers rather than handing the tenant a half-configured object.
   *
   * Note this is a full replacement, not a patch: an omitted `reviewers` field leaves the existing gate
   * alone, while `reviewers: []` removes it. GitHub answers 200 for both create and update, so the caller
   * cannot tell from the status whether anything changed.
   */
  async ensureEnvironment(repo: string, name: string, protection: EnvironmentProtection = {}): Promise<void> {
    Repo.parse(repo);
    await this.call(`/repos/${repo}/environments/${encodeURIComponent(name)}`, { method: 'PUT', body: environmentBody(protection) });
  }

  /**
   * Create a repository in an organization from a platform template (D35). PENDING LIVE CHECK: whether an
   * installation token may generate from a template, and whether `repository_creation` (the narrow grant) is
   * sufficient or `administration` is required. The call shape follows GitHub's documented endpoint; the
   * authorization answer has to come from a registration that carries the grants.
   */
  async createRepositoryFromTemplate(request: TemplateRepositoryRequest): Promise<{ fullName: string; url: string; cloneUrl: string }> {
    const body: Record<string, unknown> = {
      owner: request.owner,
      name: request.name,
      private: request.private ?? true,
      include_all_branches: request.includeAllBranches ?? false,
    };
    if (request.description) body.description = request.description;
    const created = await this.call<{ full_name: string; html_url: string; clone_url: string }>(
      `/repos/${request.templateOwner}/${request.templateRepo}/generate`,
      { method: 'POST', body },
    );
    if (!created.full_name) throw new Error('github: template generation returned no repository');
    return { fullName: created.full_name, url: created.html_url ?? '', cloneUrl: created.clone_url ?? '' };
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

/**
 * Environment and repository provisioning (D35).
 *
 * Both operations are added because a control plane that cannot create the objects it manages is not a
 * control plane -- a tenant would leave platfolio to click "Add environment", which contradicts the product
 * promise. The trade-off is explicit: repository environments require `administration: write`, a broader
 * grant than we would choose, so the compensating control is that these methods are only ever reached with a
 * token minted for the specific call and revoked at the end of it.
 *
 * What remains unproven is stated in the code, not hidden: creating a repository **from a template** with an
 * installation token, and setting environment *required reviewers* through the API, are both pending a live
 * check against a registration that carries these grants. Neither is faked in a test.
 */
export interface EnvironmentReviewer {
  /**
   * Measured: GitHub accepts `User` and `Team` and rejects `App` -- "App is not a possible value" -- because
   * an app cannot approve its own deployments. The earlier assumption that required reviewers were a UI-only
   * setting was wrong, and this is the proof.
   */
  type: 'User' | 'Team';
  id: number;
}

export interface EnvironmentProtection {
  /** Minutes GitHub waits before allowing a deployment. */
  waitTimerMinutes?: number;
  /** Settable through the API, with the type restriction above. Empty means "no gate", not "unchanged". */
  reviewers?: EnvironmentReviewer[];
}

export function environmentBody(protection: EnvironmentProtection): { wait_timer: number; reviewers?: { type: string; id: number }[] } {
  return {
    wait_timer: protection.waitTimerMinutes ?? 0,
    ...(protection.reviewers ? { reviewers: protection.reviewers } : {}),
  };
}

export interface TemplateRepositoryRequest {
  templateOwner: string;
  templateRepo: string;
  /** The organization (or user) that will own the new repository. */
  owner: string;
  name: string;
  description?: string;
  private?: boolean;
  /** Templates copy only the default branch unless this is true. */
  includeAllBranches?: boolean;
}

