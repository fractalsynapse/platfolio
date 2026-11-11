/** `pnpm run db:migrate` -- the thin command over the store capability's runner (see packages/contracts/src/migrations.ts). */
import { applyMigrations, safeSchema } from '../packages/contracts/src/migrations.ts';

const url = process.env.PLATFOLIO_DB_URL;
if (!url) {
  process.stderr.write('db:migrate needs PLATFOLIO_DB_URL (compose exposes postgres on localhost:5432)\n');
  process.exit(1);
}
const schema = safeSchema(process.env.PLATFOLIO_DB_SCHEMA);
const result = await applyMigrations({ connectionString: url, schema });
for (const a of result.applied) process.stdout.write(`M applied ${a.file} (version ${String(a.version)})\n`);
for (const s of result.skipped) process.stdout.write(`M skip ${String(s)} (already applied)\n`);
process.stdout.write(`M schema ${schema} at [${result.at.join(', ') || 'empty'}]\n`);
