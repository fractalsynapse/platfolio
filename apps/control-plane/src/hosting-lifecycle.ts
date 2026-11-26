import { HostingRemovalRequestSchema, InfraPlanSchema, KEEP_DATA_FEATURE, PINNED_RELEASE_REDEPLOY_FEATURE, bindingImpact } from '@platfolio/contracts';
import type { ExtensionDescriptor, Response_ } from '@platfolio/kernel';
import type { scoped as scopedRoute } from './capabilities.ts';
import { badRequest, notFound, send } from './respond.ts';

export function hostingLifecycle(scoped: typeof scopedRoute): ExtensionDescriptor {
  const hostingOperations = new Set<string>();
  function providerUnavailable(): Response_ {
    return { status: 503, body: { error: 'hosting-provider-unavailable', message: 'Connect an execution plugin for this instance’s hosting provider.' } };
  }
  function operationConflict(message: string): Response_ {
    return { status: 409, body: { error: 'conflict', message } };
  }
  return {
    id: 'hosting-lifecycle',
    requires: ['store', 'identity', 'infra'],
    routes: [
      scoped('GET', '/api/v1/instances/{instanceId}/hosting', 'getInstanceHostingState', 'instance.read', async (scope, _request, params) => {
        const id = params.instanceId ?? '';
        const instance = await scope.context.store.getInstance(id);
        if (!instance.ok) return notFound('instance', id);
        const provider = scope.context.infra.forInstance(instance.value);
        if (!provider?.describe().operations.includes('readState')) return providerUnavailable();
        try { return send('getInstanceHostingState', 200, await provider.readState(id)); }
        catch { return providerUnavailable(); }
      }),
      scoped('POST', '/api/v1/instances/{instanceId}/environments/{environment}/deployments', 'redeployHostedStarter', 'marketplace.manage', async (scope, _request, params) => {
        const id = params.instanceId ?? '';
        if (params.environment !== 'staging') return notFound('hosted deployment', id);
        const { store, infra } = scope.context;
        const instance = await store.getInstance(id);
        if (!instance.ok) return notFound('hosted deployment', id);
        const hosting = await store.getHostedStarter(id);
        if (!hosting.ok) return notFound('hosted deployment', id);
        if (hosting.value.state !== 'live') return operationConflict('Restore this app before requesting another deployment.');
        const provider = infra.forInstance(instance.value);
        if (!provider?.redeploy || !provider.describe().features.includes(PINNED_RELEASE_REDEPLOY_FEATURE)) return providerUnavailable();
        const { projectId, deploymentId } = hosting.value;
        try {
          const result = await provider.redeploy({ instanceId: id, environment: params.environment, expectedDeployment: { projectId, deploymentId } });
          if (result.refused.length) return operationConflict(result.refused[0]!.reason);
          return send('redeployHostedStarter', 202, { state: 'requested' });
        } catch { return providerUnavailable(); }
      }),
      scoped('POST', '/api/v1/instances/{instanceId}/hosting/apply', 'applyInstanceHostingPlan', 'instance.dispatch', async (scope, _request, params) => {
        const id = params.instanceId ?? '';
        const { store, infra } = scope.context;
        const instance = await store.getInstance(id);
        if (!instance.ok) return notFound('instance', id);
        const provider = infra.forInstance(instance.value);
        if (!provider?.describe().operations.includes('applyPlan')) return providerUnavailable();
        if ((await store.getHostedStarter(id)).ok) return operationConflict('Apply this app through its installed launch workflow.');
        const stored = await store.getPlan(id);
        if (!stored.ok) return notFound('plan', id);
        const parsed = InfraPlanSchema.safeParse(stored.value.plan);
        if (!parsed.success || parsed.data.instanceId !== id || parsed.data.teamId !== scope.teamId ||
            parsed.data.provider !== instance.value.provider || parsed.data.planHash !== stored.value.planHash) {
          return badRequest('The stored plan must match this instance, team, provider and recorded digest.');
        }
        if (hostingOperations.has(id)) return operationConflict('This instance already has a hosting operation in progress.');
        hostingOperations.add(id);
        try {
          const result = await provider.applyPlan(parsed.data);
          if (result.instanceId !== id || result.planHash !== parsed.data.planHash) return providerUnavailable();
          await store.updateInstanceState(id, result.verified ? 'live' : 'failed',
            result.verified ? { lastAppliedPlanHash: result.planHash } : undefined);
          await store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'hosting.apply', target: id,
            detail: { provider: instance.value.provider, verified: result.verified } });
          return send('applyInstanceHostingPlan', 200, result);
        } catch { return providerUnavailable(); }
        finally { hostingOperations.delete(id); }
      }),
      scoped('POST', '/api/v1/instances/{instanceId}/hosting/removal', 'removeInstanceHosting', 'instance.destroy', async (scope, request, params) => {
        const id = params.instanceId ?? '';
        const { store, infra } = scope.context;
        const instance = await store.getInstance(id);
        if (!instance.ok) return notFound('instance', id);
        const options = HostingRemovalRequestSchema.safeParse(request.body);
        if (!options.success) return badRequest('Choose whether to keep or wipe stored data.');
        const { data, confirmation } = options.data;
        if (data === 'wipe' && confirmation !== instance.value.name) {
          return badRequest('Type the app name to confirm permanent removal.');
        }
        const provider = infra.forInstance(instance.value);
        if (!provider?.describe().operations.includes('deleteInstance')) return providerUnavailable();
        if (data === 'keep' && !provider.describe().features.includes(KEEP_DATA_FEATURE)) {
          return operationConflict('This provider cannot verify a keep-data removal.');
        }
        if (hostingOperations.has(id)) return operationConflict('This instance already has a hosting operation in progress.');
        hostingOperations.add(id);
        try {
          const consumers = await store.listConsumers(id);
          if (consumers.length) return operationConflict(`Removing this instance would strand: ${bindingImpact(consumers).join('; ')}`);
          if ((await store.getHostedStarter(id)).ok) return operationConflict('Remove this app through its installed launch workflow.');
          const result = await provider.deleteInstance(id, { data });
          if (result.instanceId !== id) return providerUnavailable();
          const verified = result.orphans.length === 0 && !result.failures?.length &&
            (data === 'keep' ? result.retained !== undefined && result.removed.length === 0 : result.retained === undefined);
          if (verified) await store.updateInstanceState(id, data === 'keep' ? 'paused' : 'removed');
          await store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'hosting.remove', target: id,
            detail: { provider: instance.value.provider, storagePolicy: data, verified } });
          return send('removeInstanceHosting', 200, result);
        } catch { return providerUnavailable(); }
        finally { hostingOperations.delete(id); }
      }),
    ],
  };
}
