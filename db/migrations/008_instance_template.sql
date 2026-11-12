-- #180 / D45: the field that stored a template id was called `platform`, and instance names become
-- repository-style slugs, unique per team so `team/name` addresses something.
ALTER TABLE instances RENAME COLUMN platform TO template;

ALTER TABLE instances ADD COLUMN IF NOT EXISTS template_repo text;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS template_commit char(40);

-- Slug rules in the database, not only in the schema: an application-layer check would be a second rule the
-- in-memory double would have to remember to duplicate, and the day it forgets, two drivers disagree.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                  WHERE c.conname = 'instances_name_slug_check' AND n.nspname = current_schema()) THEN
    ALTER TABLE instances ADD CONSTRAINT instances_name_slug_check
      CHECK (template IS NOT NULL AND name ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$');
  END IF;
END $$;

-- A commit or nothing: a branch name or a tag in this column would be a movable anchor presented as a fixed
-- one, which is the failure D30 law 3 exists to prevent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                  WHERE c.conname = 'instances_template_commit_check' AND n.nspname = current_schema()) THEN
    ALTER TABLE instances ADD CONSTRAINT instances_template_commit_check
      CHECK (template_commit IS NULL OR template_commit ~ '^[0-9a-f]{40}$');
  END IF;
END $$;

-- `team/name` addressing (D45). Duplicate names inside a team are refused here, so the collision cannot be
-- discovered by a UI or a CLI prompt showing two things with the same label.
CREATE UNIQUE INDEX IF NOT EXISTS instances_team_name_key ON instances (team_id, name);
