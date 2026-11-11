-- platfolio control-plane schema, migration 001. Unqualified: the migration runner sets search_path to the
-- configured schema, so the same file serves the app schema, a CI schema, or a scratch one in a test.
--
-- There is no column in this file that can hold a tenant secret value (D4). A schema that cannot express a
-- violation is stronger than a rule about not committing one.

CREATE TABLE IF NOT EXISTS teams (
  id          text PRIMARY KEY,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instances (
  id                     text PRIMARY KEY,
  team_id                text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name                   text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  platform               text NOT NULL,
  state                  text NOT NULL CHECK (state IN ('pending','provisioning','live','paused','failed','deprovisioning','removed')),
  provider               text NOT NULL DEFAULT 'railway',
  desired_plan_hash      text,
  last_applied_plan_hash text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instances_team_idx ON instances (team_id);

CREATE TABLE IF NOT EXISTS repo_connections (
  instance_id    text PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  repo           text NOT NULL,
  default_branch text NOT NULL,
  -- Full commit SHA only: a tag can be moved and the trust anchor has to be a commit (D30 law 3).
  action_ref     char(40) NOT NULL CHECK (action_ref ~ '^[0-9a-f]{40}$'),
  installed_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_connections (
  instance_id         text PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  tier                text NOT NULL CHECK (tier IN ('managed','self-custody')),
  workspace_hint      text,
  project_external_id text,
  -- [{name, source, set}] -- names and presence, never values.
  secrets             jsonb NOT NULL DEFAULT '[]'::jsonb,
  connected_at        timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatches (
  id          text PRIMARY KEY,
  instance_id text NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  nonce       text NOT NULL CHECK (char_length(nonce) >= 16),
  plan_hash   text NOT NULL,
  action      text NOT NULL CHECK (action IN ('apply','destroy')),
  environment text NOT NULL,
  issued_at   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  -- Single use, enforced by the row: the consuming UPDATE is conditional, so a second concurrent runner gets
  -- zero rows back rather than a second copy of the plan.
  consumed_at timestamptz,
  plan        jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS dispatches_instance_idx ON dispatches (instance_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS attestations (
  -- One per dispatch by construction: a retried job cannot rewrite history.
  dispatch_id  text PRIMARY KEY REFERENCES dispatches(id) ON DELETE CASCADE,
  instance_id  text NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  result       text NOT NULL CHECK (result IN ('ok','partial','failed','noop')),
  plan_hash    text NOT NULL,
  nonce        text NOT NULL,
  action       text NOT NULL,
  environment  text NOT NULL,
  error_code   text,
  resources    jsonb NOT NULL DEFAULT '[]'::jsonb,
  release      jsonb NOT NULL,
  duration_ms  integer NOT NULL CHECK (duration_ms >= 0),
  finished_at  timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  actor_kind   text NOT NULL DEFAULT 'shared-secret' CHECK (actor_kind IN ('runner','operator','shared-secret')),
  actor_ref    text
);
CREATE INDEX IF NOT EXISTS attestations_instance_idx ON attestations (instance_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         text PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','runner','controller','system')),
  actor_ref  text NOT NULL,
  action     text NOT NULL CHECK (char_length(action) <= 120),
  target     text NOT NULL CHECK (char_length(target) <= 200),
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log (at DESC);

-- The ledger this directory was applied under. Readiness reads this table rather than assuming a file ran:
-- "SELECT 1 worked" is not the same claim as "this schema is at version N", and only the second one is
-- checkable after the fact.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
