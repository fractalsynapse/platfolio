import { z } from 'zod';
import { HostingTargetSchema } from './customer-hosting-commands.ts';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const IdentityEnvironmentSchema = z.enum(['production', 'staging']);
export const IdentityClientTargetSchema = z.object({
  teamId: id,
  consumerInstanceId: id,
  providerInstanceId: id,
  environment: IdentityEnvironmentSchema,
  providerEnvironment: IdentityEnvironmentSchema,
  boundAt: z.iso.datetime(),
  clientType: z.enum(['public', 'confidential']),
}).strict();
export type IdentityClientTarget = z.infer<typeof IdentityClientTargetSchema>;

export const IdentityClientRequestSchema = z.object({
  action: z.enum(['status', 'place', 'revoke']),
  target: IdentityClientTargetSchema,
  controlPlaneIssuer: z.string().min(1).max(1024),
  setup: z.object({
    issuer: z.string().min(1).max(1024),
    redirectUri: z.string().min(1).max(1024),
    realmGrant: z.string().length(512).regex(/^[a-zA-Z0-9+/=]+$/),
  }).strict().optional(),
  railway: HostingTargetSchema.extend({
    provider: z.literal('railway'),
    artifact: HostingTargetSchema.shape.artifact.unwrap(),
    image: z.string().min(1).max(512),
    planHash: z.string().min(1).max(128),
  }).optional(),
}).strict().refine(({ target, railway }) => !railway ||
  (railway.id === target.consumerInstanceId && railway.teamId === target.teamId && railway.artifact.images.includes(railway.image)),
  { message: 'The Railway target must match the reserved consumer and its immutable release' });
export type IdentityClientRequest = z.infer<typeof IdentityClientRequestSchema>;

export const IdentityClientPlacementSchema = z.object({
  state: z.enum(['unconfigured', 'pending', 'placed', 'revoked']),
  clientId: id.optional(),
}).strict();
export type IdentityClientPlacement = z.infer<typeof IdentityClientPlacementSchema>;
