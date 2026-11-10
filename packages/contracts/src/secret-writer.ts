import { z } from 'zod';

/**
 * Write-once secrets (D32, issue #93).
 *
 * platfolio is the management interface, so it must be able to place a secret the tenant just supplied into
 * the tenant's execution plane. What it must never be able to do is keep one or fetch it again. That is why
 * this module has **no read method at all** and why the only thing it can ask about an existing secret is
 * whether one exists.
 *
 * GitHub's Actions API enforces the second half: `GET /actions/secrets/{name}` returns metadata and a
 * 204/404, never a value. Railway does not -- its variables are readable -- so the writer that matters here
 * is deliberately narrow, and the keys-only rule on the provider side stays a tested constraint rather than
 * something the platform guarantees.
 */

/** Three states, because "we could not tell" is a different answer from "not set". */
export const SecretPresenceSchema = z.enum(['set', 'missing', 'unverifiable']);
export type SecretPresence = z.infer<typeof SecretPresenceSchema>;

export interface SecretWriterConfig {
  /** Installation or user token used for this single write. Never logged, never returned. */
  token: string;
  githubApi?: string;
  fetch?: typeof globalThis.fetch;
}

export interface SecretRef {
  repo: string;
  name: string;
  /** Omitted for repository-level secrets. */
  environment?: string;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Try the alphabets GitHub actually uses, in the order it has used them, and fail with the input's shape. */
function decodeKey(sodium: { from_base64: (input: string, variant: number) => Uint8Array; base64_variants: Record<string, number> }, value: string): Uint8Array {
  // Names as the package declares them: ORIGINAL, ORIGINAL_NO_PADDING, URLSAFE, URLSAFE_NO_PADDING.
  const variants = ['ORIGINAL', 'URLSAFE', 'ORIGINAL_NO_PADDING', 'URLSAFE_NO_PADDING'] as const;
  let lastError = '';
  for (const variant of variants) {
    try {
      const alphabet = sodium.base64_variants[variant];
      if (typeof alphabet !== 'number') continue;
      const bytes = sodium.from_base64(value, alphabet);
      if (bytes.length === 32) return bytes;
      lastError = `decoded to ${String(bytes.length)} bytes with ${variant}`;
    } catch (error) {
      lastError = `${variant}: ${(error as Error).message}`;
    }
  }
  throw new Error(`public key is not a 32-byte base64 value (${lastError})`);
}

export class GithubActionsSecretWriter {
  private readonly token: string;
  private readonly api: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: SecretWriterConfig) {
    this.token = config.token;
    this.api = config.githubApi ?? 'https://api.github.com';
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  private scoped(ref: SecretRef): string {
    const base = `${this.api}/repos/${ref.repo}`;
    return ref.environment
      ? `${base}/environments/${encodeURIComponent(ref.environment)}/secrets/${ref.name}`
      : `${base}/actions/secrets/${ref.name}`;
  }

  /**
   * The public-key endpoint is scoped to the repository or environment, NOT to the secret name:
   * `/repos/{owner}/{repo}/actions/secrets/public-key`. Appending the name yields a 404 that looks like a
   * permissions problem, and a fake that accepts any URL ending in `public-key` will never notice.
   */
  private keyScope(ref: SecretRef): string {
    return ref.environment
      ? `${this.api}/repos/${ref.repo}/environments/${encodeURIComponent(ref.environment)}/secrets/public-key`
      : `${this.api}/repos/${ref.repo}/actions/secrets/public-key`;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/vnd.github+json' };
  }

  /**
   * Presence only. There is no `read`: the API cannot return a value, and an interface that offers the
   * question invites someone to implement the answer later.
   */
  async presence(ref: SecretRef): Promise<SecretPresence> {
    if (!NAME.test(ref.name)) throw new Error(`invalid secret name "${ref.name}"`);
    try {
      const response = await this.fetchImpl(this.scoped(ref), { headers: this.headers() });
      if (response.status === 204 || response.status === 200) return 'set';
      if (response.status === 404) return 'missing';
      return 'unverifiable';
    } catch {
      // A network failure is not evidence of absence: reporting "missing" here would send a tenant to
      // re-supply a secret they already set.
      return 'unverifiable';
    }
  }

  /** Encrypts with the repository's own public key and PUTs the ciphertext. Nothing here retains the value. */
  async write(ref: SecretRef, value: string): Promise<void> {
    if (!NAME.test(ref.name)) throw new Error(`invalid secret name "${ref.name}"`);
    if (typeof value !== 'string' || value.length === 0) throw new Error(`secret "${ref.name}" has no value to write`);

    const sodium = (await import('libsodium-wrappers-sumo')).default;
    await sodium.ready;
    const keyResponse = await this.fetchImpl(this.keyScope(ref), { headers: this.headers() });
    if (!keyResponse.ok) throw new Error(`cannot encrypt "${ref.name}": public-key request failed (${String(keyResponse.status)})`);
    const key = (await keyResponse.json()) as { key_id?: string; key?: string };
    if (!key.key) throw new Error(`cannot encrypt "${ref.name}": no public key returned`);

    // crypto_box_seal is libsodium's sealed box: the sender holds no key identity, and the recipient cannot
    // tell who encrypted it. This is GitHub's documented scheme for Actions secrets.
        // GitHub sends standard, padded base64; the library's default variant is not that.
    // GitHub returns the key in URL-safe base64 ('-' and '_'), not the padded standard alphabet.
    const recipientKey = decodeKey(sodium, key.key);
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), recipientKey);
    // Standard, padded alphabet: GitHub validates encrypted_value against [A-Za-z0-9+/] and rejects the
    // URL-safe form that libsodium's default emits, with a 422 that reads like a key problem.
    const encryptedValue = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
    const body = JSON.stringify({ key_id: key.key_id ?? '', encrypted_value: encryptedValue });
    const put = await this.fetchImpl(this.scoped(ref), { method: 'PUT', headers: this.headers(), body });
    if (!put.ok) {
      // GitHub's validation errors are specific ("key_id wasn't supplied") and a status code alone sent me
      // guessing at a 422 for ten minutes. Never include the request body: it is ciphertext, but the value
      // it protects must not be reconstructible from anything we log.
      const detail = await put.text().catch(() => '');
      const message = detail.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`secret "${ref.name}" was not written (${String(put.status)})${message ? `: ${message}` : ''}`);
    }
  }

  /** Rotation path: delete so the tenant can supply a fresh value. Rebinding is delete + write, never replay. */
  async remove(ref: SecretRef): Promise<void> {
    const response = await this.fetchImpl(this.scoped(ref), { method: 'DELETE', headers: this.headers() });
    if (response.status !== 204 && response.status !== 404) throw new Error(`secret "${ref.name}" was not removed (${String(response.status)})`);
  }
}
