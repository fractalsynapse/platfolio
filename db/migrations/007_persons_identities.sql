-- Persons and identities (#177, D44): membership hangs off a person, not off a proof.
--
-- Why this had to happen before invitations, machines, or a second issuer: `sub` is only unique within a
-- realm, so the old key treated two people in two realms as one, and left no way to say "this human and this
-- service token are the same principal".

CREATE TABLE IF NOT EXISTS persons (
  id         text PRIMARY KEY,
  kind       text NOT NULL DEFAULT 'human' CHECK (kind IN ('human','service')),
  label      text CHECK (label IS NULL OR char_length(label) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The proof. Unique as a pair, so two realms can each mint `sub=abc` and land on different people.
CREATE TABLE IF NOT EXISTS identities (
  issuer      text NOT NULL,
  subject     text NOT NULL,
  person_id   text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

-- The lookup every request performs after verification.
CREATE INDEX IF NOT EXISTS identities_person_idx ON identities (person_id);

-- Backfill: one synthetic person per existing membership subject, with the proof recorded under the
-- 'legacy' issuer. No real users exist yet, so the local stack simply re-seeds afterwards
-- (`pnpm run db:seed-dev`); the point of the backfill is that the migration is non-destructive on the way
-- past a schema change, not that it guesses the right issuer for someone else's data.
INSERT INTO persons (id, kind, label)
SELECT DISTINCT 'person-' || md5(m.subject), 'human', 'imported from pre-identity membership'
  FROM team_members m
WHERE NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = 'person-' || md5(m.subject));

INSERT INTO identities (issuer, subject, person_id)
SELECT DISTINCT 'legacy', m.subject, 'person-' || md5(m.subject)
  FROM team_members m
WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.issuer = 'legacy' AND i.subject = m.subject);

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS person_id text;
UPDATE team_members SET person_id = 'person-' || md5(subject) WHERE person_id IS NULL;

-- Membership is on the person: removing a proof (someone leaves an SSO) must not silently revoke the teams
-- they belong to, which the old column made impossible to express.
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_pkey;
ALTER TABLE team_members DROP COLUMN IF EXISTS subject;
ALTER TABLE team_members ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE team_members ADD PRIMARY KEY (team_id, person_id);

DO $$
BEGIN
  -- Scoped to the current schema. An unqualified pg_constraint lookup matches a constraint of the same name
  -- in ANY schema, and the conformance suite runs migrations into a fresh scratch schema while the application
  -- schema already exists in the same database -- so the guard saw the app's constraint, decided this one was
  -- already there, and silently skipped it. Postgres then accepted memberships for people who do not exist
  -- while the in-memory double refused, and the shared conformance suite is what caught it: two drivers, one
  -- rule, and they disagreed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.conname = 'team_members_person_fkey' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_person_fkey FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS team_members_person_idx ON team_members (person_id);
