# Migrations

Numbered, forward-only SQL applied by `pnpm run db:migrate` and recorded in `platfolio.schema_migrations`.

- **Files are never edited after they ship.** A new change is a new number. An edited `001_init.sql` means two
  environments have different schemas under the same version, which is undetectable after the fact.
- **Nothing destructive without an explicit second command.** Drop/remove flows arrive with the lifecycle work
  (#162 → [06](../../docs/design/06-billing-and-lifecycle.md)), where a migration that deletes tenant data has
  to be separable from one that adds a column.
- The store's `describe().schemaReady` is the presence of the migrations ledger with the expected versions, not
  the absence of an error at startup. `GET /readyz` reports that, so a control plane against a half-migrated
  database says `not-ready` instead of serving `not-found` for every record.
