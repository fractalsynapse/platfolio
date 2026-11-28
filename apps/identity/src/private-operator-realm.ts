import { API_CLIENT_ID, CALLBACK_PATH, REQUIRED_SCOPE, WEB_CLIENT_ID } from '../../../packages/ui/src/web/browser-auth-policy.ts';
import { accountProfileMappers, browserClientMappers, browserClientShape, keycloakAccountClient, keycloakManageOwnAccount } from '../../../scripts/keycloak-browser-client.ts';
import { installationOwnerHash } from '../../../packages/ui/src/web/installation-owner-policy.ts';
import { passwordResetAttributes } from './password-recovery.ts';
import { operatorProfileComponents } from './operator-profile.ts';

const siteOrigin = '${PLATFOLIO_SITE_ORIGIN}';
const passwordRecovery = process.argv.includes('--password-recovery');
const verifier = process.argv.includes('--owner-verifier');
const ownerCredential = verifier ? {
  type: 'password',
  credentialData: JSON.stringify({ algorithm: installationOwnerHash.algorithm, hashIterations: installationOwnerHash.iterations, additionalParameters: {} }),
  secretData: JSON.stringify({ value: '${PLATFOLIO_INSTALL_OWNER_VERIFIER}', salt: '${PLATFOLIO_INSTALL_OWNER_SALT}', additionalParameters: {} }),
} : { type: 'password', value: '${PLATFOLIO_INSTALL_OWNER_PASSWORD}', temporary: false };
const realm = {
  realm: 'platfolio',
  displayName: 'Platfolio',
  enabled: true,
  loginTheme: 'platfolio',
  sslRequired: 'external',
  registrationAllowed: false,
  resetPasswordAllowed: passwordRecovery,
  ...(passwordRecovery ? { attributes: passwordResetAttributes, smtpServer: {
    host: '${PLATFOLIO_SMTP_HOST}', port: '${PLATFOLIO_SMTP_PORT}', from: '${PLATFOLIO_EMAIL_FROM}',
    fromDisplayName: 'Platfolio', auth: 'true', authType: 'basic', starttls: 'true', ssl: 'false',
    user: '${PLATFOLIO_SMTP_USER}', password: '${PLATFOLIO_SMTP_PASSWORD}',
  } } : {}),
  duplicateEmailsAllowed: false,
  loginWithEmailAllowed: true,
  editUsernameAllowed: true,
  verifyEmail: false,
  components: operatorProfileComponents,
  clients: [
    { clientId: API_CLIENT_ID, enabled: true, protocol: 'openid-connect', bearerOnly: true,
      publicClient: false, standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false },
    { ...browserClientShape([]), redirectUris: [siteOrigin + CALLBACK_PATH], webOrigins: [siteOrigin],
      protocolMappers: [...browserClientMappers(true), ...accountProfileMappers()] },
  ],
  roles: { client: { [API_CLIENT_ID]: [{ name: REQUIRED_SCOPE, clientRole: true }] } },
  clientScopeMappings: {
    [API_CLIENT_ID]: [{ client: WEB_CLIENT_ID, roles: [REQUIRED_SCOPE] }],
    [keycloakAccountClient]: [{ client: WEB_CLIENT_ID, roles: [keycloakManageOwnAccount] }],
  },
  users: [{ id: '${PLATFOLIO_INSTALL_OWNER_SUBJECT}', username: 'owner', firstName: 'Private', lastName: 'Owner', email: '${PLATFOLIO_INSTALL_OWNER_EMAIL}',
    enabled: true, emailVerified: false, clientRoles: {
      [API_CLIENT_ID]: [REQUIRED_SCOPE], [keycloakAccountClient]: [keycloakManageOwnAccount],
    },
    ...(verifier ? { requiredActions: [installationOwnerHash.requiredAction] } : {}), credentials: [ownerCredential] }],
};

process.stdout.write(JSON.stringify(realm) + '\n');
