import { API_CLIENT_ID, REQUIRED_SCOPE, WEB_CLIENT_ID } from '../../../packages/ui/src/web/browser-auth-policy.ts';
import { accountProfileMappers, browserClientMappers, keycloakAccountClient, keycloakManageOwnAccount } from '../../../scripts/keycloak-browser-client.ts';
import { operatorDisplayName, operatorAvatar } from './operator-profile.ts';

const apiScope = browserClientMappers(true).find(({ config }) => config['claim.name'] === 'scope');
if (!apiScope) throw new Error('Platfolio browser scope mapper is missing');

process.stdout.write(JSON.stringify({
  apiClientId: API_CLIENT_ID,
  apiRole: REQUIRED_SCOPE,
  webClientId: WEB_CLIENT_ID,
  accountClientId: keycloakAccountClient,
  accountRole: keycloakManageOwnAccount,
  apiScope,
  accountMappers: accountProfileMappers(),
  displayName: operatorDisplayName,
  avatar: operatorAvatar,
}));
