export const TEMPLATE_CATEGORIES = {
  'web-apps': 'Web apps',
  'background-workers': 'Background workers',
  identity: 'Sign-in',
} as const;

interface TemplatePresentation {
  readonly title: string;
  readonly category: keyof typeof TEMPLATE_CATEGORIES;
  readonly summary: string;
  readonly access: string;
  readonly kind: 'Web' | 'Worker';
  readonly mode: 'Development' | 'Hosted';
  readonly capabilities: readonly string[];
}

const descriptions: Readonly<Record<string, TemplatePresentation>> = {
  'starter-web': {
    title: 'Starter Web Service', category: 'web-apps', kind: 'Web', mode: 'Development',
    summary: 'Launch a website with a database and an API for other tools to use.',
    access: 'Public website', capabilities: ['JSON API', 'Private PostgreSQL'],
  },
  'starter-worker': {
    title: 'Starter Worker Service', category: 'background-workers', kind: 'Worker', mode: 'Development',
    summary: 'Run background tasks and keep their saved files when you deploy again.',
    access: 'No public web address', capabilities: ['Background jobs', 'Retained storage'],
  },
  'shared-identity': {
    title: 'Shared Identity (Keycloak)', category: 'identity', kind: 'Web', mode: 'Hosted',
    summary: 'Let multiple apps share the same sign-in service.',
    access: 'Public sign-in address', capabilities: ['Shared sign-in (OIDC)', 'PostgreSQL'],
  },
};

export function describeTemplate(name: string): TemplatePresentation {
  const description = descriptions[name];
  if (!description) throw new Error(`Missing presentation metadata for template "${name}".`);
  return description;
}

export const templatePaths = {
  catalog: '/templates',
  details: (name: string) => `/templates/${name}`,
} as const;
