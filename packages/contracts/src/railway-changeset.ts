import type { EnvironmentPlan, InfraPlan } from './infra.ts';

/**
 * Building Railway's config-as-code change set.
 *
 * The shape was not guessed: it is taken from `railway config plan --json` run against a graph written
 * with railway@3.16.0, captured in test/fixtures/railway-desired-graph.json and asserted against. That
 * matters because the API **accepts any JSON and reports `changes: []`** -- an unknown key, a wrong
 * nesting, even `type: "NOT_A_TYPE"` all come back "applied" with nothing created and no diagnostic.
 * Nothing about this payload can be learned by trial and error; see
 * docs/research/railway-token-and-sealing-2026-11-08.md.
 */

/** The 15 keys every node carries. Omitting them is allowed; `null` is what the CLI emits. */
export interface GraphNode {
  address: string;
  type: 'service' | 'database' | 'bucket' | 'volume' | 'group';
  kind: string | null;
  name: string;
  engine: string | null;
  variables: Record<string, GraphVariable> | null;
  source: { image?: string; repo?: string; type: 'image' | 'repo' } | null;
  build: unknown;
  deploy: unknown;
  networking: unknown;
  volumeAttachments: Record<string, { mountPath: string; volume: string }> | null;
  config: unknown;
  groupId: null;
  tracing: null;
  cdn: null;
}

export type GraphVariable =
  | { type: 'literal'; value: string }
  | { type: 'reference'; resource: string; output: string }
  | { type: 'preserve' };

const ENGINE_IMAGE: Record<string, string> = {
  postgres: 'ghcr.io/railwayapp-templates/postgres-ssl:18',
  mysql: 'ghcr.io/railwayapp-templates/mysql-ssl:8',
  redis: 'ghcr.io/railwayapp-templates/redis-ssl:8',
  mongo: 'ghcr.io/railwayapp-templates/mongo-ssl:8',
};

const node = (partial: Partial<GraphNode> & { address: string; type: GraphNode['type']; name: string }): GraphNode => ({
  kind: null, engine: null, variables: null, source: null, build: null, deploy: null, networking: null,
  volumeAttachments: null, config: null, groupId: null, tracing: null, cdn: null, ...partial,
});

/**
 * Databases and buckets come from the plan's resource lists; a database's image is Railway's own
 * template registry, which is what makes it a managed database rather than a container we run.
 */
export function buildDesiredGraph(plan: InfraPlan, environment: EnvironmentPlan): { project: { name: string }; resources: GraphNode[] } {
  const resources: GraphNode[] = [];

  for (const database of environment.databases) {
    resources.push(node({
      address: `database.${database.name}`, type: 'database', kind: 'database', name: database.name,
      engine: database.kind, source: { image: ENGINE_IMAGE[database.kind] ?? `ghcr.io/railwayapp-templates/${database.kind}-ssl:latest`, type: 'image' },
    }));
  }
  for (const bucket of environment.buckets) {
    resources.push(node({
      address: `bucket.${bucket.name}`, type: 'bucket', name: bucket.name,
      config: bucket.region ? { region: bucket.region } : {},
    }));
  }
  for (const volume of environment.volumes ?? []) {
    resources.push(node({ address: `volume.${volume.name}`, type: 'volume', name: volume.name, config: volume.sizeMB ? { sizeMB: volume.sizeMB } : {} }));
  }

  for (const service of environment.services) {
    const variables: Record<string, GraphVariable> = {};
    for (const entry of service.env) {
      if (entry.literal !== undefined) variables[entry.name] = { type: 'literal', value: entry.literal };
    }
    for (const secret of service.secrets) {
      // `preserve` is the whole point: the value stays in Railway and never crosses platfolio.
      if (secret.source === 'preserve' || secret.source === 'shared-variable') variables[secret.name] = { type: 'preserve' };
    }

    for (const reference of service.references ?? []) {
      if (!environment.databases.some((d) => d.name === reference.database)) {
        throw new Error(`service "${service.name}" references database "${reference.database}", which "${environment.name}" does not declare`);
      }
      variables[reference.variable] = { type: 'reference', resource: `database.${reference.database}`, output: reference.output ?? 'DATABASE_URL' };
    }

    resources.push(node({
      address: `service.${service.name}`, type: 'service', kind: 'docker-image', name: service.name,
      source: { image: `${service.image}@${service.digest}`, type: 'image' },
      variables,
      volumeAttachments: Object.fromEntries((environment.volumes ?? []).filter((v) => v.service === service.name).map((v) => [v.name, { mountPath: v.mountPath, volume: `volume.${v.name}` }])),
      deploy: {
        healthcheckPath: service.healthPath,
        numReplicas: service.replicas,
        ...(service.command ? { startCommand: service.command } : {}),
        ...(service.preDeployCommand ? { preDeployCommand: service.preDeployCommand } : {}),
      },
    }));
  }

  return { project: { name: plan.manifestRef.template }, resources };
}
