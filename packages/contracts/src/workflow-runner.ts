import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * The execution half of the actor/executor split (C5, D30).
 *
 * platfolio decides what should be running and observes the result; the tenant's own pipeline performs the
 * change, with the tenant's own credentials. `workflow_dispatch` is the seam: triggering a curated workflow
 * keeps the tenant's pipeline as the path of record -- the audit trail is a GitHub run, not something we
 * build and defend -- while leaving an actor that does not need a human to press a button.
 *
 * Two absences are the design, not omissions:
 *
 * - **No log access, ever.** Workflow logs are free text and routinely contain resolved environment values.
 *   Run *status* is metadata; a diagnosis has to come back as a structured field the workflow chose to emit
 *   (see `artifacts`/`output` below), which is why the runner returns a conclusion and a URL rather than a
 *   transcript. A `logs` method would be a secret-reading method wearing a costume.
 * - **No write of workflow files.** Curated workflows ship as pull requests (D30), so this module can read
 *   a file's blob hash to detect drift and nothing more.
 */

const Repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'owner/repo');
const Path = z.string().regex(/^[^/].*$/, 'repository-relative path, no leading slash');

export const DispatchInputSchema = z.object({
  repo: Repo,
  /** File name under .github/workflows, as GitHub's dispatch endpoint wants it. */
  workflow: z.string().min(1),
  ref: z.string().min(1).default('main'),
  /** Strings only: a dispatch input is a value the workflow will read, and most are names or flags. */
  inputs: z.record(z.string(), z.string()).default({}),
}).strict();
export type DispatchRequest = z.infer<typeof DispatchInputSchema>;

/** Normalised view of a run: enough to drive state, never the transcript. */
export const RunStateSchema = z.enum(['queued', 'in-progress', 'success', 'failure', 'cancelled', 'timed-out', 'action-required', 'unknown']);
export type RunState = z.infer<typeof RunStateSchema>;

export interface RunView {
  runId: number;
  state: RunState;
  /** Head commit the run acted on, so a caller can tell a stale green from a current one. */
  headSha: string;
  url: string;
}

export interface WorkflowRunner {
  dispatch(request: DispatchRequest): Promise<void>;
  latestRun(repo: string, workflow: string, ref?: string): Promise<RunView | undefined>;
  /** Blob hash of a file as it exists in the tenant repository, for drift against what we render. */
  fileHash(repo: string, path: string, ref: string): Promise<string | undefined>;
}

interface RunnerConfig {
  token: string;
  githubApi?: string;
  fetch?: typeof globalThis.fetch;
}

const GitHubStatus = new Map<string, RunState>([
  ['queued', 'queued'], ['requested', 'queued'], ['waiting', 'queued'], ['pending', 'queued'],
  ['in_progress', 'in-progress'], ['progress', 'in-progress'], ['queued', 'queued'],
  ['completed', 'unknown'], ['action_required', 'action-required'],
]);
const GitHubConclusion = new Map<string, RunState>([
  ['success', 'success'], ['failure', 'failure'], ['cancelled', 'cancelled'],
  ['timed_out', 'timed-out'], ['action_required', 'action-required'], ['skipped', 'unknown'],
]);

/** Status alone is not the answer: a completed run needs its conclusion, and neither alone is enough. */
export function runState(status: string | undefined, conclusion: string | undefined): RunState {
  if (conclusion && GitHubConclusion.has(conclusion)) return GitHubConclusion.get(conclusion)!;
  if (status && GitHubStatus.has(status)) return GitHubStatus.get(status)!;
  return 'unknown';
}

/** Git's blob hash: what GitHub reports for file contents, computed locally to compare against. */
export function blobHash(content: string): string {
  return createHash('sha1').update(`blob ${Buffer.byteLength(content, 'utf8')}\u0000${content}`, 'utf8').digest('hex');
}

export type DriftVerdict = 'in-sync' | 'changed' | 'missing' | 'unknown';

/**
 * Curated files the tenant may have edited. `changed` is not a failure to correct by force -- the whole
 * point of shipping workflows as pull requests is that the tenant can refuse them -- so the verdict is
 * information for a human-facing screen, never an instruction to overwrite.
 */
export function classifyDrift(expected: string, actual: string | undefined): DriftVerdict {
  if (actual === undefined) return 'unknown';
  if (actual === '') return 'missing';
  return blobHash(expected) === actual ? 'in-sync' : 'changed';
}

export class GithubWorkflowRunner implements WorkflowRunner {
  private readonly token: string;
  private readonly api: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: RunnerConfig) {
    this.token = config.token;
    this.api = config.githubApi ?? 'https://api.github.com';
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  private async request<T>(path: string, init?: { method?: string; body?: string }): Promise<{ status: number; body: T | undefined }> {
    const response = await this.fetchImpl(`${this.api}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'platfolio',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init?.body ? { body: init.body } : {}),
    });
    if (response.status === 204) return { status: 204, body: undefined };
    const body = await response.json().catch(() => undefined) as T | undefined;
    return { status: response.status, body };
  }

  async dispatch(request: DispatchRequest): Promise<void> {
    const parsed = DispatchInputSchema.parse(request);
    const { status } = await this.request(`/repos/${parsed.repo}/actions/workflows/${encodeURIComponent(parsed.workflow)}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: parsed.ref, inputs: parsed.inputs }),
    });
    if (status !== 204) throw new Error(`dispatch of ${parsed.workflow} was not accepted (${String(status)})`);
  }

  async latestRun(repo: string, workflow: string, ref?: string): Promise<RunView | undefined> {
    const query = new URLSearchParams({ per_page: '10' });
    if (ref) query.set('branch', ref);
    const { body } = await this.request<{ workflow_runs?: { id: number; status?: string; conclusion?: string; head_sha?: string; html_url?: string }[] }>(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?${query.toString()}`,
    );
    // Newest first as GitHub returns them; runs with no head sha cannot be correlated to a commit, so they
    // are skipped rather than reported as success against an unknown tree.
    const run = (body?.workflow_runs ?? []).find((r) => r.head_sha);
    if (!run) return undefined;
    return { runId: run.id, state: runState(run.status, run.conclusion), headSha: run.head_sha ?? '', url: run.html_url ?? '' };
  }

  async fileHash(repo: string, path: string, ref: string): Promise<string | undefined> {
    const parsed = Path.parse(path);
    const { status, body } = await this.request<{ sha?: string }>(
      `/repos/${repo}/contents/${parsed.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    );
    if (status === 404) return '';
    return body?.sha;
  }
}
