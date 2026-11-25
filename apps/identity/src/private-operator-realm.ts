import { API_CLIENT_ID, CALLBACK_PATH, REQUIRED_SCOPE, WEB_CLIENT_ID } from '../../../packages/ui/src/web/browser-auth-policy.ts';
import { browserClientMappers, browserClientShape } from '../../../scripts/keycloak-browser-client.ts';
import { passwordResetAttributes } from './password-recovery.ts';

const siteOrigin = '${PLATFOLIO_SITE_ORIGIN}';
const passwordRecovery = process.argv.includes('--password-recovery');
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
  verifyEmail: false,
  clients: [
    { clientId: API_CLIENT_ID, enabled: true, protocol: 'openid-connect', bearerOnly: true,
      publicClient: false, standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false },
    { ...browserClientShape([]), redirectUris: [siteOrigin + CALLBACK_PATH], webOrigins: [siteOrigin], protocolMappers: browserClientMappers() },
  ],
  roles: { client: { [API_CLIENT_ID]: [{ name: REQUIRED_SCOPE, clientRole: true }] } },
  clientScopeMappings: { [API_CLIENT_ID]: [{ client: WEB_CLIENT_ID, roles: [REQUIRED_SCOPE] }] },
  users: [{ id: '${PLATFOLIO_INSTALL_OWNER_SUBJECT}', username: 'owner', firstName: 'Private', lastName: 'Owner', email: '${PLATFOLIO_INSTALL_OWNER_EMAIL}',
    enabled: true, emailVerified: false, clientRoles: { [API_CLIENT_ID]: [REQUIRED_SCOPE] },
    credentials: [{ type: 'password', value: '${PLATFOLIO_INSTALL_OWNER_PASSWORD}', temporary: false }] }],
};

process.stdout.write(JSON.stringify(realm) + '\n');
