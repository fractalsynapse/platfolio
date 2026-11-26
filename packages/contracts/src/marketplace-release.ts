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
