import type { MarketplaceReleaseSelection } from './marketplace-release.ts';
import type { HostedCustomDomain } from './infra.ts';

export interface SourceReleaseProgress {
  step: string;
  state: string;
  resourceId?: string;
  detail?: string;
}

export type SourceReleaseDomainResult =
  | { outcome: 'listed'; domains: HostedCustomDomain[] }
  | { outcome: 'attached'; domain: HostedCustomDomain }
  | { outcome: 'detached' | 'conflict' | 'not-available' };

export interface SourceReleaseObserver {
  step(event: SourceReleaseProgress): void;
  project(id: string): void;
}

export interface SourceReleaseHosting {
  readonly template: string;
  readonly revision: string;
  deploy(input: { release?: MarketplaceReleaseSelection & { image?: string | undefined }; projectId?: string; publicLabel?: string; bootstrap?: string }, observer: SourceReleaseObserver):
    Promise<{ project: string; deployment: string; origin?: string }>;
  remove(projectId: string, data: 'keep' | 'wipe'): Promise<{ retainedVolumes: string[] }>;
  domains(projectId: string, deploymentId: string, action: 'list' | 'attach' | 'detach', hostname?: string): Promise<SourceReleaseDomainResult>;
  publicLabel(origin: string): Promise<string | null>;
}
