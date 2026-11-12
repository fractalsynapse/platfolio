import process from 'node:process';
// Relative imports, the convention every script here follows: `scripts/` is not a workspace package,
// so it reaches the code under test by path rather than by package name.
import { createKernel, disposeKernel } from '../packages/kernel/src/index.ts';

/**
 * Proof that platform email works against a real SMTP server, and that "sent" is assertible (D46).
 *
 * Two kernels, both through the plugin path rather than the classes directly: one sends over SMTP to Mailpit's
 * listener on :1025 (exercising the hand-written client against a real server -- framing, CRLF, dot-stuffing,
 * the queue id), the other reads the same mailbox over Mailpit's HTTP API. If the message appears with its
 * correlation id, the whole path is demonstrated end to end. If this passes while `email:check`-style unit
 * tests also pass, the unit tests are not carrying the weight alone.
 */
const smtpHost = process.env.MAILPIT_HOST ?? 'localhost';
const smtpPort = Number(process.env.MAILPIT_SMTP_PORT ?? 1025);
const apiUrl = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const token = `smoke-${Date.now().toString(36)}`;
const recipient = `smoke+${token}@example.test`;
const results: string[] = [];

function check(label: string, pass: boolean, detail = '') {
  results.push(`${pass ? 'pass' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!pass) process.exitCode = 1;
}

const sender = await createKernel({
  email: {
    driver: 'smtp',
    from: 'platfolio@platfolio.test',
    host: smtpHost,
    port: smtpPort,
    secure: false,
    // Mailpit on loopback speaks plaintext SMTP; a real relay must arrive here with startTls=require. Stated
    // rather than implicit, because "off" in production would be a credential leak waiting for a network tap.
    startTls: 'off',
    // Mailpit accepts any credentials; this exercises the AUTH path against a real server. The flat
    // shape is the schema's -- it refused an `auth` object I invented, which is `.strict()` earning its keep.
    user: 'platfolio',
    password: 'any-credentials-accepted-here',
    timeoutMs: 8000,
  },
  requiredServices: ['email'],
});

check('the SMTP transport reaches the relay', await sender.email.ping(), `${smtpHost}:${String(smtpPort)}`);
const receipt = await sender.email.send({
  to: [recipient],
  subject: 'Accept your invitation to platfolio',
  text: `Someone invited you. Correlation ${token}. This message was sent by platfolio's own SMTP client.`,
  correlationId: token,
});
check('the relay accepted the message', receipt.accepted === true, JSON.stringify(receipt));
if (receipt.accepted) check('the relay returned a queue id we can cite in a support thread', typeof receipt.providerId === 'string' && receipt.providerId.length > 0, String(receipt.providerId));

const reader = await createKernel({ email: { driver: 'mailpit', from: 'platfolio@platfolio.test', baseUrl: apiUrl }, requiredServices: ['email'] });
check('the mailbox reader is the same seam, different driver', reader.email.driver === 'mailpit' && reader.email.readable === true);

const found = await reader.email.listMessages(recipient);
check('the message is observable in the mailbox', found.length === 1, `saw ${String(found.length)}`);
const message = found[0];
if (message !== undefined) {
  check('subject and body survived the wire', message.subject.includes('invitation') && message.text.includes(token), JSON.stringify(message.subject));
  check('the correlation id round-tripped as a header', message.correlationId === token, `header=${String(message.correlationId)}`);
}

// Dot-stuffing, proven on a real server rather than only against the scripted one.
const dotted = await sender.email.send({ to: [recipient], subject: 'lines that begin with a dot', text: 'first\r\n.not a terminator\r\nlast' });
check('a body containing a dot-line is accepted', dotted.accepted === true, JSON.stringify(dotted));
const dottedMessages = await reader.email.listMessages(recipient);
const survived = dottedMessages.find((m) => m.subject.includes('dot'))?.text ?? '';
check('and arrives whole, not truncated at the dot', survived.includes('.not a terminator'), JSON.stringify(survived.slice(0, 60)));

await disposeKernel(sender);
await disposeKernel(reader);
for (const line of results) process.stdout.write(`E ${line}\n`);
const failed = results.filter((l) => l.startsWith('FAIL')).length;
process.stdout.write(`E ${String(results.length - failed)}/${String(results.length)} checks passed\n`);
process.exit(failed > 0 ? 1 : 0);
