import { ENDPOINTS } from '../packages/api-contract/src/generated/types.ts';
import { createHash, randomBytes } from 'node:crypto';
import { FREE_STARTER_RELEASE, MARKETPLACE_RELEASES, readMarketplaceListing, templateCatalogEntry } from '../packages/manifest/src/template-catalog.ts';
import type { customerOpenBao, MarketplaceGrant } from './customer-openbao.ts';
import {
  MarketplaceArtifactGrantSchema, MarketplaceAcquisitionReceiptSchema, marketplacePlatformDescriptorDigest, type MarketplacePlatformAcquisitionInput,
} from '../packages/contracts/src/marketplace-release.ts';
import { matchesMarketplaceRelease } from '../packages/contracts/src/marketplace-install.ts';

const { template, version, revision } = FREE_STARTER_RELEASE;
const release = { template, version, revision };
const receipt = { ...FREE_STARTER_RELEASE, repo: templateCatalogEntry(template).repo };
const handoffPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{43})$/;

type Vault = Pick<ReturnType<typeof customerOpenBao>, 'status' | 'readMarketplaceGrant' | 'writeMarketplaceGrant'>;
type ConnectionState = 'unconfigured' | 'openbao-required' | 'disconnected' | 'connected' | 'unavailable';

export function privateMarketplaceOrigin(raw: string | undefined): string | undefined {
  if (!raw) return;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The marketplace origin must be an HTTPS origin configured by the installation owner');
  }
  return url.origin;
}

