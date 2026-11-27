import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MarketplaceReleaseSelectionSchema = z.object({
  version: z.string().max(64).regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
}).strict();
export type MarketplaceReleaseSelection = z.infer<typeof MarketplaceReleaseSelectionSchema>;

export const MarketplaceReleasePublicationSchema = MarketplaceReleaseSelectionSchema.extend({
  template: z.enum(['starter-web', 'starter-worker', 'shared-identity']),
  installer: z.string().max(64).regex(/^[a-z0-9-]+@[0-9]+$/),
  image: z.string().max(192).regex(/^keycloak\/keycloak:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$/).optional(),
});
export type MarketplaceReleasePublication = z.infer<typeof MarketplaceReleasePublicationSchema>;

export const MarketplaceReleaseSchema = MarketplaceReleasePublicationSchema.extend({
  repo: z.string(),
  priceMinor: z.literal(0),
  installable: z.boolean(),
});
export type MarketplaceRelease = z.infer<typeof MarketplaceReleaseSchema>;

export const MarketplacePlatformVariantSchema = z.enum(['starter-template', 'shared-service', 'hosted-application']);
const MarketplacePlatformIdSchema = z.string().min(1).max(128);
const MarketplaceDescriptorDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const MarketplacePlatformSourceSchema = z.object({
  repo: z.string().max(200).regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/),
  revision: MarketplaceReleaseSelectionSchema.shape.revision,
}).strict();
const MarketplaceImagesSchema = z.array(z.string().max(512).regex(/^[A-Za-z0-9](?![^@]*\/\/)[A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/)).max(64);
export const MarketplaceArtifactVersionSchema = z.object({ version: MarketplaceReleaseSelectionSchema.shape.version }).strict();
const MarketplaceBundleSchema = z.object({
  compose: z.string().min(1).max(131072),
  inventory: z.string().min(1).max(65536),
  offer: z.enum(['free', 'maintenance']),
}).strict();
export const MarketplaceBundlePublicationSchema = MarketplaceArtifactVersionSchema.extend({
  bundle: MarketplaceBundleSchema,
  images: MarketplaceImagesSchema.min(1).max(24),
});
export const MarketplaceMaintenanceInputSchema = z.object({
  buyerTeamId: z.string().min(1).max(128),
  through: z.iso.datetime(),
}).strict();
export const MarketplaceArtifactGrantSchema = z.object({
  registry: z.string().min(1),
  namespace: z.string().min(1),
  username: z.literal('platfolio'),
  password: z.string().min(1),
  expiresAt: z.iso.datetime(),
}).strict();
export type MarketplaceArtifactGrant = z.infer<typeof MarketplaceArtifactGrantSchema>;

export const MarketplacePlatformCreationSchema = z.object({
  slug: z.string().max(80).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  title: z.string().trim().min(1).max(120),
  variant: MarketplacePlatformVariantSchema,
}).strict();
export type MarketplacePlatformCreation = z.infer<typeof MarketplacePlatformCreationSchema>;

export const MarketplacePublisherPlatformSchema = MarketplacePlatformCreationSchema.extend({
  id: MarketplacePlatformIdSchema,
  publisherTeamId: z.string().min(1),
});
export type MarketplacePublisherPlatform = z.infer<typeof MarketplacePublisherPlatformSchema>;

export const MarketplacePlatformPublicationSchema = z.object({
  version: MarketplaceReleaseSelectionSchema.shape.version,
  source: MarketplacePlatformSourceSchema,
  images: MarketplaceImagesSchema,
}).strict();

export const MarketplacePlatformReleaseSchema = z.object({
  platformId: MarketplacePlatformIdSchema,
  version: MarketplaceReleaseSelectionSchema.shape.version,
  source: MarketplacePlatformSourceSchema.optional(),
  images: MarketplaceImagesSchema,
  installer: MarketplaceReleasePublicationSchema.shape.installer,
  descriptorDigest: MarketplaceDescriptorDigestSchema,
  bundle: MarketplaceBundleSchema.optional(),
  offer: MarketplaceBundleSchema.shape.offer.optional(),
}).strict();

export const MarketplacePlatformDescriptorSchema = MarketplacePlatformReleaseSchema.omit({ descriptorDigest: true, offer: true }).refine(
  ({ source, bundle }) => Boolean(source) !== Boolean(bundle), 'Use one pinned source or one release bundle',
);
export type MarketplacePlatformDescriptor = z.infer<typeof MarketplacePlatformDescriptorSchema>;

export function marketplacePlatformDescriptorDigest(descriptor: MarketplacePlatformDescriptor): string {
  return createHash('sha256').update(JSON.stringify(MarketplacePlatformDescriptorSchema.parse(descriptor))).digest('hex');
}

export const MarketplacePlatformSchema = z.object({
  id: MarketplacePlatformIdSchema,
  title: z.string().min(1),
  variant: MarketplacePlatformVariantSchema,
  publisherTeamId: z.string().min(1).optional(),
  slug: MarketplacePlatformCreationSchema.shape.slug.optional(),
  latestRelease: MarketplacePlatformReleaseSchema,
}).strict();

export const MarketplacePlatformAliasSchema = MarketplacePlatformSchema.pick({ id: true, variant: true }).extend({
  legacyTemplate: MarketplaceReleasePublicationSchema.shape.template,
});
export type MarketplacePlatformAlias = z.infer<typeof MarketplacePlatformAliasSchema>;

export interface MarketplacePublishedPlatformRelease {
  platform: MarketplacePublisherPlatform;
  descriptor: MarketplacePlatformDescriptor;
}

export const MarketplacePlatformAcquisitionInputSchema = MarketplacePlatformReleaseSchema.pick({
  platformId: true, version: true, descriptorDigest: true,
});
export type MarketplacePlatformAcquisitionInput = z.infer<typeof MarketplacePlatformAcquisitionInputSchema>;

export interface MarketplacePlatformAcquisitionRecord {
  id: string;
  teamId: string;
  acquiredAt: string;
}

const acquisition = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  acquiredAt: z.iso.datetime(),
  variant: MarketplacePlatformVariantSchema,
}).strict();
const acquiredRelease = MarketplacePlatformReleaseSchema.omit({ offer: true });
export const MarketplacePlatformAcquisitionSchema = acquisition.extend({
  release: acquiredRelease.omit({ bundle: true }).required({ source: true }),
});
export const MarketplaceArtifactAcquisitionSchema = acquisition.extend({
  release: acquiredRelease.omit({ source: true }).required({ bundle: true }),
});
// The private worker accepts both response shapes while each published HTTP operation retains its own contract.
export const MarketplaceAcquisitionReceiptSchema = acquisition.extend({ release: acquiredRelease });
export type MarketplacePlatformAcquisition = z.infer<typeof MarketplaceAcquisitionReceiptSchema>;
