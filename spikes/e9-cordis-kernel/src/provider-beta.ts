// E9: provider "beta" — the second implementation of the same seam, selected only by configuration.

import { Context, Service } from 'cordis';
import { Infra } from './infra.ts';

export class InfraBeta extends Infra {
  public readonly driver = 'beta';

  constructor(protected ctx: Context) {
    super(ctx);
  }

  createProject(spec: { name: string; environments: string[] }) {
    return { id: `beta-${spec.name}`, driver: this.driver };
  }
}

export default function beta(ctx: Context) {
  ctx.plugin(InfraBeta);
}
