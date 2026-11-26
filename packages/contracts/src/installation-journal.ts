import { z } from 'zod';
import { InstallationLaunchInputSchema } from './installation-provider.ts';

const installationEnvironment = InstallationLaunchInputSchema.shape.environments.element;
const safeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_/-]+$/);
const readyEnvironment = z.object({ name: installationEnvironment, origin: z.url({ protocol: /^https$/ }), revision: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict();

export const InstallationJournalSchema = z.object({
  id: z.uuid(),
  teamId: safeId,
  personId: safeId,
  name: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  workspaceId: safeId,
  provider: z.string().min(1).max(64),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  requested: z.array(installationEnvironment).min(1).max(2),
  projectId: safeId.optional(),
  submitted: z.array(installationEnvironment).max(2),
  environments: z.array(readyEnvironment).max(2),
  events: z.array(z.object({
    at: z.iso.datetime(),
    step: z.string().min(1).max(120),
    state: z.enum(['WORKING', 'READY', 'FAILED']),
  }).strict()).max(100),
  maintenance: z.discriminatedUnion('action', [
    z.object({ action: z.literal('wipe') }).strict(),
    z.object({ action: z.literal('update'), environment: installationEnvironment, revision: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  ]).optional(),
  state: z.enum(['running', 'failed', 'ready']),
  removedAt: z.iso.datetime().optional(),
  version: z.number().int().min(0),
  leaseUntil: z.iso.datetime(),
}).strict();
export type InstallationJournal = z.infer<typeof InstallationJournalSchema>;
