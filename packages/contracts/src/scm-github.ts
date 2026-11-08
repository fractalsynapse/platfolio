import { z } from 'zod';

/**
 * The source-control seam (D22). GitHub Apps and personal tokens differ in *custody*, not in the
 * product, so both sit behind one interface and one conformance suite and the rest of platfolio never
 * learns which it is talking to.
 *
 * Only the parts that need no network are implemented here: the app manifest, the registration round
 * trip and the install URL. The operations that require a real installation and real credentials
 * advertise themselves as unsupported rather than pretending -- the same discipline as the Railway
 * provider. The exact redirect shape is pending E19; these types are the shape we will test against.
 */

export const AppPermissionsSchema = z.object({
  metadata: z.literal('read'),
  contents: z.literal('write'),
  pull_requests: z.literal('write'),
  workflows: z.literal('write'),
  actions: z.literal('read'),
  environments: z.literal('write'),
  secrets: z.literal('write'),
  statuses: z.literal('write'),
  checks: z.literal('write'),
}).strict();

/** What platfolio asks GitHub for. Kept one line per capability so a widening is a visible diff. */
export const DEFAULT_APP_PERMISSIONS = {
  metadata: 'read', contents: 'write', pull_requests: 'write', workflows: 'write',
  actions: 'read', environments: 'write', secrets: 'write', statuses: 'write', checks: 'write',
} as const satisfies z.infer<typeof AppPermissionsSchema>;

export const RegistrationConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  /** Where GitHub hands the one-time code back. Must be reachable by the operator's browser. */
  callbackUrl: z.string().url(),
  setupUrl: z.string().url().optional(),
  description: z.string().min(1).default('Managed hosting control plane'),
  permissions: z.record(z.string(), z.string()).default({ ...DEFAULT_APP_PERMISSIONS }),
  /** v1 needs no inbound webhooks: connect reconciles by polling installations. */
  webhookActive: z.boolean().default(false),
}).strict();

export interface ScmDescriptor {
  kind: 'github-app' | 'github-pat';
  contract: string;
  operations: string[];
}

export interface ScmProvider {
  describe(): ScmDescriptor;
  appManifest?(config: z.input<typeof RegistrationConfigSchema>): Record<string, unknown>;
  registrationUrl?(config: z.input<typeof RegistrationConfigSchema>, state: string): string;
  consumeRegistrationCallback?(query: Record<string, string>, expectedState: string): { code: string };
  installUrl?(appSlug: string): string;
  listInstallations?(): Promise<unknown[]>;
  openInstallPullRequest?(): Promise<never>;
  dispatchWorkflow?(): Promise<never>;
  putEnvironmentSecret?(): Promise<never>;
  ensureEnvironment?(): Promise<never>;
}

export class GithubAppProvider implements ScmProvider {
  describe(): ScmDescriptor {
    return {
      kind: 'github-app',
      contract: '1.0.0',
      // Only the credential-free operations are advertised until a real installation exists.
      operations: ['appManifest', 'registrationUrl', 'consumeRegistrationCallback', 'installUrl'],
    };
  }

  appManifest(configInput: z.input<typeof RegistrationConfigSchema>): Record<string, unknown> {
    const c = RegistrationConfigSchema.parse(configInput);
    return {
      name: c.name,
      url: c.url,
      description: c.description,
      // GitHub's manifest shape: hook_attributes carries the webhook URL; v1 registers none it depends on.
      hook_attributes: { url: c.callbackUrl },
      redirect_url: c.callbackUrl,
      callback_urls: [c.callbackUrl],
      ...(c.setupUrl ? { setup_url: c.setupUrl } : {}),
      public: false,
      default_permissions: 'read',
      permissions: c.permissions,
      events: [],
      single_file_permissions: false,
      request_verification: false,
      // Recorded so a reviewer can see that nothing in v1 waits on an inbound delivery.
      webhook_active: c.webhookActive,
    };
  }

  registrationUrl(config: z.input<typeof RegistrationConfigSchema>, state: string): string {
    if (!/^[A-Za-z0-9._-]{16,}$/.test(state)) throw new Error('state must be an unguessable CSRF token');
    const manifest = Buffer.from(JSON.stringify(this.appManifest(config)), 'utf8').toString('base64url');
    return `https://github.com/settings/apps/new?manifest=${manifest}&socket=${encodeURIComponent(state)}`;
  }

  consumeRegistrationCallback(query: Record<string, string>, expectedState: string): { code: string } {
    if (query['socket'] !== expectedState && query['state'] !== expectedState) {
      throw new Error('registration callback state does not match the value we issued');
    }
    const code = query['code'];
    if (!code) throw new Error('registration callback carried no one-time code');
    return { code };
  }

  installUrl(appSlug: string): string {
    if (!/^[a-z0-9-]+$/i.test(appSlug)) throw new Error(`invalid app slug "${appSlug}"`);
    return `https://github.com/apps/${appSlug}/installations/new`;
  }

  async listInstallations(): Promise<unknown[]> {
    throw new Error('listInstallations requires app credentials: E19 wires this against a real installation');
  }
}

/** Self-hosters who will not install an App: same interface, personal credential, fewer operations. */
export class GithubPatProvider implements ScmProvider {
  describe(): ScmDescriptor {
    return { kind: 'github-pat', contract: '1.0.0', operations: ['installUrl'] };
  }
  installUrl(): string {
    throw new Error('a personal token has no app to install; use the App path for installation consent');
  }
}
