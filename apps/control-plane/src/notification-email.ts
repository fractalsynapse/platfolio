import type { NotificationEmailDelivery, NotificationRule, VerifiedClaims } from '@platfolio/contracts';
import type { ExtensionDescriptor, KernelContext, Request, Response_ } from '@platfolio/kernel';
import type { NotificationDirectory } from './notification-directory.ts';
import { badRequest, send } from './respond.ts';

type Authorize = (context: KernelContext, request: Request) =>
  Promise<{ ok: true; claims: VerifiedClaims } | { ok: false; response: Response_ }>;

const subjects: Record<NotificationRule['event'], string> = {
  'app-outage': 'An app is unavailable',
  'deployment-failed': 'An app deployment failed',
  'secret-updated': 'An environment secret was updated',
};

export async function deliverNotificationEmails(context: Pick<KernelContext, 'store' | 'email'>, directory: NotificationDirectory, now: Date, siteOrigin?: string) {
  const work = await context.store.leaseNotificationEmails(directory.issuer, now.toISOString());
  async function deliver(job: NotificationEmailDelivery): Promise<void> {
    const { preference, instanceId, teamId, event, environment } = job;
    const { personId } = preference;
    const retryAt = new Date(now.getTime() + job.attempts * 120_000).toISOString();
    let next: string | null = null;
    try {
      const address = await directory.verifiedPrimary(preference.subject);
      if (address) {
        const [saved, member, rules] = await Promise.all([
          context.store.getNotificationEmailPreference(personId),
          context.store.getTeamMember(teamId, personId),
          context.store.listNotificationRules(personId),
        ]);
        const subscribed = rules.some(rule => rule.instanceId === instanceId && rule.event === event && rule.enabled &&
          (rule.environment === undefined || rule.environment === environment) && Date.parse(rule.createdAt) <= Date.parse(job.at));
        if (saved?.issuer === preference.issuer && saved.subject === preference.subject && saved.enabledAt === preference.enabledAt &&
            member.ok && Date.parse(member.value.addedAt) <= Date.parse(job.at) && subscribed) {
          const description = subjects[event];
          const link = siteOrigin ? new URL('/dashboard/notifications', siteOrigin).href : undefined;
          const delivered = await context.email.send({
            to: [address], subject: `Platfolio: ${description}`,
            text: [description + '.', 'Open your Platfolio notifications to see the app and environment.', link].filter(Boolean).join('\n\n'),
            correlationId: job.auditId + '-' + personId,
          });
          if (!delivered.accepted && !['rejected', 'payload-too-large'].includes(delivered.code)) next = retryAt;
        }
      }
    } catch {
      next = retryAt;
    }
    await context.store.settleNotificationEmail(job, next);
  }
  await Promise.all(work.map(deliver));
}

export function notificationEmail(authorize: Authorize, now: () => Date, directory?: NotificationDirectory, siteOrigin?: string): ExtensionDescriptor {
  const path = '/api/v1/me/notification-email';
  const unavailable = (): Response_ => ({ status: 503,
    body: { error: 'notification-email-unavailable', message: 'This installation cannot verify your email delivery settings right now. Try again later.' } });
  const available = (context: KernelContext) => directory !== undefined && context.email.driver !== 'none';
  const response = (operation: string, ready: boolean, enabled: boolean): Response_ => ({
    ...send(operation, 200, { available: ready, enabled }), headers: { 'cache-control': 'no-store' },
  });
  return {
    id: 'notification-email',
    requires: ['store', 'identity', 'email'],
    routes: [
      {
        method: 'GET', path, operationId: 'getMyNotificationEmail',
        async handle(request, _params, context) {
          const auth = await authorize(context, request);
          if (!auth.ok) return auth.response;
          const person = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (!person.ok) return unavailable();
          const preference = await context.store.getNotificationEmailPreference(person.value.person.id);
          return response('getMyNotificationEmail', available(context), preference !== undefined);
        },
      }, {
        method: 'PUT', path, operationId: 'updateMyNotificationEmail',
        async handle(request, _params, context) {
          const auth = await authorize(context, request);
          if (!auth.ok) return auth.response;
          const body = request.body as { enabled?: unknown } | undefined;
          if (request.bodyError || typeof body?.enabled !== 'boolean' || Object.keys(body).length !== 1) return badRequest('Choose whether to receive notification emails');
          const { issuer, subject } = auth.claims;
          if (body.enabled) {
            if (!available(context) || !directory || issuer !== directory.issuer) return unavailable();
            try {
              if (!await directory.verifiedPrimary(subject)) return badRequest('Verify your primary email before enabling notification emails');
            } catch { return unavailable(); }
          }
          const person = await context.store.resolvePerson({ issuer, subject });
          if (!person.ok || person.value.person.kind !== 'human') return unavailable();
          const saved = await context.store.setNotificationEmailPreference(person.value.person.id,
            body.enabled ? { issuer, subject, enabledAt: now().toISOString() } : null);
          return saved ? response('updateMyNotificationEmail', available(context), body.enabled) : unavailable();
        },
      },
    ],
    onBoot(context) {
      if (!directory || context.email.driver === 'none') return;
      let pending: Promise<void> | undefined;
      const observe = () => {
        pending ??= deliverNotificationEmails(context, directory, now(), siteOrigin)
          .catch(() => { context.logger.warn('Could not process the notification email queue. Will retry.'); })
          .finally(() => { pending = undefined; });
      };
      const timer = setInterval(observe, 15_000);
      timer.unref();
      return async () => { clearInterval(timer); await pending; };
    },
  };
}
