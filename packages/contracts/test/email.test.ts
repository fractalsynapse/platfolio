import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MailpitEmailTransport, MemoryEmailTransport, emailConformanceCases, type EmailMessage, type MailboxMessage } from '../src/index.ts';

const RUNS: string[] = [];

async function runSuite(label: string, cases: ReturnType<typeof emailConformanceCases>) {
  for (const c of cases) {
    const outcome = await c.run();
    RUNS.push(`${label}: ${c.name} -> ${outcome.status}${outcome.detail ? ` (${outcome.detail.slice(0, 60)})` : ''}`);
    assert.notEqual(outcome.status, 'fail', `${label} / ${c.name}: ${outcome.detail}`);
  }
}

test('the memory transport satisfies the email conformance suite', async () => {
  await runSuite('memory', emailConformanceCases({
    transport: () => new MemoryEmailTransport({ denylist: ['banned@example.test'], maxBytes: 2000 }),
    readable: true,
    oversized: () => ({ to: ['someone@example.test'], subject: 'big', text: 'x'.repeat(4000) }) as EmailMessage,
    refusing: () => ({ to: ['banned@example.test'], subject: 's', text: 't' }) as EmailMessage,
  }));
});

/**
 * A fake that behaves like Mailpit's API rather than like my hopes: it stores messages, answers /api/v2/messages
 * in Mailpit's shape, and fails like a stopped container. The suite is the same one the real thing will run
 * against in the local stack -- that is the point of writing it once.
 */
function fakeMailpit(options: { down?: boolean } = {}) {
  // Mirrors what the running Mailpit v1.24 actually accepts and returns -- Email not Address, Text not
  // PlainText, Headers as a map, ReplyTo as its own field, `/api/v1/messages` with no server-side recipient
  // filter, no body in the list, no headers in the detail, and the correlation id visible only in `/raw`.
  // Rewritten from the probe output, because an invented fake tests the invention rather than the vendor.
  const store: MailboxMessage[] = [];
  let sequence = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (options.down === true) throw new Error('ECONNREFUSED mailpit:8025');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const text = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });
    if (href.endsWith('/api/v1/info')) return json({ version: 'fake' });
    if (href.endsWith('/api/v1/send')) {
      const p = JSON.parse(String(init?.body)) as { From: { Email: string }; To: Array<{ Email: string }>; Subject: string; Text: string; HTML?: string; Headers?: Record<string, string>; ReplyTo?: Array<{ Email: string }> };
      if (p.From.Email === undefined || p.To.some((r) => r.Email === undefined)) return json({ Error: 'json: cannot unmarshal into Go struct field SendRequest' }, 400);
      if (p.Text === undefined) return json({ Error: 'a body is required' }, 400);
      if (p.Headers !== undefined && 'Reply-To' in p.Headers) return json({ Error: `cannot overwrite header: "Reply-To"` }, 400);
      sequence += 1;
      const id = `fake-${String(sequence).padStart(3, '0')}`;
      store.push({
        to: p.To.map((r) => r.Email), subject: p.Subject, text: p.Text,
        ...(p.HTML === undefined ? {} : { html: p.HTML }),
        ...(p.Headers?.['X-Platfolio-Correlation'] === undefined ? {} : { correlationId: p.Headers['X-Platfolio-Correlation'] }),
        providerId: id, receivedAt: new Date(1700000000000 + sequence * 1000).toISOString(),
      });
      return json({ ID: id });
    }
    const listMatch = href.includes('/api/v1/messages');
    if (listMatch) {
      return json({ total: store.length, messages: store.map((m) => ({ ID: m.providerId, Subject: m.subject, To: m.to.map((Address) => ({ Address })), Created: m.receivedAt })) });
    }
    const idMatch = /\/api\/v1\/message\/([^/?]+)(\/raw)?$/.exec(href);
    if (idMatch === null) return new Response('not found', { status: 404 });
    const found = store.find((m) => m.providerId === decodeURIComponent(idMatch[1] ?? ''));
    if (found === undefined) return new Response('not found', { status: 404 });
    if (idMatch[2] !== undefined) {
      return text([`Message-ID: <${found.providerId}@mailpit>`, `Subject: ${found.subject}`,
        `To: ${found.to.join(', ')}`,
        ...(found.correlationId === undefined ? [] : [`X-Platfolio-Correlation: ${found.correlationId}`]), '', found.text].join('\r\n'));
    }
    return json({ ID: found.providerId, Text: found.text, ...(found.html === undefined ? {} : { HTML: found.html }), To: found.to.map((Address) => ({ Address })) });
  }) as unknown as typeof fetch;
  const transport = () => new MailpitEmailTransport({ url: 'http://mailpit.test:8025', from: 'platfolio@example.test', fetchImpl });
  return { transport, store };
}

