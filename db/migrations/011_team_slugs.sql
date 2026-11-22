-- D45 / #195: `team/name` is the address for an instance, so the TEAM half of that address has to be
-- addressable too. A name with a space, a capital or a trailing hyphen cannot be a URL segment or a CLI
-- argument without escaping, and two teams with the same name would make `acme/shop` ambiguous -- which would
-- quietly undo the naming decision one layer above the one it was made about.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                  WHERE c.conname = 'teams_name_slug_check' AND n.nspname = current_schema()) THEN
    ALTER TABLE teams ADD CONSTRAINT teams_name_slug_check
      CHECK (name ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');
  END IF;
END $$;

-- Names are normalised (trimmed, case-folded) before they reach this column, so the constraint is on the
-- stored value rather than a case-insensitive collation the in-memory double would have to imitate.
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_key ON teams (name);
