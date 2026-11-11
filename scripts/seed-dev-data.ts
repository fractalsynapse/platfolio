/** `pnpm run db:seed-dev` -- one team to hang a smoke test on. Idempotent by name. */
import { PostgresStore } from '../packages/contracts/src/postgres-store.ts';
import { reasonOf } from '../packages/contracts/src/persistence.ts';

const url = process.env.PLATFOLIO_DB_URL ?? 'postgresql://postgres:platfolio-dev-only@localhost:5432/platfolio';
const store = new PostgresStore({ connectionString: url });
try {
  if (!(await store.ping())) throw new Error('cannot reach the database or the schema is not migrated -- run `docker compose up -d postgres`, `pnpm run db:migrate`');
  const existing = (await store.listTeams()).find((t) => t.name === 'dev-workspace');
  if (existing) {
    process.stdout.write(`D team already exists: ${existing.id}\n`);
  } else {
    const created = await store.createTeam({ name: 'dev-workspace' });
    if (!created.ok) throw new Error(`team create refused: ${reasonOf(created)}`);
    process.stdout.write(`D created team ${created.value.id}\n`);
  }
} finally {
  await store.close();
}
