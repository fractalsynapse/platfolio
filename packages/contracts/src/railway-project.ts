import type { RailwayCredential, RailwayTransport } from './railway-transport.ts';

type ProjectAccess = { transport: RailwayTransport; credential: RailwayCredential };
type Environment = { id: string; name: string };

export async function createRailwayProject({ transport, credential }: ProjectAccess, input: {
  name: string; workspaceId: string; defaultEnvironmentName: string; description: string; prDeploys?: boolean;
}): Promise<string> {
  const data = await transport.graphql<{ projectCreate: { id: string } }>({
    operation: 'projectCreate', credential,
    query: 'mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }',
    variables: { input: { ...input, isPublic: false } },
  });
  return data.projectCreate.id;
}

export async function createRailwayEnvironment({ transport, credential }: ProjectAccess, projectId: string, name: string): Promise<Environment> {
  const data = await transport.graphql<{ environmentCreate: Environment }>({
    operation: 'environmentCreate', credential,
    query: 'mutation ($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id name } }',
    // An empty environment owns its resources. Cloning would share the source environment's service rows.
    variables: { input: { projectId, name, skipInitialDeploys: true } },
  });
  return data.environmentCreate;
}

type Edges<T> = { edges: { node: T }[] };
export type RailwayProject = {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  environments: Edges<Environment>;
};

export async function listRailwayProjects({ transport, credential }: ProjectAccess, workspaceId: string): Promise<RailwayProject[]> {
  const projects: RailwayProject[] = [];
  let after: string | null = null;
  do {
    const data: { projects: Edges<RailwayProject> & { pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await transport.graphql({
        operation: 'projects', credential,
        query: 'query ($workspaceId: String!, $after: String) { projects(workspaceId: $workspaceId, first: 100, after: $after) { edges { node { id name description workspaceId environments { edges { node { id name } } } } } pageInfo { hasNextPage endCursor } } }',
        variables: { workspaceId, after },
      });
    projects.push(...data.projects.edges.map(({ node }) => node));
    if (!data.projects.pageInfo.hasNextPage) return projects;
    const cursor = data.projects.pageInfo.endCursor;
    if (!cursor || cursor === after) throw new Error('Could not verify the full Railway workspace');
    after = cursor;
  } while (after);
  return projects;
}
