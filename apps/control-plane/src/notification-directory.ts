import { EmailAddressSchema } from '@platfolio/contracts';

export interface NotificationDirectory {
  issuer: string;
  verifiedPrimary(subject: string): Promise<string | undefined>;
}

export function keycloakNotificationDirectory(issuer: string, client: string, secret: string, request: typeof fetch): NotificationDirectory {
  const url = new URL(issuer);
  const [, base, realm] = /^(.*)\/realms\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname) ?? [];
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!realm || !client || !secret || url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) throw new Error('Check the notification directory issuer and service client');
  const tokenUrl = new URL(`${base}/realms/${realm}/protocol/openid-connect/token`, url);
  const users = `${base}/admin/realms/${realm}/users/`;
  const unavailable = () => new Error('The notification identity directory is unavailable');
  let cached: { value: string; expiresAt: number } | undefined;
  let authenticating: Promise<string> | undefined;

  async function authenticate() {
    const response = await request(tokenUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: secret, scope: 'kc-admin-api' }),
    });
    if (!response.ok) throw unavailable();
    const result = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof result.access_token !== 'string' || typeof result.expires_in !== 'number' || result.expires_in < 1) throw unavailable();
    cached = { value: result.access_token, expiresAt: Date.now() + Math.min(60, result.expires_in - 1) * 1000 };
    return cached.value;
  }

  return {
    issuer,
    async verifiedPrimary(subject) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,254}$/.test(subject)) return;
      const credential = cached && Date.now() < cached.expiresAt ? cached.value :
        await (authenticating ??= authenticate().finally(() => { authenticating = undefined; }));
      const response = await request(new URL(users + encodeURIComponent(subject), url), {
        redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${credential}`, accept: 'application/json' },
      });
      if (response.status === 404) return;
      if (response.status === 401) cached = undefined;
      if (!response.ok) throw unavailable();
      const user = await response.json() as { id?: unknown; enabled?: unknown; email?: unknown; emailVerified?: unknown };
      if (user.id !== subject || user.enabled !== true || user.emailVerified !== true) return;
      const address = EmailAddressSchema.safeParse(user.email);
      return address.success ? address.data : undefined;
    },
  };
}
