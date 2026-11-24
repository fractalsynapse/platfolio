CREATE TABLE hosted_app_checks (
  instance_id   text PRIMARY KEY REFERENCES hosted_starters(instance_id) ON DELETE CASCADE,
  deployment_id text NOT NULL,
  state         text NOT NULL CHECK (state IN ('checking', 'up', 'down')),
  failures      integer NOT NULL CHECK (failures BETWEEN 0 AND 2),
  checked_at    timestamptz NOT NULL
);
