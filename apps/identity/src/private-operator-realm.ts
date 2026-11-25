import { API_CLIENT_ID, CALLBACK_PATH, REQUIRED_SCOPE, WEB_CLIENT_ID } from '../../../packages/ui/src/web/browser-auth-policy.ts';
import { browserClientMappers, browserClientShape } from '../../../scripts/keycloak-browser-client.ts';

const siteOrigin = '${PLATFOLIO_SITE_ORIGIN}';
const realm = {
  realm: 'platfolio',
  displayName: 'Platfolio',
  enabled: true,
  loginTheme: 'platfolio',
  sslRequired: 'external',
  registrationAllowed: false,
  duplicateEmailsAllowed: false,
  loginWithEmailAllowed: true,
  verifyEmail: false,
  clients: [
    { clientId: API_CLIENT_ID, enabled: true, protocol: 'openid-connect', bearerOnly: true,
      publicClient: false, standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false },
    { ...browserClientShape([]), redirectUris: [siteOrigin + CALLBACK_PATH], webOrigins: [siteOrigin], protocolMappers: browserClientMappers() },
  ],
  roles: { client: { [API_CLIENT_ID]: [{ name: REQUIRED_SCOPE, clientRole: true }] } },
  clientScopeMappings: { [API_CLIENT_ID]: [{ client: WEB_CLIENT_ID, roles: [REQUIRED_SCOPE] }] },
  users: [{ username: 'owner', firstName: 'Private', lastName: 'Owner', email: '${PLATFOLIO_INSTALL_OWNER_EMAIL}',
    enabled: true, emailVerified: false, clientRoles: { [API_CLIENT_ID]: [REQUIRED_SCOPE] },
    credentials: [{ type: 'password', value: '${PLATFOLIO_INSTALL_OWNER_PASSWORD}', temporary: false }] }],
};

process.stdout.write(JSON.stringify(realm) + '\n');