export function customerMarketplaceConnection(hub: string | undefined, bao: Vault, request: typeof fetch = fetch) {
  let enrolling = false;

  function call(grant: MarketplaceGrant, endpoint: 'claim' | 'enrollment' | 'catalog' | 'acquisitions' | 'bundle-acquisitions' | 'pulls', bearer: string, body?: object) {
    if (!hub || grant.hub !== hub) throw new Error('Marketplace origin changed');
    const url = new URL(`/api/v1/marketplace/installations/${encodeURIComponent(grant.installationId)}/${endpoint}`, hub);
    if (endpoint === 'catalog') url.searchParams.set('format', 'releases');
    return request(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4_000),
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function claim(grant: MarketplaceGrant) {
    const response = await call(grant, 'claim', grant.credential);
    if (response.status === 404) return false;
    if (response.status !== 200) throw new Error('Marketplace unavailable');
    const actual = await response.json() as Record<string, unknown>;
    if (actual?.installationId !== grant.installationId ||
        Object.entries(receipt).some(([key, value]) => actual[key] !== value)) {
      throw new Error('The marketplace returned a different release');
    }
    return true;
  }

  async function connection(): Promise<{ state: ConnectionState; release?: typeof release }> {
    if (!hub) return { state: 'unconfigured' };
    if (await bao.status() !== 'ready') return { state: 'openbao-required' };
    let saved: MarketplaceGrant | undefined;
    try {
      saved = (await bao.readMarketplaceGrant()).grant;
      if (!saved) return { state: 'disconnected' };
      if (await claim(saved)) return { state: 'connected', release };
      return { state: 'disconnected', ...(saved.claimed ? { release } : {}) };
    } catch {
      return { state: 'unavailable', ...(saved?.claimed ? { release } : {}) };
    }
  }

  async function enroll(handoff: string): Promise<'enrolled' | 'refused' | 'unavailable'> {
    const parsed = handoffPattern.exec(handoff);
    const [, installationId, code] = parsed ?? [];
    if (!installationId || !code || enrolling) return 'refused';
    if (!hub || await bao.status() !== 'ready') return 'unavailable';
    if (enrolling) return 'refused';
    enrolling = true;
    try {
      const saved = await bao.readMarketplaceGrant();
      let currentVersion = saved.version;
      let grant = saved.grant;
      if (grant?.installationId !== installationId) {
        if (grant && await claim(grant)) return 'refused';
        grant = { installationId, hub, credential: randomBytes(32).toString('base64url'), claimed: grant?.claimed ?? false };
        await bao.writeMarketplaceGrant(grant, currentVersion);
        currentVersion += 1;
      }
      if (!await claim(grant)) {
        const registryDigest = createHash('sha256').update(grant.credential).digest('hex');
        const response = await call(grant, 'enrollment', code, { registryDigest });
        if (response.status !== 204 && response.status !== 404) return 'unavailable';
        // A preceding attempt may have redeemed the code before losing its response.
        if (!await claim(grant)) return response.status === 404 ? 'refused' : 'unavailable';
      }
      if (!grant.claimed) await bao.writeMarketplaceGrant({ ...grant, claimed: true }, currentVersion);
      return 'enrolled';
    } catch {
      return 'unavailable';
    } finally {
      enrolling = false;
    }
  }

  async function canLaunchStarter() {
    return !hub || (await bao.readMarketplaceGrant()).grant?.claimed === true;
  }

  async function catalog() {
    if (!hub) return MARKETPLACE_RELEASES;
    if (await bao.status() !== 'ready') return [];
    const saved = (await bao.readMarketplaceGrant()).grant;
    if (!saved?.claimed) return [];
    const response = await call(saved, 'catalog', saved.credential);
    if (response.status === 404) return [];
    return readCatalog(response);
  }

  async function publicCatalog() {
    if (!hub) throw new Error('Marketplace origin is not configured');
    const { method, path } = ENDPOINTS.getPublicMarketplaceCatalog;
    return readCatalog(await request(new URL(path, hub), {
      method: method.toUpperCase(), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(4_000),
    }));
  }

  async function readCatalog(response: Response) {
    if (response.status !== 200) throw new Error('Marketplace catalog unavailable');
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('Invalid marketplace catalog');
    return entries.flatMap((entry) => {
      const release = readMarketplaceListing(entry);
      return release ? [release] : [];
    });
  }

  function platformCatalog(platformId?: string) {
    if (!hub) throw new Error('Marketplace origin is not configured');
    const path = platformId === undefined ? ENDPOINTS.listMarketplacePlatforms.path
      : ENDPOINTS.listMarketplacePlatformReleases.path.replace('{platformId}', encodeURIComponent(platformId));
    return request(new URL(path, hub), { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(4_000) });
  }

  async function acquire(selection: MarketplacePlatformAcquisitionInput) {
    if (!hub || await bao.status() !== 'ready') return undefined;
    const { grant } = await bao.readMarketplaceGrant();
    if (!grant?.claimed) return undefined;
    let response = await call(grant, 'acquisitions', grant.credential, selection);
    if (response.status === 409) {
      const problem = await response.json() as { error?: string };
      if (problem.error !== 'artifact-delivery-required') return undefined;
      response = await call(grant, 'bundle-acquisitions', grant.credential, selection);
    }
    if (response.status === 404 || response.status === 409) return undefined;
    if (response.status !== 200) throw new Error('Marketplace acquisition unavailable');
    const acquired = MarketplaceAcquisitionReceiptSchema.parse(await response.json());
    const { descriptorDigest, ...descriptor } = acquired.release;
    if (!matchesMarketplaceRelease(acquired.release, selection) || marketplacePlatformDescriptorDigest(descriptor) !== descriptorDigest) {
      throw new Error('Marketplace receipt does not match the approved release');
    }
    return acquired;
  }

  async function pullGrant(selection: MarketplacePlatformAcquisitionInput) {
    if (!hub || await bao.status() !== 'ready') throw new Error('Connect the marketplace before requesting registry access');
    const { grant } = await bao.readMarketplaceGrant();
    if (!grant?.claimed) throw new Error('Connect the marketplace before requesting registry access');
    const response = await call(grant, 'pulls', grant.credential, selection);
    if (!response.ok) throw new Error('The marketplace did not authorize this release pull');
    const ticket = MarketplaceArtifactGrantSchema.parse(await response.json());
    const registry = new URL(ticket.registry);
    if (registry.origin !== ticket.registry || registry.protocol !== 'https:' || Date.parse(ticket.expiresAt) <= Date.now()) {
      throw new Error('The marketplace returned an invalid registry grant');
    }
    return ticket;
  }

  return { connection, enroll, canLaunchStarter, catalog, publicCatalog, platformCatalog, acquire, pullGrant };
}
