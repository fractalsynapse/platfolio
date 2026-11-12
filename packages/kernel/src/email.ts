import { Context, Service } from 'cordis';
import { z } from 'zod';
import { MailpitEmailTransport, MemoryEmailTransport, NullEmailTransport, SmtpEmailTransport, type EmailMessage, type EmailResult, type EmailTransport, type MailboxMessage, type MailboxReader } from '@platfolio/contracts';

/**
 * The email capability as `ctx.email` (D46) -- the same construction rule as storage and the provider: the
 * driver is configuration, not a branch at the call site.
 *
 * `readable` is a property of the *driver*, exposed honestly rather than hoped for: SMTP relays cannot be read
 * back, and a deployment that wished otherwise gets `false` and an empty list, not an exception. That is the
 * difference between a seam and a leak -- tests may assert on Mailpit's mailbox, production may not accidentally
 * acquire the same power by choosing a driver.
 */
export const EmailConfigSchema = z.object({
  driver: z.enum(['none', 'memory', 'mailpit', 'smtp']).default('none'),
  /** Envelope sender. Never a tenant's address: this is platfolio's own mail identity (D4). */
  from: z.string().min(3).default('platfolio@localhost'),
  /** smtp */
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  secure: z.boolean().default(false),
  user: z.string().optional(),
  /** Read from the environment at the composition root. Never logged, never returned by any endpoint. */
  password: z.string().optional(),
  startTls: z.enum(['require', 'allow', 'off']).default('require'),
  /** mailpit */
  baseUrl: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(20_000),
}).strict();
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
/** What a caller may provide: the schema's defaults are filled in by the service, not demanded of the operator. */
export type EmailConfigInput = z.input<typeof EmailConfigSchema>;

export class EmailService extends Service<EmailConfig> {
  static inject = [] as const;
  static provide = 'email' as const;
  static Config = EmailConfigSchema;

  readonly inner: EmailTransport;
  readonly driver: EmailConfig['driver'];
  /** Whether this driver can also answer "what did the mailbox receive" -- false for a production relay. */
  readonly readable: boolean;

  constructor(ctx: Context, config: EmailConfig) {
    super(ctx, 'email');
    this.driver = config.driver;
    if (config.driver === 'smtp') {
      if (!config.host) throw new Error('email driver "smtp" requires a host (PLATFOLIO_SMTP_HOST)');
      if (config.password !== undefined && config.user === undefined) throw new Error('email driver "smtp" got a password with no user');
      this.inner = new SmtpEmailTransport({
        host: config.host,
        ...(config.port === undefined ? {} : { port: config.port }),
        secure: config.secure,
        startTls: config.startTls,
        from: config.from,
        timeoutMs: config.timeoutMs,
        ...(config.user !== undefined && config.password !== undefined ? { auth: { user: config.user, password: config.password } } : {}),
      });
      this.readable = false;
    } else if (config.driver === 'mailpit') {
      if (!config.baseUrl) throw new Error('email driver "mailpit" requires a baseUrl (PLATFOLIO_MAILPIT_URL)');
      this.inner = new MailpitEmailTransport({ url: config.baseUrl, from: config.from, timeoutMs: config.timeoutMs });
      this.readable = true;
    } else if (config.driver === 'memory') {
      this.inner = new MemoryEmailTransport();
      this.readable = true;
    } else {
      // 'none': present, honest, and refuses with `not-configured`. Chosen as the default so an operator who
      // configures nothing sends nothing -- and, crucially, so the routes that mail exist either way.
      this.inner = new NullEmailTransport();
      this.readable = false;
    }
  }

  send(message: EmailMessage): Promise<EmailResult> { return this.inner.send(message); }
  ping(): Promise<boolean> { return this.inner.ping(); }

  /** A reader that does not exist answers empty rather than throwing: absence of power, not a crash. */
  async listMessages(to?: string): Promise<MailboxMessage[]> {
    const reader = this.inner as EmailTransport & Partial<MailboxReader>;
    if (typeof reader.listMessages !== 'function') return [];
    return reader.listMessages(to);
  }

  *[Service.init]() {
    yield () => { void this.inner.close(); };
  }
}

// The same augmentation every other kernel service performs: `ctx.email` is typed, not discovered at runtime.
declare module 'cordis' {
  interface Context {
    readonly email: EmailService;
  }
}
