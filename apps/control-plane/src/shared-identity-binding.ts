import { validateRequestBody } from '@platfolio/api-contract';
import type { RequestBodyOf } from '@platfolio/api-contract/generated/types';
import { checkBindingPolicy, type CapabilityOffer, type Instance } from '@platfolio/contracts';
import type { ExtensionDescriptor } from '@platfolio/kernel';
import { readTemplate, SHARED_IDENTITY_RELEASE, templateCatalogEntry, validateIdentitySource } from '@platfolio/manifest';
import type { scoped as scopedRoute } from './capabilities.ts';
import { badRequest, notFound, send, spec } from './respond.ts';

const release = SHARED_IDENTITY_RELEASE;
const template = templateCatalogEntry(release.template);
const capability = 'identity';
const identityOutputs = [
  { output: 'issuer', kind: 'url', variable: 'OIDC_ISSUER' },
  { output: 'jwks_uri', kind: 'url', variable: 'OIDC_JWKS_URI' },
  { output: 'client_id', kind: 'value', variable: 'OIDC_CLIENT_ID' },
  { output: 'client_secret', kind: 'secret', variable: 'OIDC_CLIENT_SECRET' },
] as const;

function reviewedRelease(instance: Instance) {
  return instance.templateRef?.repo === template.repo && instance.templateRef.commitSha === release.revision;
}

function matchesIdentityOutputs(outputs: Pick<CapabilityOffer['outputs'][number], 'output' | 'kind'>[]) {
  return outputs.length === identityOutputs.length && identityOutputs.every(({ output, kind }) =>
    outputs.some((candidate) => candidate.output === output && candidate.kind === kind));
}

function removing(instance: Instance) {
  return instance.state === 'deprovisioning' || instance.state === 'removed';
}

const publish = 'publishSharedIdentityCapability';
const bind = 'bindSharedIdentity';
const conflict = (operation: string, message: string) => send(operation, 409, { error: 'conflict', message });

export function sharedIdentityBinding(scoped: typeof scopedRoute): ExtensionDescriptor {
  return {
    id: 'shared-identity-binding',
    requires: ['store', 'identity', 'scm'],
    routes: [
      scoped('PUT', '/api/v1/instances/{instanceId}/capability/identity', publish, 'capability.publish', async ({ context, teamId, personId }, request, params) => {
        if (request.bodyError || request.body !== undefined) return badRequest('Publish the saved Shared Identity release without a request body.');
        const { store, scm } = context;
        const id = params.instanceId ?? '';
        const instance = await store.getInstance(id);
        if (!instance.ok) return notFound('instance', id);
        if (instance.value.teamId !== teamId) return notFound('instance', '');
        if (!reviewedRelease(instance.value) || removing(instance.value)) {
          return conflict(publish, 'Select an available instance of the reviewed Shared Identity release.');
        }

        let declaration;
        try {
          const source = await readTemplate((target) => scm.readFile(target), template, release.revision);
          declaration = validateIdentitySource(source, release.version, release.image).manifest.spec.provides;
        } catch {
          return send(publish, 503, {
            error: 'identity-release-unavailable',
            message: 'Check that source control can read the pinned Shared Identity release, then retry.',
          });
        }
        if (declaration?.name !== capability || !matchesIdentityOutputs(declaration.outputs)) {
          return conflict(publish, 'The pinned release must declare the Shared Identity output contract.');
        }

        const outputs = declaration.outputs.map(({ output, kind }) => ({ output, kind, state: 'not-issued' as const }));
        const saved = await store.ensureCapabilityOffer({ instanceId: id, teamId, capability, outputs });
        if (!saved.ok || saved.value.teamId !== teamId || !matchesIdentityOutputs(saved.value.outputs)) {
          return conflict(publish, 'Review the existing identity offer before publishing the Shared Identity contract.');
        }
        await store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'capability.publish', target: id, detail: { capability } });
        return send(publish, 200, saved.value);
      }),
      scoped('PUT', '/api/v1/instances/{instanceId}/bindings/identity/intent', bind, 'capability.bind', async ({ context, teamId, personId, claims }, request, params) => {
        if (request.bodyError || !validateRequestBody(spec(), bind, request.body).ok) {
          return badRequest('Choose a provider instance and a public or confidential client.');
        }
        const { providerInstanceId, clientType } = request.body as RequestBodyOf<typeof bind>;
        const { store } = context;
        const consumerInstanceId = params.instanceId ?? '';
        const provider = await store.getInstance(providerInstanceId);
        if (!provider.ok || provider.value.teamId !== teamId) return notFound('Shared Identity provider', '');
        const consumer = await store.getInstance(consumerInstanceId);
        if (!consumer.ok || consumer.value.teamId !== teamId) return notFound('consumer', '');
        if (!reviewedRelease(provider.value) || removing(provider.value) || removing(consumer.value)) {
          return conflict(bind, 'Choose an available consumer and an available instance of the reviewed Shared Identity release.');
        }

        const offer = await store.getCapabilityOffer(providerInstanceId, capability);
        if (!offer.ok || offer.value.teamId !== teamId || !matchesIdentityOutputs(offer.value.outputs)) {
          return conflict(bind, 'Publish the Shared Identity output contract on the provider first.');
        }
        const destinations = identityOutputs
          .filter(({ kind }) => kind !== 'secret' || clientType === 'confidential')
          .map(({ output, variable }) => ({ output, into: [variable] }));
        const policy = checkBindingPolicy({ consumer: consumer.value, provider: provider.value, offer: offer.value, required: destinations, shares: [] });
        if (!policy.ok) return conflict(bind, 'Choose a Shared Identity provider other than the consumer.');

        const saved = await store.ensureCapabilityBinding({ consumerInstanceId, capability, providerInstanceId, destinations, boundBy: claims.subject });
        if (!saved.ok || saved.value.providerInstanceId !== providerInstanceId || saved.value.state !== 'bound' ||
            saved.value.destinations.length !== destinations.length || !destinations.every(({ output, into }) =>
              saved.value.destinations.some((row) => row.output === output && row.into.length === 1 && row.into[0] === into[0]))) {
          return conflict(bind, 'This consumer already has a different identity binding. Review the dependency before changing it.');
        }
        await store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'capability.bind', target: consumerInstanceId, detail: { capability, providerInstanceId } });
        return send(bind, 200, saved.value);
      }),
    ],
  };
}
