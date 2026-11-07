// E9 probe: does the framework validate a plugin's `Config` (declared as StandardSchemaV1 in
// cordis/registry.ts) at load time? A minimal hand-written StandardSchemaV1 object is used so the
// answer is about the framework, not about a particular schema library.

import { Context } from 'cordis';

export interface ProbeConfig {
  driver: string;
  retries?: number;
}

export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: 'platfolio-e9-probe',
    validate(value: unknown) {
      if (typeof value !== 'object' || value === null) {
        return { issues: [{ message: 'config must be an object', path: [''] }] };
      }
      const record = value as Record<string, unknown>;
      if (typeof record.driver !== 'string') {
        return { issues: [{ message: 'driver must be a string', path: ['driver'] }] };
      }
      if (record.retries !== undefined && typeof record.retries !== 'number') {
        return { issues: [{ message: 'retries must be a number', path: ['retries'] }] };
      }
      return { value: value as ProbeConfig };
    },
  },
};

export default function probe(ctx: Context, config: ProbeConfig) {
  (ctx as any).probeConfig = config;
  ctx.logger.info(`probe plugin applied with driver=${config.driver}`);
}

export const inject = [];
