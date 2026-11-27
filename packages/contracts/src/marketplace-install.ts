import { z } from 'zod';
import { InfraPlanSchema } from './infra.ts';
import { InstanceSchema } from './persistence.ts';
import {
  MarketplacePlatformAcquisitionInputSchema, MarketplaceAcquisitionReceiptSchema, MarketplacePlatformPublicationSchema, MarketplacePlatformVariantSchema,
} from './marketplace-release.ts';

export const MarketplaceInstallInputSchema = z.object({
  name: InstanceSchema.shape.name,
  release: MarketplacePlatformAcquisitionInputSchema,
  sourceRepository: MarketplacePlatformPublicationSchema.shape.source.shape.repo.optional(),
}).strict();
export type MarketplaceInstallInput = z.infer<typeof MarketplaceInstallInputSchema>;

export const MarketplaceInstallSchema = z.object({
  instance: InstanceSchema,
  receiptId: MarketplaceAcquisitionReceiptSchema.shape.id,
  release: MarketplacePlatformAcquisitionInputSchema,
  variant: MarketplacePlatformVariantSchema,
}).strict();

export const VerifiedMarketplaceInstallSchema = z.object({
  receipt: MarketplaceAcquisitionReceiptSchema,
  plan: InfraPlanSchema.optional(),
}).strict();
export type VerifiedMarketplaceInstall = z.infer<typeof VerifiedMarketplaceInstallSchema>;

export const MarketplaceInstallRecordSchema = z.object({
  instance: InstanceSchema,
  verified: VerifiedMarketplaceInstallSchema,
}).strict().refine(({ instance, verified: { receipt, plan } }) => {
  const { source, bundle } = receipt.release;
  if (instance.state !== 'pending' || instance.template !== receipt.release.platformId ||
      Boolean(source) === Boolean(bundle) || instance.templateRef?.commitSha !== source?.revision) return false;
  if (receipt.variant === 'starter-template') return Boolean(source) && !plan && instance.desiredPlanHash === undefined;
  return plan !== undefined && instance.templateRef?.repo === source?.repo &&
    plan.instanceId === instance.id && plan.teamId === instance.teamId && plan.provider === instance.provider &&
    instance.desiredPlanHash === plan.planHash;
}, { message: 'The verified release and plan must belong to the new instance' });

export function matchesMarketplaceRelease(
  release: z.infer<typeof MarketplacePlatformAcquisitionInputSchema>,
  selection: z.infer<typeof MarketplacePlatformAcquisitionInputSchema>,
): boolean {
  return release.platformId === selection.platformId && release.version === selection.version &&
    release.descriptorDigest === selection.descriptorDigest;
}
