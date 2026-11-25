// The browser and the private Keycloak importer use this same credential format.
export const installationOwnerHash = { algorithm: 'pbkdf2-sha256', iterations: 600_000, bits: 512, saltBytes: 16, requiredAction: 'UPDATE_PASSWORD' } as const;
