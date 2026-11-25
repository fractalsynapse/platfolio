import type { AuditEntry, NotificationRule } from './persistence.ts';

export const notificationEvents = [
  { action: 'availability.down', event: 'app-outage', result: null },
  { action: 'secret.deliver', event: 'secret-updated', result: null },
  { action: 'attestation.record', event: 'deployment-failed', result: 'failed' },
] as const satisfies readonly { action: string; event: NotificationRule['event']; result: string | null }[];

export function notificationEventFor(entry: Pick<AuditEntry, 'action' | 'detail'>): NotificationRule['event'] | undefined {
  return notificationEvents.find(({ action, result }) => action === entry.action && (result === null || result === entry.detail.result))?.event;
}
