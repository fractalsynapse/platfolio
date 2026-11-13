import { Context, Service } from 'cordis';
import { z } from 'zod';
import {
  dispatchWorkflowRun,
  readRepositoryFile,
  type RepositoryFile,
  type WorkflowDispatchResult,
} from '@platfolio/contracts';

/**
 * The source-control capability as `ctx.scm` (D22).
 *
 * Same construction rule as storage, email and the infra provider: the driver is configuration, and an
 * unconfigured deployment gets a declared absent capability rather than a crash or a fake. Unlike email --
 * whose null transport keeps the mail routes mounted -- a repository read cannot be emulated meaningfully, so
 * the driver is `none` unless a real App installation is supplied, and the API layer answers `not-configured`
 * instead of inventing an empty document.
 *
 * Custody: platfolio holds its own GitHub App id, installation id and signing key in environment configuration
 * supplied at composition. The key never crosses an endpoint, a log line, or a stored record; per-operation
 * tokens are minted narrow and revoked inside the contract implementation. D24 is about tenant secrets, but
 * applying the same discipline to platfolio's own grant is what makes holding it defensible.
 */
export const ScmConfigSchema = z.object({
  driver: z.enum(['none', 'github-app']).default('none'),
  appId: z.number().int().positive().optional(),
  /** PEM contents, not a path -- reading the file is the composition root's job, so this stays the value. */
  privateKeyPem: z.string().min(32).optional(),
  installationId: z.number().int().positive().optional(),
}).strict();
export type ScmConfig = z.infer<typeof ScmConfigSchema>;
export type ScmConfigInput = z.input<typeof ScmConfigSchema>;

export class ScmNotConfiguredError extends Error {
  readonly code = 'source-control-not-configured';
  constructor(what: string) {
    super(`cannot ${what}: the source-control capability is not configured. Set PLATFOLIO_GITHUB_APP_ID, PLATFOLIO_GITHUB_INSTALLATION_ID and PLATFOLIO_GITHUB_PRIVATE_KEY_PEM (or _PATH).`);
    this.name = 'ScmNotConfiguredError';
  }
}

export class ScmService extends Service<ScmConfig> {
  static inject = [] as const;
  static provide = 'scm' as const;
  static Config = ScmConfigSchema;

  readonly driver: ScmConfig['driver'];
  /** True only with a complete credential set. `driver: 'github-app'` with a forgotten key fails at startup. */
  readonly configured: boolean;
  private readonly appId?: number;
  private readonly privateKeyPem?: string;
  private readonly installationId?: number;

  constructor(ctx: Context, config: ScmConfig) {
    super(ctx, 'scm');
    this.driver = config.driver;
    if (config.driver === 'github-app') {
      // Actionable at boot rather than mysterious at the first read: this is exactly the email-smtp rule, and
      // the reason both services state their missing piece is that operators debug under time pressure.
      if (config.appId === undefined) throw new Error('scm driver "github-app" requires an app id (PLATFOLIO_GITHUB_APP_ID)');
      if (config.installationId === undefined) throw new Error('scm driver "github-app" requires an installation id (PLATFOLIO_GITHUB_INSTALLATION_ID)');
      if (config.privateKeyPem === undefined) throw new Error('scm driver "github-app" requires the app private key (PLATFOLIO_GITHUB_PRIVATE_KEY_PEM or _PATH)');
      this.appId = config.appId;
      this.installationId = config.installationId;
      this.privateKeyPem = config.privateKeyPem;
      this.configured = true;
    } else {
      this.configured = false;
    }
  }

  /** What an operator needs to see to fix a misconfiguration. Never the key, never a token. */
  describe(): { driver: ScmConfig['driver']; configured: boolean } {
    return { driver: this.driver, configured: this.configured };
  }

  /** One file at one ref. `RepositoryReadError` propagates with its kind intact -- callers map it, never re-derive it. */
  async readFile(input: { repo: string; ref: string; path: string }): Promise<RepositoryFile> {
    if (!this.configured) throw new ScmNotConfiguredError(`read ${input.repo}@${input.ref}:${input.path}`);
    return readRepositoryFile({ appId: this.appId!, privateKeyPem: this.privateKeyPem!, installationId: this.installationId!, ...input });
  }

  async dispatchWorkflow(input: { repo: string; workflow: string; ref: string; inputs: Record<string, string> }): Promise<WorkflowDispatchResult> {
    if (!this.configured) throw new ScmNotConfiguredError(`dispatch ${input.workflow} in ${input.repo}`);
    return dispatchWorkflowRun({ appId: this.appId!, privateKeyPem: this.privateKeyPem!, installationId: this.installationId!, ...input });
  }
}

declare module 'cordis' {
  interface Context {
    readonly scm: ScmService;
  }
}
