import { z } from 'zod';

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
}).strict();
export type IdentityClientRequest = z.infer<typeof IdentityClientRequestSchema>;

export const IdentityClientPlacementSchema = z.object({
  state: z.enum(['unconfigured', 'pending', 'placed', 'revoked']),
  clientId: id.optional(),
}).strict();
export type IdentityClientPlacement = z.infer<typeof IdentityClientPlacementSchema>;
