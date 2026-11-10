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
  /**
   * Held so platfolio can create the repository environments it manages secrets for, and so it can create
   * tenant repositories in an organization. Measured: `PUT …/environments/{name}` answers 403 with
   * `environments: write` alone, and requesting `administration` on a token that lacks it answers 422 -- so
   * this grant is not optional for the capability, it is the only door. Accepted as D35 on the maintainer's
   * decision that a control plane which cannot create a tenant's environments is not a control plane.
   *
   * Compensating controls, both already true of the write path: runtime tokens are minted per operation with
   * the narrowest permission subset that works (measured: requesting contents/workflows/pull_requests yields
   * exactly that) and are revoked at the end of the call; and OAuth/user consent remains outside platfolio.
   *
   * GitHub recommends the narrower `repository_creation` permission when creating repositories is all an app
   * needs. Its manifest parameter name cannot be validated from outside a registration -- GitHub answers the
   * identical 422 for an unknown permission and an ungranted one -- so it is NOT requested here, and the
   * narrowing attempt is filed as a follow-up rather than risk breaking registration on an unproven key.
   */
  administration: z.literal('write'),
}).strict();

/** What platfolio asks GitHub for. Kept one line per capability so a widening is a visible diff. */
export const DEFAULT_APP_PERMISSIONS = {
  metadata: 'read', contents: 'write', pull_requests: 'write', workflows: 'write',
  actions: 'read', environments: 'write', secrets: 'write', statuses: 'write', checks: 'write',
  // D35: environments and tenant repositories. See AppPermissionsSchema for why no narrower grant works.
  administration: 'write',
} as const satisfies z.infer<typeof AppPermissionsSchema>;

export const RegistrationConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  /** Where GitHub hands the one-time code back. Must be reachable by the operator's browser. */
  callbackUrl: z.string().url(),
  /**
   * A webhook target that can actually receive deliveries -- a public host, or a smee.io channel while
   * developing. Omitted means the app registers with no webhook at all, which is correct for v1.
   */
  webhookUrl: z.string().url().optional(),
  /** Register under an organization rather than a personal account. */
  org: z.string().min(1).optional(),
  setupUrl: z.string().url().optional(),
  description: z.string().min(1).default('Managed hosting control plane'),
  permissions: z.record(z.string(), z.string()).default({ ...DEFAULT_APP_PERMISSIONS }),
  /** v1 needs no inbound webhooks: connect reconciles by polling installations. */
  webhookActive: z.boolean().default(false),
}).strict();

/**
 * GitHub's manifest keys, exactly as documented -- nothing else. Enforced by a strict schema because GitHub's
 * rejection is one opaque line ("`single_file_permissions` is not a permitted key") naming only the **first**
 * offender: three invented keys were shipped here before any could be observed, and `default_permissions` was
 * a string where the docs define an object. An unknown key must fail locally, not in a browser screenshot.
 *
 * Source: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */
export const MANIFEST_KEYS = [
  'name', 'url', 'hook_attributes', 'redirect_url', 'callback_urls', 'setup_url', 'description',
  'public', 'default_events', 'default_permissions', 'request_oauth_on_install', 'setup_on_update',
] as const;

const PermissionAccess = z.enum(['read', 'write', 'admin']);

export const AppManifestSchema = z.object({
  name: z.string().min(1).optional(),
  /** Required by GitHub: the app's homepage. */
  url: z.string().url(),
  /**
   * Omit rather than point at a host that cannot answer. GitHub requires `url` *inside* this object, which
   * is why an unused webhook is absent here instead of present and empty.
   */
  hook_attributes: z.object({ url: z.string().url(), active: z.boolean().default(true) }).strict().optional(),
  redirect_url: z.string().url().optional(),
  callback_urls: z.array(z.string().url()).max(10).optional(),
  setup_url: z.string().url().optional(),
  description: z.string().min(1).optional(),
  public: z.boolean().optional(),
  default_events: z.array(z.string().min(1)).optional(),
  default_permissions: z.record(z.string(), PermissionAccess).optional(),
  request_oauth_on_install: z.boolean().optional(),
  setup_on_update: z.boolean().optional(),
}).strict();
export type AppManifest = z.infer<typeof AppManifestSchema>;

