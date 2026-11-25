CREATE TABLE installation_journals (
  id uuid PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  provider text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL CHECK (version >= 0),
  document jsonb NOT NULL,
  UNIQUE (provider, workspace_id, name)
);

CREATE INDEX installation_journals_owner ON installation_journals (team_id, person_id);
