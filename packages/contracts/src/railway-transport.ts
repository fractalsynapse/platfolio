/**
 * Railway transport (D20, D24).
 *
 * Split from the provider on purpose: the provider decides *what* to do, this file decides *how a call
 * reaches the API and who is allowed to make it*. Two facts measured on a live workspace shape the design
 * (docs/research/railway-token-and-sealing-2026-11-08.md):
 *
 * 1. A workspace grant performs `projectCreate`, `environmentCreate` and `projectTokenCreate`, but **not**
 *    `serviceCreate`; service-level work needs an environment-scoped project token.
 * 2. A project token authenticates **only** in the `Project-Access-Token` header. Sent as
 *    `Authorization: Bearer` every call returns `Not Authorized`.
 *
 * So credentials are typed by *kind*, and the header follows the kind rather than the caller's preference.
 */

export const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

export type CredentialKind = 'workspace' | 'project';

export interface RailwayCredential {
  kind: CredentialKind;
  /** Held in memory only. Never logged, never returned in an error, never in a result object. */
  token: string;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

/** Everything the provider needs from the outside world. */
export interface RailwayTransport {
  graphql<T>(args: {
    query: string;
    variables?: Record<string, unknown>;
    credential: RailwayCredential;
    operation: string;
  }): Promise<T>;
}

/**
 * Default transport. Railway returns authorization denials as **HTTP 200 with `errors[]`**, so a
 * successful status code means nothing here; anything that is not `data` is an error.
 */
export class HttpRailwayTransport implements RailwayTransport {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: { endpoint?: string; fetch?: typeof fetch; requestTimeoutMs?: number } = {}) {
    this.endpoint = options.endpoint ?? RAILWAY_ENDPOINT;
    this.fetchImpl = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async graphql<T>(args: { query: string; variables?: Record<string, unknown>; credential: RailwayCredential; operation: string }): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // The header is chosen by credential kind, not by the caller.
    if (args.credential.kind === 'project') headers['Project-Access-Token'] = args.credential.token;
    else headers['Authorization'] = `Bearer ${args.credential.token}`;

    let response: Response;
    try {
      // A request with no deadline can hang an apply forever -- a live run stalled exactly this way,
      // sitting on one unanswered call while the caller waited on a "deployment" that had already
      // finished. The timeout turns that into an error the controller can retry or report.
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: args.query, ...(args.variables ? { variables: args.variables } : {}) }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      // Network text can echo the request; keep the message free of anything caller-supplied.
      throw new Error(`railway transport: ${args.operation} failed to reach the API (${(error as Error).name}: ${(error as Error).message.slice(0, 120)})`);
    }
    const body = (await response.json().catch(() => null)) as GraphQLResponse<T> | null;
    if (!body) throw new Error(`railway transport: ${args.operation} returned a non-JSON body (HTTP ${response.status})`);
    if (body.errors?.length) {
      const code = body.errors[0]?.extensions?.code ?? 'unknown';
      // Messages come from Railway; our own sentinel values never appear in them because we never put a
      // secret value into a query string -- values travel only in GraphQL variables.
      throw new Error(`railway ${args.operation}: ${body.errors.map((e) => e.message).join('; ')} [${code}]`);
    }
    if (body.data === undefined) throw new Error(`railway transport: ${args.operation} returned neither data nor errors (HTTP ${response.status})`);
    return body.data as T;
  }
}

/**
 * Where credentials come from. In managed mode (D24 default) the credential broker implements this and
 * mints per-environment project tokens on demand; in strict mode nothing implements it because platfolio
 * holds no grant at all.
 */
export interface RailwayCredentialSource {
  workspace(): Promise<RailwayCredential>;
  forEnvironment(projectId: string, environment: string): Promise<RailwayCredential>;
}

/** Test/offline source: pre-issued tokens, with minting recorded so a caller can prove it never re-mints. */
export class StaticRailwayCredentials implements RailwayCredentialSource {
  readonly minted: { projectId: string; environment: string }[] = [];
  private readonly workspaceToken: string;
  private readonly projectTokens: Record<string, string>;

