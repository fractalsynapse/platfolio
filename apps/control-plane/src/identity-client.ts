import { validateRequestBody } from '@platfolio/api-contract';
import type { RequestBodyOf } from '@platfolio/api-contract/generated/types';
import { composeDocuments, enabledEnvironments, parseCompose, parseInventory, readRepositorySource,
  readTemplate, serviceEnvironments, SHARED_IDENTITY_RELEASE, templateCatalogEntry, validateIdentitySource } from '@platfolio/manifest';
import type { ExtensionDescriptor } from '@platfolio/kernel';
import { InfraPlanSchema, type Store } from '@platfolio/contracts';
import { IdentityClientTargetSchema, IdentityEnvironmentSchema, type IdentityClientTarget, type IdentityClientRequest } from '../../../packages/contracts/src/shared-identity-execution.ts';
import type { scoped } from './capabilities.ts';
import type { customerLaunch } from './customer-launch.ts';
import { badRequest, notFound, send, spec } from './respond.ts';

const path = '/api/v1/instances/{instanceId}/bindings/identity/environments/{environment}';
const get = 'getSharedIdentityClient';
const put = 'placeSharedIdentityClient';
const del = 'revokeSharedIdentityClient';
const identityRelease = SHARED_IDENTITY_RELEASE;
const identityTemplate = templateCatalogEntry(identityRelease.template);

const conflict = (operation: string, message: string) => send(operation, 409, { error: 'conflict', message });
const unavailable = (operation: string, message: string) => send(operation, 503, { error: 'identity-worker-unavailable', message });

export async function hasIdentityClient(store: Pick<Store, 'getIdentityClient'>, instanceId: string) {
  return (await Promise.all(IdentityEnvironmentSchema.options.map((environment) => store.getIdentityClient(instanceId, environment)))).some(Boolean);
}

