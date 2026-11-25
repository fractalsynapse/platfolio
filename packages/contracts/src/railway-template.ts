import { createHash } from 'node:crypto';
import type { RailwayCredential, RailwayTransport } from './railway-transport.ts';

export type RailwayAccess = { transport: RailwayTransport; credential: RailwayCredential };
export type RailwayTemplateConfig = { services?: Record<string, Record<string, unknown>> };

export async function readRailwayTemplate({ transport, credential }: RailwayAccess, code: string) {
  const data = await transport.graphql<{ template: { id?: string | null; serializedConfig?: RailwayTemplateConfig | null } }>({
    operation: 'template', credential,
    query: 'query ($code: String!) { template(code: $code) { id serializedConfig } }', variables: { code },
  });
  return data.template;
}

export async function deployRailwayTemplate({ transport, credential }: RailwayAccess, input: {
  templateId: string; serializedConfig: RailwayTemplateConfig; projectId: string; environmentId: string; workspaceId: string;
}) {
  const data = await transport.graphql<{ templateDeployV2: { operationId?: string | null; workflowId?: string | null } }>({
    operation: 'templateDeployV2', credential,
    query: 'mutation ($input: TemplateDeployV2Input!) { templateDeployV2(input: $input) { operationId workflowId } }',
    variables: { input },
  });
  return data.templateDeployV2;
}

export function railwayTemplateDigest(config: RailwayTemplateConfig): string {
  const canonical = JSON.stringify(config, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left === right ? 0 : 1));
  });
  return createHash('sha256').update(canonical).digest('hex');
}
