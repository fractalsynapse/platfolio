import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import {
  MarketplacePlatformAcquisitionInputSchema, MarketplacePlatformCreationSchema, MarketplacePlatformPublicationSchema,
  MarketplaceArtifactVersionSchema, MarketplaceBundlePublicationSchema, MarketplaceMaintenanceInputSchema,
  marketplacePlatformDescriptorDigest, reasonOf, type MarketplacePlatformDescriptor, type Store,
} from '@platfolio/contracts';
import type { ExtensionDescriptor, KernelContext, Request, Response_, RouteDefinition } from '@platfolio/kernel';
import { marketplaceBundleManifest, marketplaceCatalog, newestMarketplaceVersionFirst, templateCatalogEntry } from '@platfolio/manifest';
import { artifactImages, artifactNamespace, issueArtifactGrant, readArtifactGraph, type ArtifactConfig } from './marketplace-artifacts.ts';
import type { scoped } from './capabilities.ts';
import { badRequest, notFound, send } from './respond.ts';
import type { customerLaunch } from './customer-launch.ts';

type Platform = SuccessOf<'listMarketplacePlatforms'>[number];
type Release = SuccessOf<'listMarketplacePlatformReleases'>[number];

type RegistryRoute = (path: string, operationId: string,
  handle: (context: KernelContext, request: Request, installationId: string, registryDigest: string) => Promise<Response_>) => RouteDefinition;

function summarize(descriptor: MarketplacePlatformDescriptor, publicCoordinates: boolean): Release {
  const { platformId, version, installer, source, images, bundle } = descriptor;
  return {
    platformId, version, installer,
    ...(publicCoordinates && source ? { source } : {}),
    ...(publicCoordinates && bundle ? { bundle } : {}),
    ...(!publicCoordinates && bundle ? { offer: bundle.offer } : {}),
    images: publicCoordinates ? images : [],
    descriptorDigest: marketplacePlatformDescriptorDigest(descriptor),
  };
}

async function readPlatforms(store: Pick<Store, 'listMarketplacePlatformAliases' | 'listMarketplaceReleases' | 'listMarketplacePublishedPlatformReleases'>) {
  const [aliases, published, teamReleases] = await Promise.all([
    store.listMarketplacePlatformAliases(), store.listMarketplaceReleases(), store.listMarketplacePublishedPlatformReleases(),
  ]);
  const catalog = marketplaceCatalog(published);
  const official = aliases.map(({ id, variant, legacyTemplate }) => {
    const byVersion = new Map<string, MarketplacePlatformDescriptor>();
    for (const entry of catalog) {
      if (entry.template !== legacyTemplate) continue;
      const prior = byVersion.get(entry.version);
      if (prior && (prior.source?.revision !== entry.revision || prior.installer !== entry.installer || prior.images[0] !== entry.image)) {
        throw new Error(`Marketplace version ${id}@${entry.version} has conflicting release pins`);
      }
      byVersion.set(entry.version, {
        platformId: id,
        version: entry.version,
        source: { repo: entry.repo, revision: entry.revision },
        images: entry.image ? [entry.image] : [],
        installer: entry.installer,
      });
    }
    const descriptors = [...byVersion.values()];
    const releases = descriptors.map((descriptor) => summarize(descriptor, true));
    const latestRelease = releases[0];
    if (!latestRelease) throw new Error(`Marketplace platform ${id} has no published release`);
    const platform: Platform = { id, title: templateCatalogEntry(legacyTemplate).label, variant, latestRelease };
    return { platform, releases, descriptors };
  });

  const byPlatform = new Map<string, typeof teamReleases>();
  for (const entry of teamReleases) {
    const entries = byPlatform.get(entry.platform.id) ?? [];
    entries.push(entry);
    byPlatform.set(entry.platform.id, entries);
  }
  const owned = [...byPlatform.values()].map((entries) => {
    const platform = entries[0]!.platform;
    const descriptors = entries.map(({ descriptor }) => descriptor)
      .sort((a, b) => newestMarketplaceVersionFirst(a.version, b.version));
    const releases = descriptors.map((descriptor) => summarize(descriptor, false));
    return { platform: { ...platform, latestRelease: releases[0]! }, releases, descriptors };
  }).sort((a, b) => a.platform.id.localeCompare(b.platform.id));
  return [...official, ...owned];
}

