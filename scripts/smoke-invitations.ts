/**
 * `pnpm run invitations:smoke` — the invitation flow, live (#186, D44/D46).
 *
 * Everything here is a real component: Keycloak issues the tokens, Postgres holds the rows, the control plane
 * container speaks SMTP to Mailpit, and the claim is made by a SECOND user signing in with their own verified
 * address. The point is the seam between them -- a unit test with a memory store and a fake transport cannot
 * tell me that the audience mapper, the SMTP dialogue and the migration all agree.
 */
const idp = process.env.KC_BASE ?? 'http://localhost:8081';
const api = process.env.CONTROL_PLANE_BASE ?? 'http://localhost:8082';
const mailpit = process.env.MAILPIT_BASE ?? 'http://localhost:8025';
const realm = 'platfolio';
const secret = 'platfolio-dev-only';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  process.stdout.write(`I ${ok ? 'pass' : 'FAIL'}  ${name} -- ${detail}\n`);
};

const tokenFor = async (username: string): Promise<string | undefined> => {
  const form = new URLSearchParams({ grant_type: 'password', client_id: 'platfolio-api', client_secret: secret, username, password: secret });
  const response = await fetch(`${idp}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  if (!response.ok) return undefined;
  return ((await response.json()) as { access_token?: string }).access_token;
};

const call = async (path: string, init: RequestInit, token: string) => {
  const response = await fetch(api + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await response.text();
  let json: unknown;
  try { json = response.status === 204 ? undefined : JSON.parse(text) as unknown; } catch { json = text; }
  return { status: response.status, json, text };
};

const owner = await tokenFor('adrian');
const hire = await tokenFor('hire');
if (owner === undefined || hire === undefined) {
  check('both users can sign in', false, `adrian=${String(owner !== undefined)} hire=${String(hire !== undefined)} -- run identity:seed first`);
  process.stdout.write(`I ${results.filter((r) => r.ok).length}/${String(results.length)} checks passed\n`);
  process.exit(1);
}

// Who am I, and which team do I own: the /me route from #177 is the way to find the team id without a store handle.
const me = await call('/api/v1/me', {}, owner);
const teams = (me.json as { teams?: Array<{ teamId: string; role: string }> }).teams ?? [];
const teamId = teams.find((t) => t.role === 'owner')?.teamId;
check('the inviter owns a team', teamId !== undefined, JSON.stringify(teams));
if (teamId === undefined) process.exit(1);

// The address the invitee's identity provider actually asserts. A unique-per-run address would be tidier for
// reruns and would prove nothing: acceptance matches on the asserted address, so inviting something nobody
// owns makes the claim path untestable. (That is how the first version of this smoke failed 12/17 -- not a bug
// in the product, in the test.)
const address = 'hire@example.com';
const createAttempt = await call(`/api/v1/teams/${teamId}/invitations`, { method: 'POST', body: JSON.stringify({ email: address, role: 'member' }) }, owner);
let created = createAttempt;
if (createAttempt.status === 409) {
  // A previous interrupted run can leave a pending row (the partial unique index is the point of it). Clear it
  // so the smoke is rerunnable, rather than relaxing the constraint to make the test convenient.
  const pending = (await call(`/api/v1/teams/${teamId}/invitations`, {}, owner)).json as Array<{ id: string; email: string; state: string }>;
  for (const row of pending.filter((r) => r.email === address && r.state === 'pending')) {
    await call(`/api/v1/teams/${teamId}/invitations/${row.id}`, { method: 'DELETE' }, owner);
  }
  created = await call(`/api/v1/teams/${teamId}/invitations`, { method: 'POST', body: JSON.stringify({ email: address, role: 'member' }) }, owner);
}
check('an invitation is created over HTTP', created.status === 201, `${String(created.status)} ${created.text.slice(0, 90)}`);
const invitation = (created.json as { invitation?: { id?: string; email?: string; emailReceipt?: string }; delivery?: { sent?: boolean; reason?: string } }) ?? {};
check('the configured transport reports it sent the mail', invitation.delivery?.sent === true, JSON.stringify(invitation.delivery));
check('the address arrived normalised', invitation.invitation?.email === address.toLowerCase(), String(invitation.invitation?.email));
check('the transport receipt is stored on the row (D46)', typeof invitation.invitation?.emailReceipt === 'string' && (invitation.invitation?.emailReceipt ?? '').length > 0, String(invitation.invitation?.emailReceipt));
const invitationId = invitation.invitation?.id ?? '';

// The mail actually left the process: read it out of Mailpit, not out of my own bookkeeping.
const listed = await fetch(`${mailpit}/api/v1/messages?query=${encodeURIComponent(`to:${address}`)}`).then((r) => r.json()).catch(() => ({ messages: [] })) as { messages?: Array<{ ID: string; Subject?: string }> };
const message = (listed.messages ?? [])[0];
check('Mailpit received a message for that address', message !== undefined, `${String((listed.messages ?? []).length)} message(s)`);
if (message !== undefined) {
  const raw = await fetch(`${mailpit}/api/v1/message/${message.ID}/raw`).then((r) => r.text()).catch(() => '');
  check('the correlation header carries the invitation id', raw.includes(`X-Platfolio-Correlation: ${invitationId}`), 'the claim link is traceable');
  check('and the body tells the recipient what to do, without a token', /sign in/i.test(raw) && !/token=|#[a-f0-9]{16,}/.test(raw), 'no capability secret in the mail');
}

// The claim, by a DIFFERENT person whose IdP asserts that address.
const mine = await call('/api/v1/me/invitations', {}, hire);
const pending = (mine.json as Array<{ id: string }>) ?? [];
check('the invitee discovers their own invitation', pending.some((p) => p.id === invitationId), `${String(pending.length)} pending`);

// Someone else -- the inviter, whose verified address differs -- must not be able to claim it.
const wrongAddress = await call(`/api/v1/me/invitations/${invitationId}/accept`, { method: 'POST' }, owner);
check('a mismatched verified address is answered 404', wrongAddress.status === 404, `${String(wrongAddress.status)} ${wrongAddress.text.slice(0, 70)}`);
check('and the refusal does not leak the invited address', !JSON.stringify(wrongAddress.json).includes(address), 'no email disclosure in the error');

const accepted = await call(`/api/v1/me/invitations/${invitationId}/accept`, { method: 'POST' }, hire);
check('the invitee accepts and becomes a member', accepted.status === 200, `${String(accepted.status)} ${accepted.text.slice(0, 80)}`);
check('the granted role is what was invited', (accepted.json as { role?: string })?.role === 'member', JSON.stringify(accepted.json));

// The proof that the grant took effect -- and not `status === 200`, which a caller with NO teams also gets
// (an empty list is a valid answer). Assert the membership itself, the way #177 exposes it.
const hireMe = await call('/api/v1/me', {}, hire);
const hireTeams = (hireMe.json as { teams?: Array<{ teamId: string; role: string }> }).teams ?? [];
check('the accepted invitation shows up as a real membership', hireTeams.some((x) => x.teamId === teamId && x.role === 'member'), JSON.stringify(hireTeams));
const afterAccept = await call('/api/v1/me/invitations', {}, hire);
check('an accepted invitation leaves the pending list', ((afterAccept.json as Array<unknown>) ?? []).length === 0, JSON.stringify(afterAccept.json));

const repeat = await call(`/api/v1/me/invitations/${invitationId}/accept`, { method: 'POST' }, hire);
check('the same invitation cannot be accepted twice', repeat.status === 409, String(repeat.status));

const readBack = await call(`/api/v1/teams/${teamId}/invitations`, {}, owner);
const row = ((readBack.json as Array<{ id: string; state: string; emailReceipt?: string }>) ?? []).find((r) => r.id === invitationId);
check('the row ends as accepted, with its receipt', row?.state === 'accepted' && typeof row?.emailReceipt === 'string', JSON.stringify(row));

const failed = results.filter((r) => !r.ok).length;
process.stdout.write(`I ${String(results.length - failed)}/${String(results.length)} checks passed\n`);
process.exit(failed > 0 ? 1 : 0);
