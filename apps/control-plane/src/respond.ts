import fs from 'node:fs';
import path from 'node:path';
import { loadSpec, validateResponse, type SpecDocument } from '@platfolio/api-contract';
import { redactCredentialShaped, type VerificationFailure, type VerifiedClaims } from '@platfolio/contracts';

/**
 * Response construction, with the OpenAPI document as the gate (D41).
 *
 * Validation happens *here*, in the path every response takes, not only in a test that happens to exercise a
 * handler. A 200 whose body does not match its declared schema would otherwise reach a client that trusts the
 * document, and the document is supposed to be the thing that is checked.
 */

const specPath = path.resolve(import.meta.dirname, '../../../api/control-plane.openapi.yaml');
let cachedSpec: SpecDocument | undefined;
export function spec(): SpecDocument {
  cachedSpec ??= loadSpec(fs.readFileSync(specPath, 'utf8'));
  return cachedSpec;
}

export type HttpResponse = { status: number; body: unknown; headers?: Record<string, string> };

export function send(operationId: string, status: number, body: unknown): HttpResponse {
  const check = validateResponse(spec(), operationId, status, body);
  if (check.ok) return { status, body };
  // The mismatch is reported, not swallowed: a silent fallback would make the gate look like it passed.
  return { status: 500, body: { error: 'response-violates-spec', message: `${operationId} ${String(status)}: ${check.errors.join('; ')}`.slice(0, 300) } };
}

export function unauthorized(reason: VerificationFailure | 'no-credentials' | string): HttpResponse {
  const code = typeof reason === 'string' ? reason : reason.code;
  const message = typeof reason === 'string' ? 'a Bearer access token is required' : reason.message;
  return {
    status: 401,
    // The refusal is redacted the same way an attestation field is: a verification message can quote a
    // malformed token, and a quoted token is a credential in a log line.
    body: { error: `unauthenticated:${code}`, message: redactCredentialShaped(message).slice(0, 200) },
    headers: { 'www-authenticate': 'Bearer realm="platfolio", error="invalid_token"' },
  };
}

export function badRequest(message: string): HttpResponse {
  return { status: 400, body: { error: 'invalid-request', message: redactCredentialShaped(message).slice(0, 200) } };
}

export function notFound(what: string, id: string): HttpResponse {
  return { status: 404, body: { error: 'not-found', message: redactCredentialShaped(`${what} ${id} not found`).slice(0, 200) } };
}

export const bearerToken = (header: string | string[] | undefined): string | undefined => {
  const value = Array.isArray(header) ? header[0] : header;
  return /^Bearer\s+(\S+)$/i.exec(value ?? '')?.[1];
};

export type Authorizer = (request: { headers: Record<string, string | string[] | undefined> }) => Promise<{ ok: true; claims: VerifiedClaims } | { ok: false; response: HttpResponse }>;
