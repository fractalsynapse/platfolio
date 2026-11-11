/** `pnpm run db:seed-dev` -- one team to hang a smoke test on. Idempotent by name. */
import { PostgresStore } from '../packages/contracts/src/postgres-store.ts';
import { reasonOf } from '../packages/contracts/src/persistence.ts';

const url = process.env.PLATFOLIO_DB_URL ?? 'postgresql://postgres:platfolio-dev-only@localhost:5432/platfolio';
const idp = process.env.KC_BASE ?? 'http://localhost:8081';

/**
 * Membership is seeded from the *identity provider's* own subject id, because that is the key the control
 * plane authorizes against. Hard-coding a plausible uuid would leave a stack that looks configured and
 * authorizes nobody -- the failure this script exists to avoid.
 */
const subjectOf = async (username: string): Promise<string> => {
  const form = new URLSearchParams({ grant_type: 'password', client_id: 'platfolio-api', client_secret: 'platfolio-dev-only', username, password: 'platfolio-dev-only' });
  const response = await fetch(`${idp}/realms/platfolio/protocol/openid-connect/token`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  if (!response.ok) throw new Error(`no token for ${username} from ${idp} (${String(response.status)}) -- run pnpm run identity:seed`);
  const jwt = ((await response.json()) as { access_token: string }).access_token;
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string };
  if (!payload.sub) throw new Error(`token for ${username} carries no sub claim`);
  return payload.sub;
};

const store = new PostgresStore({ connectionString: url });
try {
  if (!(await store.ping())) throw new Error('cannot reach the database or the schema is not migrated -- docker compose up -d postgres && pnpm run db:migrate');

  const teams = await store.listTeams();
  const ensureTeam = async (name: string) => {
    const existing = teams.find((t) => t.name === name);
    if (existing) return existing.id;
    const created = await store.createTeam({ name });
    if (!created.ok) throw new Error(`team create refused: ${reasonOf(created)}`);
    return created.value.id;
  };

  const ownedId = await ensureTeam('dev-workspace');
  // A second team with NO membership: the live way to prove a caller cannot see or touch another team's
  // records. Without it, "cross-team reads are 404" is only ever tested against an empty database.
  const otherId = await ensureTeam('other-workspace');

  const adrian = await subjectOf('adrian');
  // Resolve the person from (issuer, subject) exactly as the request guard does. A membership written
  // against any other key would seed successfully and then be invisible at request time -- the worst kind
  // of green, and the reason this script resolves rather than inserts.
  const person = await store.resolvePerson({ issuer: `${idp}/realms/platfolio`, subject: adrian, label: 'adrian' });
  if (!person.ok) throw new Error(`person resolve refused: ${reasonOf(person)}`);
  const member = await store.putTeamMember({ teamId: ownedId, personId: person.value.person.id, role: 'owner' });
  if (!member.ok) throw new Error(`membership refused: ${reasonOf(member)}`);
  const readBack = await store.teamsForPerson(person.value.person.id);
  if (!readBack.includes(ownedId)) throw new Error(`membership written but not readable: ${JSON.stringify(readBack)}`);
  if ((await store.teamsForPerson('person-with-no-membership')).length > 0) throw new Error('a person with no membership resolved to teams');

  process.stdout.write(`D team ${ownedId} (dev-workspace) owned by person ${person.value.person.id}\n`);
  process.stdout.write(`D team ${otherId} (other-workspace) has no members -- the cross-team probe target\n`);
} finally {
  await store.close();
}
