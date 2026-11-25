import { API_CLIENT_ID, CALLBACK_PATH, PKCE_METHOD, WEB_CLIENT_ID } from '../packages/ui/src/web/browser-auth-policy.ts';

/**
 * The field that makes PKCE MANDATORY is a client ATTRIBUTE, not a representation field.
 *
 * Measured on Keycloak 26.8.2: a `PUT /admin/realms/{realm}/clients/{id}` carrying a top-level
 * `pkceCodeChallengeMethod` is refused outright -- `Invalid json representation for ClientRepresentation.
 * Unrecognized field "pkceCodeChallengeMethod"` -- while `attributes["pkce.code.challenge.method"] = "S256"`
 * persists, reads back, and is enforced at `/auth`. The Server Administration Guide calls the control
 * "PKCE method" with values blank | S256 | plain, and blank means "PKCE is possible but not required" -- which
 * is exactly the bug this constant exists to make impossible.
 */
export const PKCE_CHALLENGE_ATTRIBUTE = 'pkce.code.challenge.method';

/* ------------------------------------------------------------------ the client shape */

export interface BrowserClientShape {
  clientId: string;
  name: string;
  description: string;
  enabled: boolean;
  protocol: 'openid-connect';
  publicClient: boolean;
  bearerOnly: boolean;
  standardFlowEnabled: boolean;
  implicitFlowEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  serviceAccountsEnabled: boolean;
  frontchannelLogout: boolean;
  redirectUris: string[];
  webOrigins: string[];
  attributes: Record<string, string>;
  fullScopeAllowed: boolean;
}

export interface ProtocolMapperShape {
  name: string;
  protocol: 'openid-connect';
  protocolMapper: string;
  consentRequired: boolean;
  config: Record<string, string>;
}

/** Origins must be origins, and only https or loopback http may receive an authorization code. */
export function normalizeUiOrigins(raw: readonly string[]): string[] {
  const origins = [...new Set(raw.flatMap((o) => o.split(',')).map((o) => o.trim().replace(/\/$/, '')).filter(Boolean))];
  for (const o of origins) {
    const url = new URL(o);
    const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.protocol !== 'https:' && !loopback) {
      throw new Error(`UI origin "${o}" is neither https nor loopback http: a redirect URI over cleartext hands the authorization code to anyone on the path`);
    }
    if (url.search || url.hash) {
      throw new Error(`UI origin "${o}" must be an origin (scheme://host[:port]); the redirect URI is derived as <origin>${CALLBACK_PATH}`);
    }
  }
  return origins;
}

/**
 * The public PKCE client, derived from the UI origins that may sign in.
 *
 * Every boolean here is a refusal the token endpoint later performs, and `smoke-browser-auth.ts` measures each
 * one rather than trusting this object:
 *  - `directAccessGrantsEnabled: false` -- ROPC hands a password to whoever holds the client credentials, and
 *    for a public client that is every visitor of the site. Measured refusal: `400 unauthorized_client /
 *    Client not allowed for direct access grants`.
 *  - `serviceAccountsEnabled: false` -- client credentials is a machine grant; a browser has no machine to
 *    assert. Measured: `401 Public client not allowed to retrieve service account`.
 *  - `implicitFlowEnabled: false` -- tokens in a URL fragment reach history, logs and referrers.
 *  - `fullScopeAllowed: false` plus one explicit role-scope mapping -- the token carries one capability instead
 *    of every role in the realm.
 *  - No `secret`, and `clientAuthenticatorType` is left at the server default: it is inert while
 *    `publicClient` is true (measured: the Admin API read-back carries no `secret` field at all, and
 *    `GET /clients/{id}/client-secret` answers `{"type":"secret"}` with no value).
 *
 * Redirect URIs are EXACT -- `<origin>${CALLBACK_PATH}`, never `<origin>/*`. Keycloak's pattern match honours a
 * trailing wildcard, which is why it must not be used here: a wildcard turns the client into an
 * authorization-code delivery oracle for any path on that host, and `docs/design/05-identity.md` already lists
 * "no wildcard redirect URIs" among the controls to implement.
 */
export function browserClientShape(uiOrigins: readonly string[]): BrowserClientShape {
  const origins = normalizeUiOrigins(uiOrigins);
  return {
    clientId: WEB_CLIENT_ID,
    name: 'platfolio web (browser)',
    description: `The platfolio browser UI. Public client: PKCE (${PKCE_METHOD}) is mandatory and there is no secret.`,
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    bearerOnly: false,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    // No ROPC for a public client -- the point of this whole shape, said twice on purpose.
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    frontchannelLogout: true,
    redirectUris: origins.map((o) => `${o}${CALLBACK_PATH}`),
    webOrigins: origins,
    attributes: { [PKCE_CHALLENGE_ATTRIBUTE]: PKCE_METHOD },
    fullScopeAllowed: false,
  };
}

/**
 * The two claims that make a browser-minted token usable by the API.
 *
 * Audience is the RESOURCE (`platfolio-api`) while `azp` stays the browser client, and that asymmetry is the
 * security property: the control plane can tell a person's session from a machine's grant in every audit row,
 * and neither token substitutes for the other.
 */
export function browserClientMappers(): ProtocolMapperShape[] {
  return [
    {
      name: 'platfolio-web-audience',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-audience-mapper',
      consentRequired: false,
      config: {
        // `included.client.audience` is deliberately absent: it resolves only when the user holds a role in
        // that client, which puts a second condition on a claim that must always hold. A custom audience is
        // unconditional.
        'included.custom.audience': API_CLIENT_ID,
        'access.token.claim': 'true',
        'id.token.claim': 'false',
      },
    },
    {
      name: 'platfolio-web-scopes',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-usermodel-client-role-mapper',
      consentRequired: false,
      config: {
        // Read the roles of the RESOURCE client. `platfolio.user` is one role, held once, asserted by both the
        // machine path and the browser path; a second role with a second name would be a second thing to
        // revoke. Measured: with `fullScopeAllowed: false` and the matching role-scope mapping, the access
        // token carries `scope: ["platfolio.user"]`.
        'usermodel.clientRoleMapping.clientId': API_CLIENT_ID,
        'claim.name': 'scope',
        'jsonType.label': 'String',
        multivalued: 'true',
        'access.token.claim': 'true',
        'id.token.claim': 'false',
      },
    },
  ];
}
