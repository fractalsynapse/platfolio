import { bindingStatus, type Binding, type BindingStatus, type ProviderInstance } from '@platfolio/contracts';
import { PageSchema, type Node, type Page } from './page.ts';

/**
 * The capability-binding screen (D34, the UI half of #94).
 *
 * It exists because the underlying state is genuinely confusing otherwise: a team can have three consumers
 * of one identity provider, two of them stale, and nothing in the instance list says so — each looks
 * perfectly healthy. The summary form ("2 of 3 need attention") is the only shape that makes the situation
 * visible without clicking through instances, and it is built from the same `bindingStatus` the controller
 * uses, so a screen and a scheduler cannot disagree about what stale means.
 *
 * Two rules carried over from the model, not invented here:
 * - **A credential is never rendered.** Secret outputs appear as state plus a re-issue action; there is no
 *   place in this file where a value could go, matching the schema that forbids one in the binding record.
 * - **Nothing is presented as fixed.** A stale binding offers rebind and says the supplier changed; it does
 *   not quietly look healthy because a value was once written.
 */

const slug = (...parts: string[]): string => parts.join('-').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

const TONE: Record<BindingStatus, 'ok' | 'pending' | 'problem'> = {
  ok: 'ok',
  'rebind-required': 'pending',
  'provider-gone': 'problem',
  're-issue-required': 'problem',
};

const LABEL: Record<BindingStatus, string> = {
  ok: 'Current',
  'rebind-required': 'Supplier changed',
  'provider-gone': 'Provider missing',
  're-issue-required': 'Credential lost',
};

export interface BindingPanelInput {
  /** The instance whose consumers are shown, or `undefined` for the team-wide view. */
  instanceId?: string;
  /** Display names for capabilities, so the screen says "Identity" rather than "identity". */
  capabilityTitles?: Record<string, string>;
  /** Providers by capability name; pass the team's current set so staleness can be computed. */
  providers: ProviderInstance[];
}

const needsAttention = (status: BindingStatus): boolean => status !== 'ok';

/** Every node type used here is already in the page registry, so no renderer or mobile SDK has to grow. */
export function buildBindingPanel(bindings: Binding[], input: BindingPanelInput): Page {
  const scoped = input.instanceId ? bindings.filter((b) => b.dependentInstanceId === input.instanceId) : bindings;
  const children: Node[] = [];
  const title = input.instanceId ? `Connections — ${input.instanceId}` : 'Team connections';
  children.push({ component: 'heading', props: { id: slug('h', input.instanceId ?? 'team'), level: 1, text: title } });

  if (scoped.length === 0) {
    children.push({
      component: 'notice',
      props: {
        id: slug('note', input.instanceId ?? 'team', 'empty'),
        tone: 'info',
        text: 'Nothing here requires a service from another part of the team yet. When a platform declares a capability it needs, its binding status and any credential state appear on this page.',
      },
    });
    return PageSchema.parse({ component: 'page', props: { id: slug('page', input.instanceId ?? 'team'), title, platform: 'web' }, children });
  }

  const byCapability = new Map<string, { binding: Binding; status: BindingStatus; detail: string }[]>();
  for (const binding of scoped) {
    const verdict = bindingStatus(binding, input.providers);
    const list = byCapability.get(binding.capability) ?? [];
    list.push({ binding, status: verdict.status, detail: verdict.detail });
    byCapability.set(binding.capability, list);
  }

  for (const [capability, rows] of [...byCapability.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const stale = rows.filter((r) => needsAttention(r.status));
    const name = input.capabilityTitles?.[capability] ?? capability;
    children.push({ component: 'heading', props: { id: slug('h', capability), level: 2, text: name } });
    children.push({
      component: 'badge',
      props: {
        id: slug('badge', capability),
        tone: stale.length > 0 ? 'problem' : 'ok',
        label: stale.length === 0
          ? `All ${String(rows.length)} connected`
          : `${String(stale.length)} of ${String(rows.length)} need attention`,
      },
    });

    for (const row of rows) {
      children.push({
        component: 'notice',
        props: {
          id: slug('row', capability, row.binding.dependentInstanceId),
          tone: TONE[row.status] === 'problem' ? 'danger' : TONE[row.status] === 'pending' ? 'warning' : 'info',
          text: row.status === 'ok'
            ? `${row.binding.dependentInstanceId} uses ${name} from ${row.binding.providerInstanceId ?? 'a team service'}.`
            : `${row.binding.dependentInstanceId}: ${row.detail}`,
        },
      });

      // Public values are shown as text; a secret output is only ever a state plus an action. If this file
      // could render a client secret, D32 would be a comment rather than a property of the interface.
      for (const value of row.binding.values) {
        children.push({
          component: 'notice',
          props: { id: slug('val', capability, row.binding.dependentInstanceId, value.output), tone: 'info', text: `${value.output}: ${value.value}` },
        });
      }

      if (row.status === 'rebind-required') {
        children.push({
          component: 'action-button',
          props: {
            id: slug('act', capability, row.binding.dependentInstanceId, 'rebind'),
            label: 'Reconnect to the current provider',
            // Rebinding rewrites a running platform's configuration, so it is offered and never automatic;
            // the label carries that, because the page model has no confirmation field to hide it in.
            action: 'rebind',
            target: 'bindings.rebind',
          },
        });
      }
      for (const secret of row.binding.secretStates) {
        children.push({
          component: 'badge',
          props: {
            id: slug('sec', capability, row.binding.dependentInstanceId, secret.output),
            tone: secret.state === 'issued-and-placed' ? 'ok' : 'problem',
            label: `${secret.output}: ${secret.state === 'issued-and-placed' ? 'configured' : secret.state === 'not-issued' ? 'not issued' : secret.state === 'placement-unknown' ? 'status unknown' : 'needs re-issue'}`,
          },
        });
        if (secret.state !== 'issued-and-placed') {
          children.push({
            component: 'action-button',
            props: {
              id: slug('act', capability, row.binding.dependentInstanceId, secret.output, 'reissue'),
              label: `Re-issue ${secret.output}`,
              action: 'reissue-secret',
              target: 'bindings.reissue',
            },
          });
        }
      }
    }
  }

  children.push({
    component: 'instructions',
    props: {
      id: slug('note', input.instanceId ?? 'team', 'why'),
      title: 'What to do when a credential stops working',
      steps: [
        'Re-issue it at the service that provides it. There is no stored copy here to send again.',
        'The old value stops working as soon as the new one is placed, so expect the consumer to restart.',
        'If the provider itself changed, reconnect the consumer to the current provider instead.',
      ],
    },
  });

  return PageSchema.parse({ component: 'page', props: { id: slug('page', input.instanceId ?? 'team'), title, platform: 'web' }, children });
}
