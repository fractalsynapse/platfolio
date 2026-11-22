import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

/**
 * The migration runner, as part of the store capability rather than a shell script.
 *
 * Migrations are behaviour, and behaviour belongs to the seam: a script in `scripts/` that reaches for `pg`
 * directly cannot be reused by a test creating a scratch schema, a deploy hook, or a second driver, and the
 * first run of this proved it -- the script failed to resolve `pg` from the repository root while the package
 * that owns the dependency was fine. Forward-only, one transaction per file, versions recorded in the schema
 * being migrated.
 */
export interface MigrateOptions {
  connectionString: string;
  /** Validated as an identifier: this value reaches SQL, so it is filtered rather than trusted. */
  schema?: string;
  dir?: string;
  /** Used by tests that need a scratch schema and its teardown. */
  createSchema?: boolean;
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function safeSchema(candidate: string | undefined, fallback = 'platfolio'): string {
  return candidate && SCHEMA_NAME.test(candidate) ? candidate : fallback;
}

export interface MigrateResult { applied: { version: number; file: string }[]; skipped: number[]; at: number[] }

export async function applyMigrations(options: MigrateOptions): Promise<MigrateResult> {
  const schema = safeSchema(options.schema);
  const dir = options.dir ?? path.resolve(import.meta.dirname, '../../../db/migrations');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const pool = new Pool({ connectionString: options.connectionString, statement_timeout: 30_000 });
  try {
    if (options.createSchema !== false) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const appliedSet = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((r: { version: number }) => Number(r.version)));

    const applied: { version: number; file: string }[] = [];
    const skipped: number[] = [];
    for (const file of files) {
      const version = Number.parseInt(file.match(/^(\d+)/)?.[1] ?? '', 10);
      if (!Number.isFinite(version)) throw new Error(`migration file ${file} does not begin with a number`);
      if (appliedSet.has(version)) {
        skipped.push(version);
        continue;
      }
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      const client = await pool.connect();
      try {
        // One transaction per file: a migration that dies halfway leaves a schema that is neither version,
        // and the ledger cannot describe a state it never recorded.
        await client.query(`SET search_path TO ${schema}`);
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, file]);
        await client.query('COMMIT');
        applied.push({ version, file });
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed and was rolled back: ${(error as Error).message}`);
      } finally {
        client.release();
      }
    }
    const at = (await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map((r: { version: number }) => Number(r.version));
    return { applied, skipped, at };
  } finally {
    await pool.end();
  }
}

/** Scratch-schema teardown for tests. Drops one schema and everything in it, by validated name. */
export async function dropSchema(connectionString: string, schema: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${safeSchema(schema, 'unused')} CASCADE`);
  } finally {
    await pool.end();
  }
}