export function identityClient(route: typeof scoped, worker?: ReturnType<typeof customerLaunch>): ExtensionDescriptor {
  return {
    id: 'identity-client',
    requires: ['store', 'identity', 'scm'],
    routes: ([
      ['GET', get, 'instance.read', 'status'],
      ['PUT', put, 'marketplace.manage', 'place'],
      ['DELETE', del, 'marketplace.manage', 'revoke'],
    ] as const).map(([method, operation, policy, action]) =>
      route(method, path, operation, policy, async ({ teamId, context, claims, personId }, request, params) => {
        if (!worker || worker.teamId !== teamId) return notFound('private identity binding', '');
        const env = IdentityEnvironmentSchema.safeParse(params.environment);
        if (!env.success) return badRequest('Choose a production or staging environment.');
        const environment = env.data;
        const instanceId = params.instanceId ?? '';
        const { store, scm } = context;
        let target = await store.getIdentityClient(instanceId, environment);
        let railway: IdentityClientRequest['railway'];
        let setup: IdentityClientRequest['setup'];
        if (action === 'place') {
          if (request.bodyError || !validateRequestBody(spec(), operation, request.body).ok) {
            return badRequest('Choose a Shared Identity provider environment.');
          }
          const { providerEnvironment, setup: supplied } = request.body as RequestBodyOf<typeof put>;
          setup = supplied;
          const consumer = await store.getInstance(instanceId);
          if (!consumer.ok || consumer.value.teamId !== teamId) return notFound('private identity binding', '');
          const retained = await store.getMarketplaceInstall(teamId, consumer.value.name);
          const release = retained?.instance.id === instanceId ? retained.receipt.release : undefined;
          const bundle = release?.bundle;
          if (bundle && release) {
            const stored = await store.getPlan(instanceId);
            const plan = stored.ok ? InfraPlanSchema.safeParse(stored.value.plan) : undefined;
            const web = plan?.success ? plan.data.environments.find(({ name }) => name === environment)?.services.find(({ name }) => name === 'web') : undefined;
            const image = web && web.image + '@' + web.digest;
            if (!plan?.success || plan.data.provider !== 'railway' || plan.data.instanceId !== instanceId || plan.data.teamId !== teamId ||
                plan.data.planHash !== consumer.value.lastAppliedPlanHash || !image || !release.images.includes(image)) {
              return conflict(operation, 'Apply the retained release to this Railway environment before managing its client.');
            }
            const { platformId, version, descriptorDigest, images } = release;
            railway = { id: instanceId, name: consumer.value.name, teamId, provider: 'railway', image,
              planHash: plan.data.planHash, artifact: { selection: { platformId, version, descriptorDigest }, images } };
          }
          const binding = await store.getBinding(instanceId, 'identity');
          if (!binding.ok || binding.value.state !== 'bound') return conflict(operation, 'Record a same-team Shared Identity binding first.');
          const { providerInstanceId, destinations, boundAt } = binding.value;
          const provider = await store.getInstance(providerInstanceId);
          if (!provider.ok || provider.value.teamId !== teamId) {
            return notFound('private identity binding', '');
          }
          if (provider.value.templateRef?.repo !== identityTemplate.repo || provider.value.templateRef.commitSha !== identityRelease.revision ||
              ![3, 4].includes(destinations.length)) return conflict(operation, 'Use the reviewed Shared Identity release and all required destinations.');
          const required = new Map([
            ['issuer', 'OIDC_ISSUER'], ['jwks_uri', 'OIDC_JWKS_URI'], ['client_id', 'OIDC_CLIENT_ID'],
          ]);
          const clientType = destinations.length === 4 ? 'confidential' : 'public';
          if (clientType === 'confidential') required.set('client_secret', 'OIDC_CLIENT_SECRET');
          if (![...required].every(([output, variable]) => destinations.some((row) =>
              row.output === output && row.into.length === 1 && row.into[0] === variable))) {
            return conflict(operation, 'Record the standard Shared Identity destinations for this client.');
          }

          try {
            const readFile: typeof scm.readFile = (file) => scm.readFile(file);
            const pinned = consumer.value.templateRef;
            const recipe = bundle ?? (pinned && await readRepositorySource({ readFile, repo: pinned.repo, ref: pinned.commitSha, inventory: true, prodOverlay: true }));
            if (!recipe) return conflict(operation, 'Install a pinned Starter Web release with identity inputs.');
            const identity = await readTemplate(readFile, identityTemplate, identityRelease.revision);
            const identityManifest = validateIdentitySource(identity, identityRelease.version, identityRelease.image).manifest;
            const artifacts = new Map((await store.listArtifacts(instanceId)).filter(({ sourceRef }) => sourceRef === pinned?.commitSha)
              .map(({ service, image, digest }) => [service, image + '@' + digest]));
            const parsed = parseCompose('repo' in recipe ? composeDocuments(recipe) : recipe.compose, { resolveArtifact: (service) => artifacts.get(service) });
            const inventory = parseInventory(recipe.inventory ?? '');
            const app = parsed.manifest;
            const consumerContract = app?.spec.capabilities?.find(({ capability }) => capability === 'identity');
            const configured = inventory.entries.filter((entry) => 'service' in entry && entry.service === 'web' &&
              (!entry.environments || entry.environments.includes(environment)));
            if (parsed.issues.length || inventory.issues.length || !app || !app.spec.services.web ||
                !serviceEnvironments(app.spec.services.web, enabledEnvironments(app)).includes(environment) ||
                !enabledEnvironments(identityManifest).includes(providerEnvironment) ||
                !consumerContract?.as.includes('OIDC_REDIRECT_URI') ||
                !configured.some((entry) => entry.kind === 'value' && entry.name === 'OIDC_REDIRECT_URI') ||
                ![...required].every(([output, variable]) => consumerContract.as.includes(variable) && configured.some((entry) =>
                  entry.kind === 'output' && entry.from === 'identity#' + output && entry.name === variable))) {
              return conflict(operation, 'Build the pinned consumer with the matching OIDC inputs and enable both selected environments.');
            }
          } catch {
            return unavailable(operation, 'Check source control access to the pinned releases and retry.');
          }

          const desired: IdentityClientTarget = IdentityClientTargetSchema.parse({
            teamId, consumerInstanceId: instanceId, providerInstanceId, environment, providerEnvironment, clientType, boundAt,
          });
          target = await store.reserveIdentityClient(desired);
          if (!target || JSON.stringify(target) !== JSON.stringify(desired)) {
            return conflict(operation, 'The binding changed or this environment already has another client reservation.');
          }
        }
        if (!target || target.teamId !== teamId) return send(operation, 200, { state: action === 'revoke' ? 'revoked' : 'unconfigured' });
        const result = await worker.identity({ action, target, controlPlaneIssuer: claims.issuer, ...(railway ? { railway } : {}), ...(setup ? { setup } : {}) });
        if (result.status === 409) return conflict(operation, 'The client changed, is revoked, or has an operation in progress.');
        if (!result.placement) return unavailable(operation, 'Check OpenBao, Keycloak and the connected hosting workspace, then retry.');
        if (result.placement.state === 'revoked') {
          await store.releaseIdentityClient(target);
          if (action === 'place') return conflict(operation, 'This binding was revoked. Detach it before requesting a new client.');
        }
        if (action !== 'status') await store.appendAudit({
          actorKind: 'user', actorRef: personId, action: 'identity-client.' + action, target: instanceId,
          detail: { environment, providerInstanceId: target.providerInstanceId, state: result.placement.state },
        });
        return send(operation, 200, result.placement);
      })),
  };
}
