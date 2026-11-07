// E9: the capability contract, expressed the way platfolio intends to express it —
// a named service that consumers resolve through `inject`, never by importing an implementation.

import { Context, Service } from 'cordis';

export interface ProjectSpec {
  name: string;
  environments: string[];
}

export interface InfraIntercept {
  region?: string;
  maxProjects?: number;
  labels?: string[];
}

/** The `infra.provider` seam. Providers register themselves as `ctx.infra`. */
export class Infra extends Service<InfraIntercept> {
  static provide = 'infra';

  constructor(protected ctx: Context) {
    super(ctx, 'infra');
  }

  /** Per-tenant layered configuration, resolved through framework interception. */
  scope(): InfraIntercept {
    return this[Service.resolveIntercept]();
  }

  createProject(_spec: ProjectSpec): { id: string; driver: string } {
    throw new Error('not implemented by the base capability');
  }

  /** Present so the spike can observe that consumers can call it; platfolio must never call it. */
  readVariables(): string[] {
    throw new Error('not implemented');
  }
}

declare module 'cordis' {
  interface Context {
    infra: Infra;
  }
}
