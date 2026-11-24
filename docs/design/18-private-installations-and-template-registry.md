
### Hosted starter launch

The customer launcher can run as a private worker in the installation project. Pass a
CI candidate, the exact installation project ID, and a private `--launch-config-file`
when applying `launch-customer-railway.ts`. Keep that file in the installation owner's
credential store. It contains the local owner team's `team` ID, the public Railway OAuth
`client` ID, and two independent random credentials named `workerKey` and
`openBaoSecret`. The latter authorize the private API relay and the OpenBao worker role,
respectively. The candidate's API image runs the worker under a separate entry point.
A persistent worker volume keeps the launch journal and the encrypted recovery receipt.

Register the installation API origin plus `/api/v1/railway/callback` as the exact
Railway OAuth callback URI. Use a public PKCE client. For a dedicated workspace,
authorize workspace administration so the worker can create a separate app project.
For an existing app, set `appProject` to the exact Starter Web Railway project ID
and authorize only that project. The worker checks its workspace, name, role marker,
environment and service placement before making changes. A project-only grant cannot
create or permanently delete a project.

The team owner generates and downloads an encryption key in the browser before
initialization. The worker returns the recovery receipt encrypted to that key. The
owner decrypts and saves the recovery file locally and confirms it in the browser.
The file contains three Shamir shares, of which two unlock the store, plus the initial
bootstrap credential. After verifying its scoped AppRole, the worker revokes that
bootstrap credential. Keep the recovery file in the owner's credential store and use
it to unlock OpenBao after a restart. The owner can recover an administrative token
from the shares through OpenBao's standard recovery procedure.

After OpenBao is ready, the owner grants access in Railway. The worker exchanges the
one-use code with PKCE and stores the OAuth grant at one scoped OpenBao KV path.
Railway may refresh the grant during later launches. The workspace page reads readiness
and the deployment timeline through the owner-scoped API. The hub does not receive the
grant, the bootstrap credential, the recovery shares, or the app configuration.