const unavailable = () => ({
  status: 503,
  body: { error: 'marketplace-unavailable', message: 'The platform catalog is unavailable. Check the hub catalog and release pins.' },
});

export function platformCatalog(enabled: boolean, publisherRoute: typeof scoped, registryRoute: RegistryRoute,
  artifacts?: ArtifactConfig, customer?: ReturnType<typeof customerLaunch>): ExtensionDescriptor {
  const publishing = '/api/v1/teams/{teamId}/marketplace/platforms';
  function acquire(operation: 'acquireMarketplacePlatformRelease' | 'acquireMarketplaceArtifactRelease') {
    return registryRoute(operation === 'acquireMarketplacePlatformRelease' ? '/acquisitions' : '/bundle-acquisitions', operation,
      async ({ store }, request, installationId, registryDigest) => {
        const input = MarketplacePlatformAcquisitionInputSchema.safeParse(request.body);
        if (request.bodyError || !input.success) return badRequest('Supply a platform, published version, and descriptor digest.');
        try {
          if (!await store.verifyMarketplaceCredential(installationId, registryDigest)) return notFound('marketplace installation', '');
          const { platformId, version, descriptorDigest } = input.data;
          const entry = (await readPlatforms(store)).find(({ platform }) => platform.id === platformId);
          const descriptor = entry?.descriptors.find((release) => release.version === version);
          if (!entry || !descriptor) return notFound('marketplace release', '');
          const release = summarize(descriptor, true);
          if (release.descriptorDigest !== descriptorDigest) return send(operation, 409, {
            error: 'release-pin-mismatch', message: 'Refresh the catalog and approve the exact release digest.',
          });
          if (descriptor.bundle && operation === 'acquireMarketplacePlatformRelease') return send(operation, 409, {
            error: 'artifact-delivery-required', message: 'Use the OCI bundle acquisition endpoint for this version.',
          });
          if (!descriptor.bundle && operation === 'acquireMarketplaceArtifactRelease') return notFound('marketplace bundle', '');
          const receipt = await store.acquireMarketplacePlatformRelease(installationId, registryDigest, input.data, descriptor.bundle?.offer === 'maintenance');
          if (!receipt) return descriptor.bundle?.offer === 'maintenance' ? send(operation, 409, {
            error: 'maintenance-required', message: 'Renew this team’s maintenance coverage to acquire this release.',
          }) : notFound('marketplace installation', '');
          const fields = { ...receipt, variant: entry.platform.variant };
          const response = descriptor.bundle
            ? send('acquireMarketplaceArtifactRelease', 200, { ...fields, release: { ...release, bundle: descriptor.bundle } })
            : send('acquireMarketplacePlatformRelease', 200, { ...fields, release: { ...release, source: descriptor.source! } });
          return { ...response, headers: { 'cache-control': 'no-store' } };
        } catch { return unavailable(); }
      });
  }
  return {
    id: 'platform-catalog',
    requires: ['store', 'identity'],
    routes: [{
      method: 'GET', path: '/api/v1/marketplace/platforms', operationId: 'listMarketplacePlatforms',
      async handle(_request, _params, { store }) {
        if (!enabled) {
          if (!customer) return notFound('marketplace catalog', '');
          const result = await customer.call('marketplace-platforms');
          return result.ok ? { status: 200, body: result.body, headers: { 'cache-control': 'no-store' } } : unavailable();
        }
        try {
          const entries = await readPlatforms(store);
          return { ...send('listMarketplacePlatforms', 200, entries.map(({ platform }) => platform)), headers: { 'cache-control': 'no-store' } };
        } catch { return unavailable(); }
      },
    }, {
      method: 'GET', path: '/api/v1/marketplace/platforms/{platformId}/releases', operationId: 'listMarketplacePlatformReleases',
      async handle(_request, { platformId }, { store }) {
        if (!enabled) {
          if (!customer || !platformId) return notFound('marketplace platform', '');
          const result = await customer.call('marketplace-platform-releases', { platformId });
          if (!result.ok) return result.status === 404 ? notFound('marketplace platform', '') : unavailable();
          return { status: 200, body: result.body, headers: { 'cache-control': 'no-store' } };
        }
        try {
          const entries = await readPlatforms(store);
          const entry = entries.find(({ platform }) => platform.id === platformId);
          return entry
            ? { ...send('listMarketplacePlatformReleases', 200, entry.releases), headers: { 'cache-control': 'no-store' } }
            : notFound('marketplace platform', platformId ?? '');
        } catch { return unavailable(); }
      },
    }, publisherRoute('POST', publishing, 'createMarketplacePlatform', 'marketplace.manage', async ({ context, teamId, personId }, request) => {
      if (!enabled) return notFound('marketplace', '');
      const input = MarketplacePlatformCreationSchema.safeParse(request.body);
      if (request.bodyError || !input.success) return badRequest('Choose a platform name, slug, and variant.');
      const { store } = context;
      const result = await store.createMarketplacePlatform(teamId, input.data);
      if (!result.ok) return result.code === 'not-found' ? notFound('team', '')
        : send('createMarketplacePlatform', 409, { error: 'conflict', message: reasonOf(result) });
      await store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'marketplace.platform.create',
        target: result.value.id, detail: { teamId } });
      return send('createMarketplacePlatform', 201, result.value);
    }), publisherRoute('POST', publishing + '/{platformId}/releases', 'publishMarketplacePlatformRelease', 'marketplace.manage',
      async ({ context, teamId, personId }, request, { platformId }) => {
        if (!enabled) return notFound('marketplace', '');
        const { store } = context;
        const platform = await store.getMarketplacePublisherPlatform(teamId, platformId ?? '');
        if (!platform) return notFound('platform', '');
        const input = MarketplacePlatformPublicationSchema.safeParse(request.body);
        if (request.bodyError || !input.success) return badRequest('Supply a stable version, a pinned repository revision, and image digests.');
        const starter = platform.variant === 'starter-template';
        if (!starter && input.data.images.length === 0) return badRequest('A shared service or hosted application needs at least one pinned image.');
        const descriptor = {
          ...input.data, platformId: platform.id,
          images: [...new Set(input.data.images)].sort(),
          installer: starter ? 'compose-source@1' : 'compose-image@1',
        };
        const result = await store.publishMarketplacePlatformRelease(teamId, descriptor);
        if (result === 'not-found') return notFound('platform', '');
        if (result === 'conflict') return send('publishMarketplacePlatformRelease', 409, {
          error: 'release-already-published', message: 'This version has a different pin. Publish a new version.',
        });
        if (result === 'created') await store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'marketplace.platform.publish',
          target: `${platform.id}@${descriptor.version}`, detail: { teamId } });
        return send('publishMarketplacePlatformRelease', 200, summarize(descriptor, false));
      }), publisherRoute('POST', publishing + '/{platformId}/uploads', 'issueMarketplaceUploadGrant', 'marketplace.manage',
      async ({ context, teamId }, request, { platformId }) => {
        if (!enabled) return notFound('marketplace', '');
        const platform = await context.store.getMarketplacePublisherPlatform(teamId, platformId ?? '');
        if (!platform || platform.variant === 'starter-template') return notFound('platform', '');
        if (!artifacts) return unavailable();
        const input = MarketplaceArtifactVersionSchema.safeParse(request.body);
        if (request.bodyError || !input.success) return badRequest('Supply the stable version being prepared.');
        return { ...send('issueMarketplaceUploadGrant', 200, issueArtifactGrant(artifacts, artifactNamespace(platform.id, input.data.version))),
          headers: { 'cache-control': 'no-store' } };
      }), publisherRoute('POST', publishing + '/{platformId}/bundles', 'publishMarketplaceArtifactBundle', 'marketplace.manage',
      async ({ context, teamId, personId }, request, { platformId }) => {
        if (!enabled) return notFound('marketplace', '');
        const { store } = context;
        const platform = await store.getMarketplacePublisherPlatform(teamId, platformId ?? '');
        if (!platform || platform.variant === 'starter-template') return notFound('platform', '');
        if (!artifacts) return unavailable();
        const input = MarketplaceBundlePublicationSchema.safeParse(request.body);
        if (request.bodyError || !input.success) return badRequest('Supply the release recipe and all pinned image references.');
        const descriptor = {
          platformId: platform.id, version: input.data.version, installer: 'compose-bundle@1',
          bundle: input.data.bundle, images: [...input.data.images].sort(),
        };
        let images: ReturnType<typeof artifactImages>;
        try {
          marketplaceBundleManifest(descriptor.bundle, descriptor.images, platform.variant);
          images = artifactImages(artifacts, artifactNamespace(platform.id, descriptor.version), descriptor.images);
        } catch {
          return badRequest('Verify the deployment recipe, secret declarations and exact pins in this release namespace.');
        }
        try {
          await Promise.all(images.map((image) => readArtifactGraph(artifacts.backend, image)));
        } catch {
          return badRequest('Push every pinned image and its layers to the marketplace registry before publishing.');
        }
        const result = await store.publishMarketplacePlatformRelease(teamId, descriptor);
        if (result === 'not-found') return notFound('platform', '');
        if (result === 'conflict') return send('publishMarketplaceArtifactBundle', 409, {
          error: 'release-already-published', message: 'This version has a different pin. Publish a new version.',
        });
        if (result === 'created') await store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'marketplace.platform.publish',
          target: `${platform.id}@${descriptor.version}`, detail: { teamId } });
        return send('publishMarketplaceArtifactBundle', 200, summarize(descriptor, false));
      }), publisherRoute('PUT', publishing + '/{platformId}/maintenance', 'setMarketplaceMaintenance', 'marketplace.manage',
      async ({ context, teamId, personId }, request, { platformId }) => {
        if (!enabled) return notFound('marketplace', '');
        const input = MarketplaceMaintenanceInputSchema.safeParse(request.body);
        if (request.bodyError || !input.success) return badRequest('Supply an eligible buyer team and coverage end time.');
        const { buyerTeamId, through } = input.data;
        if (!await context.store.setMarketplaceMaintenance(teamId, platformId ?? '', buyerTeamId, through)) return notFound('platform or buyer team', '');
        await context.store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'marketplace.maintenance.set',
          target: platformId!, detail: { teamId } });
        return { status: 204, body: undefined };
      }), acquire('acquireMarketplacePlatformRelease'), acquire('acquireMarketplaceArtifactRelease'),
      registryRoute('/pulls', 'issueMarketplacePullGrant', async ({ store }, request, installationId, registryDigest) => {
      const input = MarketplacePlatformAcquisitionInputSchema.safeParse(request.body);
      if (request.bodyError || !input.success) return badRequest('Supply the acquired release pin.');
      if (!artifacts) return unavailable();
      try {
        if (!await store.hasMarketplaceAcquisition(installationId, registryDigest, input.data)) return notFound('acquisition', '');
        const { platformId, version, descriptorDigest } = input.data;
        const descriptor = (await store.listMarketplacePublishedPlatformReleases()).find(({ descriptor: item }) =>
          item.platformId === platformId && item.version === version)?.descriptor;
        if (!descriptor?.bundle || marketplacePlatformDescriptorDigest(descriptor) !== descriptorDigest) return notFound('acquisition', '');
        const namespace = artifactNamespace(platformId, version);
        const images = artifactImages(artifacts, namespace, descriptor.images);
        return { ...send('issueMarketplacePullGrant', 200, issueArtifactGrant(artifacts, namespace, images)),
          headers: { 'cache-control': 'no-store' } };
      } catch { return unavailable(); }
    })],
  };
}