/** The only exit for a manifest: validated against the documented key set before anything sees it. */
export function buildAppManifest(candidate: Record<string, unknown>): AppManifest {
  const parsed = AppManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`invalid GitHub App manifest -- ${detail}. Permitted keys: ${MANIFEST_KEYS.join(', ')}.`);
  }
  if (parsed.data.callback_urls && !parsed.data.redirect_url) {
    throw new Error('invalid GitHub App manifest -- callback_urls without redirect_url leaves the one-time code nowhere to land');
  }
  return parsed.data;
}

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

  appManifest(configInput: z.input<typeof RegistrationConfigSchema>): AppManifest {
    const c = RegistrationConfigSchema.parse(configInput);
    return buildAppManifest({
      name: c.name,
      url: c.url,
      description: c.description,
      // Webhooks are registered only when something can answer them. v1 polls installations, so the default
      // is to omit the object entirely rather than accumulate failed deliveries in the tenant's UI.
      ...(c.webhookUrl ? { hook_attributes: { url: c.webhookUrl, active: false } } : {}),
      redirect_url: c.callbackUrl,
      callback_urls: [c.callbackUrl],
      ...(c.setupUrl ? { setup_url: c.setupUrl } : {}),
      public: false,
      // `default_permissions` is the documented object of permission-name to access level. This used to be
      // `default_permissions: 'read'` with a separate `permissions` map, neither of which GitHub accepts --
      // a shape invented before anything was checked against the schema.
      default_permissions: c.permissions,
      default_events: [],
      request_oauth_on_install: false,
    });
  }

  /**
   * The POST target for the manifest flow. GitHub's docs describe a link that **sends a POST** with the
   * manifest as a form field; a GET with `?manifest=<base64>` is not the flow, and produced the "not a valid
   * manifest" page we hit. `state` rides in the query, exactly as the documented form shows.
   */
  registrationUrl(config: z.input<typeof RegistrationConfigSchema>, state: string): string {
    if (!/^[A-Za-z0-9._-]{16,}$/.test(state)) throw new Error('state must be an unguessable CSRF token');
    RegistrationConfigSchema.parse(config);
    const org = z.string().min(1).optional().parse(config.org);
    return org
      ? `https://github.com/organizations/${org}/settings/apps/new?state=${encodeURIComponent(state)}`
      : `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
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

export function localDevManifest(options: LocalManifestOptions): AppManifest {
  const origin = `http://${options.hostname ?? 'localhost'}:${String(options.port)}`;
  // Same validated exit as the hosted path: a shape mistake should surface here, not as GitHub's page.
  return buildAppManifest({
    name: options.name ?? 'platfolio (local)',
    url: origin,
    description: options.description ?? 'Managed hosting control plane -- local development registration',
    public: false,
    callback_urls: [`${origin}/platfolio/callback`],
    redirect_url: `${origin}/platfolio/callback`,
    ...(options.webhookUrl ? { hook_attributes: { url: options.webhookUrl, active: false } } : {}),
    default_permissions: { ...DEFAULT_APP_PERMISSIONS },
    // No events: a polling app needs no deliveries, and an inactive webhook with subscribed events only
    // produces redelivery noise in the tenant's UI.
    default_events: [],
    request_oauth_on_install: false,
  });
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
export interface ManifestExchangeResult {
  appId: number;
  slug: string;
  clientId: string;
  clientSecret: string;
  /**
   * Absent when the app registers with no webhook -- measured, because platfolio's local manifest omits
   * `hook_attributes`. Requiring it here turned a successful registration into a failed run.
   */
  webhookSecret?: string;
  privateKeyPem: string;
}

export async function exchangeManifestCode(code: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<ManifestExchangeResult> {
  if (!/^[0-9a-f]{20,}$/i.test(code)) throw new Error('manifest code is not well-formed');
  const response = await fetchImpl(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'platfolio' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`manifest exchange failed (${String(response.status)})`);
  const body = await response.json() as Record<string, unknown>;
  const missing = ['id', 'slug', 'client_id', 'client_secret', 'pem'].filter((k) => typeof body[k] !== 'string' && typeof body[k] !== 'number');
  if (missing.length) {
    // Key names only, never values. Without this a shape mismatch is unrecoverable, because the code has
    // already been consumed by the call that failed -- the first version of this function turned a
    // successful registration into a lost app by asserting a field GitHub does not send.
    throw new Error(`manifest exchange response missing ${missing.join(', ')} (received keys: ${Object.keys(body).sort().join(', ') || 'none'})`);
  }
  return {
    appId: Number(body.id),
    slug: String(body.slug),
    clientId: String(body.client_id),
    clientSecret: String(body.client_secret),
    ...(typeof body.webhook_secret === 'string' ? { webhookSecret: body.webhook_secret } : {}),
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

/**
 * Mint a short-lived installation access token (D25's least-privilege boundary, in code).
 *
 * Everything platfolio does *to a repository* -- the install pull request, workflow dispatch, secret writes --
 * runs on this token, not on the app credential and not on anything long-lived. Two properties matter more
 * than convenience:
 *
 * - **It can be scoped to the repositories the tenant chose.** GitHub clamps `repository_ids` to the
 *   installation's selection, so asking for a repository the app cannot see yields an error rather than a
 *   quieter, wider token.
 * - **It should be revoked when the work finishes.** One hour is GitHub's cap and our default; the caller can
 *   delete it immediately, which is why the expiry is returned instead of being assumed.
 */
export interface InstallationTokenRequest {
  appId: number;
  privateKeyPem: string;
  installationId: number;
  /** Restrict to these repository names. Omit to accept the installation's own selection. */
  repositories?: string[];
  /** Narrow the permissions to what one operation needs; GitHub clamps to the installation's grants. */
  permissions?: Record<string, 'read' | 'write'>;
  fetch?: typeof globalThis.fetch;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
  repositorySelection: string;
}

export async function createInstallationAccessToken(request: InstallationTokenRequest): Promise<InstallationToken> {
  const fetchImpl = request.fetch ?? globalThis.fetch;
  const body: Record<string, unknown> = {};
  if (request.repositories) body.repository_names = request.repositories;
  if (request.permissions) body.permissions = request.permissions;
  const response = await fetchImpl(`https://api.github.com/app/installations/${String(request.installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      // The app JWT authorizes the *request* for a token; it is never used to call repository endpoints.
      authorization: `Bearer ${createAppJwt({ appId: request.appId, privateKeyPem: request.privateKeyPem })}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'platfolio',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`installation token request failed (${String(response.status)})${detail ? `: ${detail}` : ''}`);
  }
  const data = await response.json() as { token?: string; expires_at?: string; repository_selection?: string };
  if (!data.token || !data.expires_at) throw new Error('installation token response missing token or expires_at');
  return { token: data.token, expiresAt: data.expires_at, repositorySelection: data.repository_selection ?? 'unknown' };
}

/** Delete an installation token early. Success is 204 with no body; anything else is reported. */
export async function revokeInstallationAccessToken(input: { token: string; fetch?: typeof globalThis.fetch }): Promise<void> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const response = await fetchImpl('https://api.github.com/installation/token', {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'platfolio',
    },
  });
  if (response.status !== 204 && response.status !== 401 && response.status !== 404) {
    throw new Error(`installation token revocation returned ${String(response.status)}`);
  }
}
