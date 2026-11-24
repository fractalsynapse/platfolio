import type { AuditEntry, NotificationRule, Store } from '@platfolio/contracts';

function eventFor(entry: AuditEntry): NotificationRule['event'] | undefined {
  switch (entry.action) {
    case 'availability.down': return 'app-outage';
    case 'secret.deliver': return 'secret-updated';
    case 'attestation.record': return entry.detail.result === 'failed' ? 'deployment-failed' : undefined;
    default: return undefined;
  }
}

export async function listNotificationMatches(store: Pick<Store, 'listNotificationRules' | 'recentAuditForTargets'>, personId: string) {
  const rules = await store.listNotificationRules(personId);
  const enabled = rules.filter((rule) => rule.enabled);
  const targetIds = [...new Set(enabled.map((rule) => rule.instanceId))];
  const entries = await store.recentAuditForTargets(targetIds, 200);
  const updates = entries.flatMap((entry) => {
    const event = eventFor(entry);
    const environment = typeof entry.detail.environment === 'string' ? entry.detail.environment : undefined;
    if (!event || !enabled.some((rule) => rule.instanceId === entry.target && rule.event === event &&
        (rule.environment === undefined || rule.environment === environment) && Date.parse(entry.at) >= Date.parse(rule.createdAt))) return [];
    return [{ id: entry.id, at: entry.at, instanceId: entry.target, event, ...(environment ? { environment } : {}) }];
  });
  return { rules, updates };
}
