import { z } from 'zod';
import { MarketplacePlatformAcquisitionInputSchema, MarketplacePlatformReleaseSchema, MarketplaceReleaseSelectionSchema } from './marketplace-release.ts';
import { HostingProviderIdSchema, HostingRemovalSchema, InfraPlanSchema } from './infra.ts';

export const RAILWAY_AUTHORIZATION_CALLBACK = '/api/v1/railway/callback';

const artifact = z.object({
  selection: MarketplacePlatformAcquisitionInputSchema,
  images: MarketplacePlatformReleaseSchema.shape.images,
}).strict();
export const HostingTargetSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1).max(40).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  teamId: z.string().min(1).max(128),
  provider: HostingProviderIdSchema,
  artifact: artifact.optional(),
}).strict();
export type HostingTarget = z.infer<typeof HostingTargetSchema>;

const selectedRelease = { release: MarketplaceReleaseSelectionSchema.optional() };
const empty = z.object({}).strict().optional();
const target = z.object({ projectId: z.string().min(1), deploymentId: z.string().min(1) }).strict();
export const PrivateLaunchTemplateSchema = z.enum(['shared-identity', 'starter-worker']);
export type PrivateLaunchTemplate = z.infer<typeof PrivateLaunchTemplateSchema>;
const domain = target.extend({ hostname: z.string().min(1).max(253) });
const encoded = z.string().regex(/^[a-zA-Z0-9+/=]+$/);
const boundEnvironment = z.object({
  target: HostingTargetSchema,
  environment: z.string().min(1).max(64),
  service: z.string().min(1).max(64).optional(),
}).strict();

const command = <const Action extends string, Body extends z.ZodType>(action: Action, body: Body) =>
  z.object({ action: z.literal(action), body }).strict();

export const CustomerHostingCommandSchema = z.discriminatedUnion('action', [
  command('report', empty),
  command('setup', empty),
  command('start', z.object(selectedRelease).strict().optional()),
  command('template-report', z.object({ template: PrivateLaunchTemplateSchema }).strict()),
  command('template-start', z.discriminatedUnion('template', [
    z.object({ template: z.literal('shared-identity'), bootstrap: encoded.length(512), ...selectedRelease }).strict(),
    z.object({ template: z.literal('starter-worker'), ...selectedRelease }).strict(),
  ])),
  command('template-restore', z.object({ template: PrivateLaunchTemplateSchema }).strict()),
  command('template-remove', HostingRemovalSchema.extend({ template: PrivateLaunchTemplateSchema }).strict()),
  command('template-redeploy', target.extend({ template: PrivateLaunchTemplateSchema })),
  command('authorize', empty),
  command('initialize', z.object({ publicKey: encoded.min(500).max(1024) }).strict()),
  command('unlock', z.object({ recovery: encoded.min(500).max(640) }).strict()),
  command('callback', z.object({
    code: z.string().max(1024), state: z.string().max(1024), issuer: z.string().max(1024), error: z.string().max(1024),
  }).strict()),
  command('redeploy', target),
  command('remove', HostingRemovalSchema),
  command('marketplace-status', empty),
  command('marketplace-catalog', empty),
  command('marketplace-public-catalog', empty),
  command('marketplace-platforms', empty),
  command('marketplace-platform-releases', MarketplacePlatformReleaseSchema.pick({ platformId: true })),
  command('marketplace-verify-install', z.object({ target: HostingTargetSchema, release: MarketplacePlatformAcquisitionInputSchema }).strict()),
  command('marketplace-enroll', z.object({ handoff: z.string().regex(/^[0-9a-f-]{36}:[A-Za-z0-9_-]{43}$/) }).strict()),
  command('domains-list', target),
  command('domain-attach', domain),
  command('domain-detach', domain),
  command('brand-read', target),
  command('brand-apply', target.extend({ value: z.string().max(60) })),
  command('hosting-apply', z.object({ target: HostingTargetSchema, plan: InfraPlanSchema }).strict()),
  command('hosting-observe', HostingTargetSchema),
  command('hosting-remove', z.object({ target: HostingTargetSchema, options: HostingRemovalSchema }).strict()),
  command('hosting-redeploy', boundEnvironment),
]);

export type CustomerHostingCommand = z.infer<typeof CustomerHostingCommandSchema>;
