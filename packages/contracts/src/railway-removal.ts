import type { RailwayCredential, RailwayTransport } from './railway-transport.ts';

export type RailwayDeployment = { id: string; status: string };
export type RailwayRemovalFailure = { step: string; code: string; message: string };

const stopped = new Set(['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED']);

export async function stopRailwayDeployments(input: {
  transport: RailwayTransport;
  credential: RailwayCredential;
  read: () => Promise<RailwayDeployment[]>;
  sleep: (ms: number) => Promise<void>;
  attempts: number;
  intervalMs: number;
}): Promise<void> {
  const { transport, credential, read, sleep } = input;
  const initial = await read();
  const ids = new Set(initial.filter(({ status }) => !stopped.has(status) && status !== 'REMOVING').map(({ id }) => id));
  for (const id of ids) {
    await transport.graphql<{ deploymentRemove: boolean }>({
      operation: 'deploymentRemove',
      credential,
      query: 'mutation ($id: String!) { deploymentRemove(id: $id) }',
      variables: { id },
    }).catch(() => undefined); // The deployment can disappear even when the request times out.
  }
  for (let attempt = 0; attempt < input.attempts; attempt++) {
    if ((await read()).every(({ status }) => stopped.has(status))) return;
    if (attempt + 1 < input.attempts) await sleep(input.intervalMs);
  }
  throw new Error('A deployment is still active or its stop could not be verified');
}

export async function wipeRailwayProject(input: {
  transport: RailwayTransport;
  credential: RailwayCredential;
  projectId: string;
  projectExists: () => Promise<boolean>;
}): Promise<RailwayRemovalFailure | undefined> {
  let accepted: boolean;
  try {
    const result = await input.transport.graphql<{ projectDelete: boolean }>({
      operation: 'projectDelete',
      credential: input.credential,
      query: 'mutation ($id: String!) { projectDelete(id: $id) }',
      variables: { id: input.projectId },
    });
    accepted = result.projectDelete === true;
  } catch {
    return { step: 'project', code: 'teardown-unverified', message: 'Railway did not confirm the deletion request' };
  }
  if (!accepted) return { step: 'project', code: 'teardown-refused', message: 'Railway refused project deletion' };
  try {
    if (await input.projectExists()) {
      return { step: 'project', code: 'teardown-incomplete', message: 'Railway still lists the project' };
    }
  } catch {
    return { step: 'project', code: 'teardown-unverified', message: 'Railway project removal could not be verified' };
  }
}
