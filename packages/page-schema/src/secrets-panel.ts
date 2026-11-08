import { requiredSecrets, serviceEnvironments, enabledEnvironments, type Manifest } from '@platfolio/manifest';
import { PageSchema, type Node, type Page, type SecretGroup } from './page.ts';

export interface PanelCapabilities {
  /** D21: sealing is what makes the relay safe, so its absence changes the UI, not just the copy. */
  sealedVariables: boolean;
  custody: 'managed' | 'strict';
  /** Provider deep link template, with `{instance}`, `{service}`, `{environment}`, `{name}` markers. */
  entryLinkTemplate?: string;
}

export interface PanelInstance {
  instanceId: string;
  /** Environments that exist on this instance. A service absent here gets no rows. */
  environments: string[];
  /**
   * Secrets known satisfied. Presence is inferred from a healthy deployment (behavioral
   * verification), never from reading a value, so this is a set of names, not values.
   */
  satisfied: { service: string; environment: string; name: string }[];
}

const slug = (...parts: string[]): string => parts.join('-').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

export function buildSecretsPanel(m: Manifest, instance: PanelInstance, caps: PanelCapabilities): Page {
  const children: Node[] = [];
  const enabled = enabledEnvironments(m);
  children.push({
    component: 'heading',
    props: { id: slug('h', instance.instanceId), level: 1, text: `Secrets — ${m.metadata.title}` },
  });

  const mode: 'relay-sealed' | 'tenant-side' | 'runner-side' =
    caps.custody === 'strict' ? 'runner-side' : caps.sealedVariables ? 'relay-sealed' : 'tenant-side';

  children.push({
    component: 'notice',
    props: {
      id: slug('note', instance.instanceId, mode),
      tone: mode === 'relay-sealed' ? 'info' : 'warning',
      text: mode === 'relay-sealed'
        ? 'Values are delivered once and sealed. platfolio cannot read them back, so this form never shows one.'
        : mode === 'tenant-side'
          ? 'This provider does not support sealed variables, so platfolio will not write them. Enter each value in your own project; nothing here sends a value anywhere.'
          : 'Strict custody: platfolio holds no provider credential. Set these where your CI can reach them.',
    },
  });

  for (const environment of instance.environments) {
    if (!enabled.includes(environment as 'production' | 'staging')) {
      children.push({
        component: 'notice',
        props: { id: slug('env', instance.instanceId, environment, 'unknown'), tone: 'warning', text: `Environment "${environment}" is not declared by this platform.` },
      });
      continue;
    }
    children.push({ component: 'heading', props: { id: slug('env', instance.instanceId, environment), level: 2, text: environment } });

    for (const s of requiredSecrets(m)) {
      if (!s.environments.includes(environment)) continue; // D23: production-only services get no staging rows
      const group = children.find(
        (c): c is SecretGroup => c.component === 'secret-group' && c.props.service === s.service && c.props.environment === environment,
      );
      const satisfied = instance.satisfied.some((x) => x.service === s.service && x.environment === environment && x.name === s.name);
      const field: Node = mode === 'runner-side'
        ? {
          component: 'instructions',
          props: {
            id: slug('instr', s.service, environment, s.name),
            title: `${s.name} (${s.service})`,
            steps: [
              'Create this secret in your CI as an environment secret.',
              'The deploy that uses it must succeed before platfolio marks it satisfied.',
            ],
          },
        }
        : mode === 'tenant-side'
          ? {
            component: 'link-field',
            props: {
              id: slug('link', s.service, environment, s.name),
              name: s.name, service: s.service, environment,
              href: (caps.entryLinkTemplate ?? 'https://provider.example/instance/{instance}/{environment}#{name}')
                .replace('{instance}', instance.instanceId).replace('{environment}', environment).replace('{name}', s.name),
              label: `Open ${s.service} variables`,
              satisfied,
            },
          }
          : {
            component: 'secret-field',
            props: {
              id: slug('field', s.service, environment, s.name),
              name: s.name, service: s.service, environment,
              source: s.source as 'preserve' | 'shared-variable' | 'customer-held',
              mode: 'relay-sealed',
              label: s.name,
              help: `Delivered to ${s.service} in ${environment}, then sealed. platfolio cannot read it back.`,
              satisfied,
              submitLabel: satisfied ? 'Set a new value' : 'Deliver secret',
              ...(satisfied ? { rotationNotice: 'A sealed value cannot be read back or un-sealed. Set the new value, confirm the deployment is healthy, then revoke the old credential.' } : {}),
            },
          };

      if (group) {
        group.children.push(field as SecretGroup['children'][number]);
      } else {
        children.push({
          component: 'secret-group',
          props: {
            id: slug('group', s.service, environment),
            service: s.service, environment,
            placement: `exists in: ${serviceEnvironments(m.spec.services[s.service]!, enabled).join(', ')}`,
          },
          children: [field],
        });
      }
    }

    if (!requiredSecrets(m).some((s) => s.environments.includes(environment))) {
      children.push({
        component: 'notice',
        props: { id: slug('none', environment), tone: 'info', text: 'No secrets are required for this environment.' },
      });
    }
  }

  const page: Page = {
    component: 'page',
    props: { id: slug('page', instance.instanceId, 'secrets'), title: `Secrets — ${m.metadata.name}`, platform: 'web' },
    children,
  };
  // Validate our own output: a builder bug that produced a value-bearing or malformed node is caught
  // here rather than at render time in someone's browser.
  const parsed = PageSchema.parse(page);
  const valueProps = findValueBearingProps(parsed);
  if (valueProps.length) throw new Error(`built panel carries value-bearing props: ${valueProps.join(', ')}`);
  return parsed;
}

function findValueBearingProps(node: unknown, path = ''): string[] {
  const found: string[] = [];
  if (Array.isArray(node)) { node.forEach((n, i) => found.push(...findValueBearingProps(n, `${path}[${i}]`))); return found; }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const at = path ? `${path}.${key}` : key;
      if (/value/i.test(key) && !/satisfied|labelValue/i.test(key)) found.push(at);
      if (value && typeof value === 'object') found.push(...findValueBearingProps(value, at));
    }
  }
  return found;
}
