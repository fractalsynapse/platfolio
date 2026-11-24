-- Verified source-build launches retain provider evidence independently of GitHub workflow attestations.
CREATE TABLE hosted_starters (
  instance_id   text PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  project_id    text NOT NULL UNIQUE,
  deployment_id text NOT NULL,
  origin        text NOT NULL,
  state         text NOT NULL CHECK (state IN ('live', 'paused', 'removed')),
  observed_at   timestamptz NOT NULL
);
