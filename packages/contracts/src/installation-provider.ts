import { z } from 'zod';

const installationEnvironment = z.enum(['staging', 'production']);
export type InstallationEnvironment = z.infer<typeof installationEnvironment>;
export interface InstallationWorkspace { id: string; name: string }
export interface InstallationAuthorization {
  workspaces: readonly InstallationWorkspace[];
  expires: number;
  launch(input: InstallationLaunchInput, observe: InstallationObserver): Promise<void>;
}
export const InstallationLaunchInputSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  name: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  environments: z.array(installationEnvironment).min(1).max(2)
    .refine((values) => new Set(values).size === values.length).meta({ uniqueItems: true }),
  // The provider supports variable interpolation in template values.
  ownerEmail: z.string().max(254).regex(/^[^\s${}"\\@]+@[^\s${}"\\@]+\.[^\s${}"\\@]+$/).meta({ format: 'email' }),
  verifier: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  salt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
}).strict();
export type InstallationLaunchInput = z.infer<typeof InstallationLaunchInputSchema>;
export interface InstallationObserver {
  step(label: string, state: 'WORKING' | 'READY' | 'FAILED'): void;
  project(id: string): void;
  environment(name: InstallationEnvironment, origin: string): void;
}
export interface InstallationAuthorizationRequest {
  state: string;
  url: string;
  complete(input: { code: string; state: string; issuer: string; error: string }): Promise<InstallationAuthorization>;
}
export interface InstallationProvider {
  id: string;
  revision: string;
  authorize(): InstallationAuthorizationRequest;
}