test('the Mailpit transport satisfies the same suite as the double', async () => {
  const fake = fakeMailpit();
  await runSuite('mailpit', emailConformanceCases({ transport: fake.transport, readable: true }));
});

test('a stopped Mailpit is reported as unavailable, not thrown at the caller', async () => {
  const down = fakeMailpit({ down: true });
  const result = await down.transport().send({ to: ['someone@example.test'], subject: 's', text: 't' });
  assert.equal(result.accepted, false, 'an unreachable relay must not look like a send');
  if (result.accepted === false) {
    assert.equal(result.code, 'transport-unavailable', `expected an unavailable classification, got ${result.code}`);
    assert.doesNotMatch(result.reason, /password|secret/i, 'a failure reason must not carry credential-shaped text');
  }
  assert.equal(await down.transport().ping(), false, 'ping must reflect the same outage the send hit');
});

test('reading back is a property of the driver, not a wish', async () => {
  const fake = fakeMailpit();
  const transport = fake.transport();
  const receipt = await transport.send({ to: ['reader@example.test'], subject: 'Invitation', text: 'body', correlationId: 'invite-7' });
  assert.equal(receipt.accepted, true);
  const listed = await transport.listMessages('reader@example.test');
  assert.equal(listed.length, 1, 'the message should be observable in the mailbox');
  assert.equal(listed[0]?.correlationId, 'invite-7', 'the correlation id must survive the round trip -- it is how an invitation is matched to a person');
  const other = await transport.listMessages('nobody@example.test');
  assert.equal(other.length, 0, 'a query for another recipient must not return this message');
});

test('the suite can fail: an always-accepts transport is not conformant', async () => {
  // Written as a falsification of the suite rather than another passing case. If a transport that refuses
  // nothing sails through, the suite is decoration -- and that is precisely how conformance files rot.
  const alwaysAccepts = new MemoryEmailTransport();
  const cases = emailConformanceCases({
    transport: () => alwaysAccepts,
    readable: true,
    oversized: () => ({ to: ['someone@example.test'], subject: 's', text: 'x'.repeat(500) }) as EmailMessage,
    refusing: () => ({ to: ['banned@example.test'], subject: 's', text: 't' }) as EmailMessage,
  });
  const oversized = await cases.find((c) => c.name.includes('oversized payloads'))?.run();
  const refusal = await cases.find((c) => c.name.includes('refusal is typed'))?.run();
  assert.equal(oversized?.status, 'fail', 'an unconfigured double accepted the oversized message, as the suite must notice');
  assert.equal(refusal?.status, 'fail', 'an unconfigured double accepted the refused recipient, as the suite must notice');
  const strict = emailConformanceCases({
    transport: () => new MemoryEmailTransport({ maxBytes: 100, denylist: ['banned@example.test'] }),
    readable: true,
    oversized: () => ({ to: ['someone@example.test'], subject: 's', text: 'x'.repeat(500) }) as EmailMessage,
    refusing: () => ({ to: ['banned@example.test'], subject: 's', text: 't' }) as EmailMessage,
  });
  assert.equal(await strict.find((c) => c.name.includes('oversized payloads'))?.run().then((o) => o?.status), 'pass');
  assert.equal(await strict.find((c) => c.name.includes('refusal is typed'))?.run().then((o) => o?.status), 'pass');
});
