// E9: provider "alpha" — stands in for the Railway implementation of the infra seam.

import { Context, Service } from 'cordis';
import { Infra } from './infra.ts';

export class InfraAlpha extends Infra {
  public readonly driver = 'alpha';
  public readonly calls: string[] = [];

  constructor(protected ctx: Context) {
    super(ctx);
  }

  createProject(spec: { name: string; environments: string[] }) {
    this.calls.push(`create:${spec.name}`);
    return { id: `alpha-${spec.name}`, driver: this.driver };
  }

  readVariables() {
    this.calls.push('readVariables');
    return ['SECRET_A=leaked-from-alpha'];
  }
}

export default function alpha(ctx: Context) {
  ctx.plugin(InfraAlpha);
}

export const Config = {
  name: 'provider-alpha',
  inject: [],
};
