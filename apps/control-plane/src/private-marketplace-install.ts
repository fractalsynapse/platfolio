import {
  MarketplaceInstallInputSchema, VerifiedMarketplaceInstallSchema, matchesMarketplaceRelease, newId, type Instance,
} from '@platfolio/contracts';
import type { ExtensionDescriptor } from '@platfolio/kernel';
import type { scoped as scopedRoute } from './capabilities.ts';
import type { customerLaunch } from './customer-launch.ts';
import { badRequest, notFound, send } from './respond.ts';

const operation = 'preparePrivateMarketplaceInstall';
const unavailable = () => send(operation, 503, {
  error: 'marketplace-install-unavailable',
  message: 'Check the marketplace connection and whether the selected Git commit and images are accessible, then retry.',
});
const conflict = (message: string) => send(operation, 409, { error: 'conflict', message });

export function privateMarketplaceInstall(scoped: typeof scopedRoute, customer: ReturnType<typeof customerLaunch> | undefined): ExtensionDescriptor {
  return {
    id: 'private-marketplace-install',
    requires: ['store', 'identity', 'scm'],
    routes: [scoped('POST', '/api/v1/teams/{teamId}/marketplace/installs', operation, 'marketplace.manage',
      async ({ context, teamId, personId }, request) => {
        if (!customer || customer.teamId !== teamId) return notFound('private marketplace', '');
        const input = MarketplaceInstallInputSchema.safeParse(request.body);
        if (request.bodyError || !input.success) return badRequest('Choose an instance name and an exact published release.');
        const { name, release, sourceRepository } = input.data;
        const { store, scm } = context;

        async function retained() {
          const existing = await store.getMarketplaceInstall(teamId, name);
          if (!existing) return undefined;
          const { instance, receipt } = existing;
          const retainedRepo = receipt.variant === 'starter-template' ? instance.templateRef?.repo : undefined;
          if (!matchesMarketplaceRelease(receipt.release, release) || retainedRepo !== sourceRepository) {
            return conflict('This name already has a different install. Use a new name to install a different release.');
          }
          return send(operation, 200, { instance, receiptId: receipt.id, release, variant: receipt.variant });
        }

        try {
          const existing = await retained();
          if (existing) return existing;
          const target = { id: newId('inst'), teamId, name, provider: 'railway' } as const;
          const response = await customer.call('marketplace-verify-install', { target, release });
          if (!response.ok) return response.status === 409
            ? conflict('Connect the marketplace and select an available release with its exact published digest.')
            : unavailable();

          const verified = VerifiedMarketplaceInstallSchema.parse(response.body);
          const { receipt, plan } = verified;
          const { source } = receipt.release;
          const starter = receipt.variant === 'starter-template';
          if (!matchesMarketplaceRelease(receipt.release, release) || starter === Boolean(plan) ||
              (plan && (plan.instanceId !== target.id || plan.teamId !== teamId || plan.provider !== target.provider))) {
            return unavailable();
          }
          if (starter) {
            if (!sourceRepository || sourceRepository.toLowerCase() === source.repo.toLowerCase()) {
              return badRequest('Import the selected starter commit into your own repository and supply that repository.');
            }
            try {
              await scm.readFile({ repo: sourceRepository, ref: source.revision, path: 'compose.yaml' });
            } catch {
              return badRequest('Give this installation read access to your repository and import the exact acquired commit before retrying.');
            }
          } else if (sourceRepository !== undefined) {
            return badRequest('Omit the source repository when installing a shared service or hosted application.');
          }

          const now = new Date().toISOString();
          const instance: Instance = {
            ...target, template: release.platformId, state: 'pending', createdAt: now, updatedAt: now,
            templateRef: { repo: sourceRepository ?? source.repo, commitSha: source.revision },
            ...(plan ? { desiredPlanHash: plan.planHash } : {}),
          };
          const recorded = await store.recordMarketplaceInstall(instance, verified);
          if (!recorded.ok) return recorded.code === 'conflict'
            ? await retained() ?? conflict('This name already belongs to an instance. Choose a new name.')
            : unavailable();
          await store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'marketplace.install.prepare',
            target: instance.id, detail: { teamId } });
          return send(operation, 200, { instance: recorded.value, receiptId: receipt.id, release, variant: receipt.variant });
        } catch {
          return unavailable();
        }
      })],
  };
}
