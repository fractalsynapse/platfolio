import { createHash } from 'node:crypto';

/**
 * The in-memory source-control double (seam rule 3: every interface ships a second implementation).
 *
 * It exists so `readRepositoryFile` / `dispatchWorkflowRun` are exercised without a GitHub App installation,
 * and so the shape of the contract cannot quietly become GitHub-shaped in ways a single real call would hide.
 * Each behaviour mirrors something GitHub does, and says which: properties inferred from documentation rather
 * than met in person are labelled, because inventing a plausible status code is how a double ends up
 * certifying a fiction.
 */
import type { RepositoryFile, RepositoryFileRequest, RepositoryReadFailure, WorkflowDispatchRequest, WorkflowDispatchResult } from './scm-github.ts';
import { RepositoryReadError } from './scm-github.ts';

/** GitHub's inline-content cutoff. Documented, not yet provoked by us. */
const INLINE_LIMIT = 1_048_576;

const WORKFLOW_NOT_FOUND = (repo: string, workflow: string, ref: string): string =>
  `${repo} has no workflow "${workflow}" on ${ref}. GitHub enumerates workflows from the default branch only (#149) -- an install PR that has not been merged looks identical to a typo.`;

export interface MemoryScmOptions {
  /** Contents keyed `repo@ref:path`. */
  files?: Record<string, string>;
  /** Repositories the installation cannot see at all -- the #130 limit, modelled instead of hand-waved. */
  hiddenRepos?: string[];
  /** Keys that resolve to a directory listing rather than a file. */
  directories?: string[];
  /** Refs GitHub cannot resolve. */
  unknownRefs?: string[];
  /** `repo -> default branch`, because that is the only place GitHub looks for workflows (#149). */
  defaultBranches?: Record<string, string>;
  /** Workflow file names present in a repository: `repo -> [file]`, read against the default branch. */
  workflows?: Record<string, string[]>;
  /** Shrinkable so the >1 MiB refusal is testable without a megabyte of fixture. */
  inlineLimit?: number;
}

export class MemoryScm {
  readonly reads: string[] = [];
  readonly dispatches: { repo: string; workflow: string; ref: string; inputs: Record<string, string> }[] = [];
  private readonly files: Map<string, string>;
  private readonly hidden: Set<string>;
  private readonly dirs: Set<string>;
  private readonly unknownRefs: Set<string>;
  private readonly defaults: Record<string, string>;
  private readonly workflows: Record<string, string[]>;
  private readonly limit: number;

  constructor(options: MemoryScmOptions = {}) {
    this.files = new Map(Object.entries(options.files ?? {}));
    this.hidden = new Set(options.hiddenRepos ?? []);
    this.dirs = new Set(options.directories ?? []);
    this.unknownRefs = new Set(options.unknownRefs ?? []);
    this.defaults = options.defaultBranches ?? {};
    this.workflows = options.workflows ?? {};
    this.limit = options.inlineLimit ?? INLINE_LIMIT;
  }

  async readRepositoryFile(request: RepositoryFileRequest): Promise<RepositoryFile> {
    if (!/^[^/]+\/[^/]+$/.test(request.repo)) throw new Error(`repo must be owner/name, got "${request.repo}"`);
    if (!request.ref) throw new Error('a repository file read needs a ref; platfolio never reads a moving default');
    const path = request.path.replace(/^\/+/, '');
    const key = `${request.repo}@${request.ref}:${path}`;
    this.reads.push(key);

    if (this.hidden.has(request.repo)) {
      throw this.fail({ kind: 'forbidden', detail: `the platfolio GitHub App installation cannot see ${request.repo}; add it to the installation's repository selection (#130)` }, 404);
    }
    if (this.unknownRefs.has(`${request.repo}@${request.ref}`) || this.unknownRefs.has(request.ref)) {
      throw this.fail({ kind: 'ref-not-found', detail: `reference ${request.ref} does not exist in ${request.repo}` }, 404);
    }
    if (this.dirs.has(key)) {
      throw this.fail({ kind: 'not-a-file', detail: `"${path}" is a collection, not a file` }, 200);
    }
    const content = this.files.get(key);
    if (content === undefined) {
      throw this.fail({ kind: 'not-found', detail: `${request.repo}@${request.ref} has no file at "${path}"` }, 404);
    }
    const size = Buffer.byteLength(content);
    if (size > this.limit) {
      throw this.fail({ kind: 'too-large', detail: `${path} is ${String(size)} bytes and the API returns no inline content past ${String(this.limit)}; fetch it as an archive instead` }, 200);
    }
    return { path, ref: request.ref, repo: request.repo, sha: blobSha(content), size, content };
  }

  async dispatchWorkflowRun(request: WorkflowDispatchRequest): Promise<WorkflowDispatchResult> {
    this.dispatches.push({ repo: request.repo, workflow: request.workflow, ref: request.ref, inputs: request.inputs });
    // GitHub resolves the workflow against the DEFAULT branch (#149, measured) while running it against the
    // ref asked for, so "exists on default" is the gate and `request.ref` is not.
    const def = this.defaults[request.repo] ?? 'main';
    const onDefault = (this.workflows[request.repo] ?? this.workflows[`${request.repo}@${def}`] ?? []).includes(request.workflow);
    if (!onDefault) {
      return { kind: 'workflow-not-found', detail: WORKFLOW_NOT_FOUND(request.repo, request.workflow, request.ref) };
    }
    return { kind: 'requested', status: 204 };
  }

  private fail(failure: RepositoryReadFailure, status: number): RepositoryReadError {
    return new RepositoryReadError(failure, status);
  }
}

/** GitHub's blob identity: sha1 of `blob <bytes>\0` plus the content, so a fixture can match the real API. */
export function blobSha(content: string): string {
  return createHash('sha1').update(`blob ${String(Buffer.byteLength(content))}\u0000`).update(content).digest('hex');
}
