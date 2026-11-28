import { createHmac, pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
import { installationOwnerHash } from '../../../packages/ui/src/web/installation-owner-policy.ts';
import type { InstallationEnvironment } from '../../../packages/contracts/src/installation-provider.ts';
import type { InstallationJournal } from '../../../packages/contracts/src/installation-journal.ts';

const derive = promisify(pbkdf2);
type Owner = Pick<InstallationJournal, 'id' | 'teamId' | 'personId'>;

export function installationBootstrap(key: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(key)) throw new Error('Use a generated Hub installation bootstrap key');
  function material(label: string, owner: Owner, environment: InstallationEnvironment) {
    return createHmac('sha256', key).update(JSON.stringify([label, owner.teamId, owner.personId, owner.id, environment])).digest();
  }
  const password = (owner: Owner, environment: InstallationEnvironment) => material('owner-password-v1', owner, environment).toString('base64url');
  return {
    password,
    async verifier(owner: Owner, environment: InstallationEnvironment) {
      const { bits, iterations, saltBytes } = installationOwnerHash;
      const salt = material('owner-salt-v1', owner, environment).subarray(0, saltBytes);
      const verifier = await derive(password(owner, environment), salt, iterations, bits / 8, 'sha256');
      return { verifier: verifier.toString('base64'), salt: salt.toString('base64') };
    },
  };
}
