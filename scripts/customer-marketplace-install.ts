import { GitScm, type HostingTarget } from '../packages/contracts/src/index.ts';
import type { MarketplacePlatformAcquisition } from '../packages/contracts/src/marketplace-release.ts';
import type { VerifiedMarketplaceInstall } from '../packages/contracts/src/marketplace-install.ts';
import {
  buildPlan, composeDocuments, parseCompose, parseInventory, readRepositorySource,
  validateIdentitySource, validateManifest, validateStarterSource, validateWorkerSource,
  type RepositoryFileReader,
} from '../packages/manifest/src/index.ts';
import { verifyMarketplaceImage } from './marketplace-image-verification.ts';

const marketplaceGit = new GitScm({ timeoutMs: 20_000 });

export async function verifyMarketplaceInstall(
  target: HostingTarget,
  receipt: MarketplacePlatformAcquisition,
  readFile: RepositoryFileReader = (input) => marketplaceGit.readRepositoryFile(input),
  verifyImage: (image: string) => Promise<void> = verifyMarketplaceImage,
): Promise<VerifiedMarketplaceInstall> {
  const { release, variant } = receipt;
  const { installer, images, source } = release;
  const starter = variant === 'starter-template';
  const legacyWeb = release.platformId === 'platfolio.starter-web' && installer === 'starter-web@1';
  const legacyWorker = release.platformId === 'platfolio.starter-worker' && installer === 'starter-worker@1';
  const legacyIdentity = release.platformId === 'platfolio.shared-identity' && installer === 'shared-identity@1';
  if (starter ? installer !== 'compose-source@1' && !legacyWeb && !legacyWorker
    : installer !== 'compose-image@1' && !(variant === 'shared-service' && legacyIdentity)) {
    throw new Error('The release uses an incompatible installer');
  }
  const recipe = await readRepositorySource({ readFile, repo: source.repo, ref: source.revision, prodOverlay: true, inventory: true });
  const inventory = parseInventory(recipe.inventory ?? '');
  if (inventory.issues.length) throw new Error('The pinned environment registry is invalid');
  if (starter) {
    if (legacyWeb) validateStarterSource(recipe.compose, recipe.inventory, release.version);
    else if (legacyWorker) validateWorkerSource(recipe.compose, recipe.inventory ?? '', release.version);
    else if (parseCompose(composeDocuments(recipe)).issues.some(({ code }) => code !== 'no-artifact')) {
      throw new Error('The pinned starter recipe is invalid');
    }
    await Promise.all(images.map((image) => verifyImage(image)));
    return { receipt };
  }

  let manifest;
  if (legacyIdentity) {
    const [image] = images;
    if (!image || images.length !== 1) throw new Error('Shared Identity requires its pinned image');
    manifest = validateIdentitySource(recipe, release.version, image).manifest;
  } else {
    const parsed = parseCompose(composeDocuments(recipe));
    if (!parsed.manifest || parsed.issues.length) throw new Error('The pinned image recipe is invalid');
    manifest = parsed.manifest;
  }
  // The reviewed legacy recipe names the platform version range and expects the launcher to
  // generate a domain. Its installer-specific validator above already covers that topology.
  const blocking = validateManifest(manifest).filter(({ code }) =>
    !(legacyIdentity && code === 'renderer-version-window') &&
    !(variant === 'shared-service' && code === 'kind-web-unreachable'));
  if (blocking.length) {
    throw new Error('The pinned image recipe did not pass manifest validation');
  }
  const expectedImages = new Set(Object.values(manifest.spec.services).map(({ image, digest }) => `${image}@${digest}`));
  if (expectedImages.size === 0 || images.length !== expectedImages.size || new Set(images).size !== images.length ||
      images.some((image) => !expectedImages.has(image))) {
    throw new Error('The image recipe does not match the acquired image pins');
  }
  const plan = buildPlan(manifest, { instanceId: target.id, teamId: target.teamId, provider: target.provider, domains: 'generated-public' });
  await Promise.all(images.map((image) => verifyImage(image)));
  return { receipt, plan };
}
