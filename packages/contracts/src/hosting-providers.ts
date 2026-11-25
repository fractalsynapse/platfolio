import { CapabilityInfoSchema, CONTRACT_NAME, CONTRACT_VERSION, HostingProviderIdSchema, satisfiesRange, type InfraProvider } from './infra.ts';

export function hostingProviders(providers: readonly InfraProvider[], requiredRange = `^${CONTRACT_VERSION}`) {
  const registered = new Map<string, InfraProvider>();
  for (const implementation of providers) {
    const info = CapabilityInfoSchema.parse(implementation.describe());
    const id = HostingProviderIdSchema.parse(info.provider);
    if (registered.has(id)) throw new Error(`${CONTRACT_NAME}: provider "${id}" is registered twice`);
    if (!satisfiesRange(info.contract, requiredRange)) {
      throw new Error(`${CONTRACT_NAME}: provider "${id}" at ${info.contract} does not satisfy required range "${requiredRange}"`);
    }
    for (const operation of info.operations) {
      if (typeof implementation[operation] !== 'function') {
        throw new Error(`${CONTRACT_NAME}: provider "${id}" advertises "${operation}" without implementing it`);
      }
    }
    registered.set(id, implementation);
  }
  return {
    get: (id: string) => registered.get(id),
    require(id: string) {
      const provider = registered.get(id);
      if (!provider) throw new Error(`${CONTRACT_NAME}: provider "${id}" is not configured`);
      return provider;
    },
  };
}
