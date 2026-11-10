import { createSign, randomUUID } from 'node:crypto';
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

/**
 * Local registration (issue #113, M2). GitHub's own tutorial uses `http://localhost:4567/...` as an app
 * callback URL, so a localhost registration is supported and no tunnel is required for the flow platfolio
 * actually needs -- installation authentication. Two facts drove the shape:
 *
 * - the manifest flow must be a **POST** to `github.com/settings/apps/new`; a GET link with `?manifest=`
 *   (which is what the earlier helper produced) is not the documented flow, and
 * - `hook_attributes.url` is documented as required *when the object is present*, so local mode can either
 *   omit webhooks entirely or point them at a forwarding service like smee.io. platfolio polls installations
 *   (D: no inbound webhook in v1), so an inactive or absent webhook is not a degraded setup.
 */
export interface LocalManifestOptions {
  port: number;
  hostname?: string;
  /** A publicly reachable webhook target (for example a smee.io channel). Omit to register without one. */
  webhookUrl?: string;
  name?: string;
  description?: string;
  org?: string;
}

export function localDevManifest(options: LocalManifestOptions): Record<string, unknown> {
  const origin = `http://${options.hostname ?? 'localhost'}:${String(options.port)}`;
  return {
    name: options.name ?? 'platfolio (local)',
    url: origin,
    description: options.description ?? 'Managed hosting control plane -- local development registration',
    public: false,
    callback_urls: [`${origin}/platfolio/callback`],
    redirect_url: `${origin}/platfolio/callback`,
    ...(options.webhookUrl ? { hook_attributes: { url: options.webhookUrl, active: false } } : {}),
    default_permissions: { ...DEFAULT_APP_PERMISSIONS },
    // No events: an app that polls does not need deliveries to fail against a laptop, and an inactive
    // webhook with subscribed events just produces redelivery noise in the tenant's UI.
    default_events: [],
    request_oauth_on_install: false,
    single_file_permissions: false,
  };
}

/** Where GitHub wants the POST, and the state it must echo back. */
export function localManifestTarget(org?: string): string {
  return org ? `https://github.com/organizations/${org}/settings/apps/new` : 'https://github.com/settings/apps/new';
}

/**
 * Exchange the one-time manifest code for the app's credentials. Documented as requiring no authentication
 * -- reasonable, since the app does not exist until this call succeeds -- though GitHub does not state it
 * in the imperative, so this is the one inference here and a 401 would be evidence against it rather than a
 * mystery. The values are returned and written by the caller to a 0600 file; they are never logged.
 */
export async function exchangeManifestCode(code: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<{
  appId: number; slug: string; clientId: string; clientSecret: string; webhookSecret: string; privateKeyPem: string;
}> {
  if (!/^[0-9a-f]{20,}$/i.test(code)) throw new Error('manifest code is not well-formed');
  const response = await fetchImpl(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'platfolio' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`manifest exchange failed (${String(response.status)})`);
  const body = await response.json() as Record<string, unknown>;
  const missing = ['id', 'slug', 'client_id', 'client_secret', 'webhook_secret', 'pem'].filter((k) => typeof body[k] !== 'string' && typeof body[k] !== 'number');
  if (missing.length) throw new Error(`manifest exchange response missing ${missing.join(', ')}`);
  return {
    appId: Number(body.id),
    slug: String(body.slug),
    clientId: String(body.client_id),
    clientSecret: String(body.client_secret),
    webhookSecret: String(body.webhook_secret),
    privateKeyPem: String(body.pem),
  };
}

/**
 * The RS256 JWT that authenticates the app itself (short-lived, `exp` <= 10 minutes per GitHub's docs).
 * Only needed to read installations and mint installation tokens -- which is exactly the least-privilege
 * boundary D25 claims, so the mechanism has to live in the contract layer where it can be tested.
 */
export function createAppJwt(input: { appId: number | string; privateKeyPem: string; now?: number; ttlSeconds?: number }): string {
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const ttl = input.ttlSeconds ?? 240;
  if (ttl > 600) throw new Error('app JWTs must expire within 10 minutes');
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: issuedAt, exp: issuedAt + ttl, iss: String(input.appId), jti: randomUUID() };
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(input.privateKeyPem).toString('base64url');
  return `${signingInput}.${signature}`;
}