  constructor(args: { workspaceToken: string; projectTokens?: Record<string, string> }) {
    this.workspaceToken = args.workspaceToken;
    this.projectTokens = args.projectTokens ?? {};
  }

  async workspace(): Promise<RailwayCredential> {
    return { kind: 'workspace', token: this.workspaceToken };
  }

  async forEnvironment(projectId: string, environment: string): Promise<RailwayCredential> {
    const key = `${projectId}:${environment}`;
    const token = this.projectTokens[key];
    if (!token) throw new Error(`no project token available for environment "${environment}" of project "${projectId}"`);
    this.minted.push({ projectId, environment });
    return { kind: 'project', token };
  }
}

/**
 * Mints environment-scoped project tokens through the API, using the workspace grant, and caches them for
 * the lifetime of the run. This is the measured path: `projectTokenCreate` returns the token as a plain
 * `String!`, so the value arrives in memory and is held only here.
 */
export class MintingRailwayCredentials implements RailwayCredentialSource {
  private readonly cache = new Map<string, string>();
  readonly mintedNames: string[] = [];

  private readonly workspaceCredential: RailwayCredential;
  private readonly transport: RailwayTransport;
  private readonly tokenName: string;

  constructor(args: { workspaceCredential: RailwayCredential; transport: RailwayTransport; tokenName?: string }) {
    this.workspaceCredential = args.workspaceCredential;
    this.transport = args.transport;
    this.tokenName = args.tokenName ?? 'platfolio-managed';
  }

  async workspace(): Promise<RailwayCredential> {
    return this.workspaceCredential;
  }

  async forEnvironment(projectId: string, environment: string): Promise<RailwayCredential> {
    const key = `${projectId}:${environment}`;
    const existing = this.cache.get(key);
    if (existing) return { kind: 'project', token: existing };
    const environmentId = await this.environmentId(projectId, environment);
    const data = await this.transport.graphql<{ projectTokenCreate: string }>({
      operation: 'projectTokenCreate',
      credential: this.workspaceCredential,
      query: 'mutation ($input: ProjectTokenCreateInput!) { projectTokenCreate(input: $input) }',
      variables: { input: { projectId, environmentId, name: `${this.tokenName}-${environment}` } },
    });
    this.cache.set(key, data.projectTokenCreate);
    this.mintedNames.push(`${this.tokenName}-${environment}`);
    return { kind: 'project', token: data.projectTokenCreate };
  }

  /** Revoke what we minted. Called on the failure path so a run does not leave live credentials behind. */
  async revokeAll(): Promise<void> {
    for (const [key, token] of this.cache) {
      void token;
      const [projectId, environment] = key.split(':');
      try {
        const environmentId = await this.environmentId(projectId!, environment!);
        const listing = await this.transport.graphql<{ projectTokens: { edges: { node: { id: string; name: string; environmentId: string } }[] } }>({
          operation: 'projectTokens',
          credential: this.workspaceCredential,
          query: 'query ($projectId: String!) { projectTokens(projectId: $projectId) { edges { node { id name environmentId } } } }',
          variables: { projectId },
        });
        const mine = listing.projectTokens.edges.filter((e) => e.node.environmentId === environmentId && e.node.name === `${this.tokenName}-${environment}`);
        for (const edge of mine) {
          await this.transport.graphql({
            operation: 'projectTokenDelete',
            credential: this.workspaceCredential,
            query: 'mutation ($id: String!) { projectTokenDelete(id: $id) }',
            variables: { id: edge.node.id },
          });
        }
      } catch {
        // Revocation must not mask the original failure; the caller reports leftover credentials.
      }
      this.cache.delete(key);
    }
  }

  private async environmentId(projectId: string, environment: string): Promise<string> {
    const data = await this.transport.graphql<{ project: { environments: { edges: { node: { id: string; name: string } }[] } } }>({
      operation: 'project',
      credential: this.workspaceCredential,
      query: 'query ($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }',
      variables: { projectId },
    });
    const found = data.project.environments.edges.find((e) => e.node.name === environment);
    if (!found) throw new Error(`railway: project "${projectId}" has no environment "${environment}"`);
    return found.node.id;
  }
}
