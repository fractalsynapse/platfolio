-- Release artifacts (D54): what a platform's build says it published, reported before a deploy.
--
-- The fact used to live in `compose.prod.yaml`, which put a registry truth inside source control. That made it
-- a thing that could go stale -- and it did, twice: a hand-typed digest, then a real digest of a deleted
-- service's bytes, both of which passed every gate because nothing could tell that the number described
-- nothing. A fork cannot generate the file at all without inheriting CI it does not want (#217).
--
-- One row per (instance, service): the newest report replaces the previous one, because a release is not
-- history -- the plan must be derivable from what is live now.
CREATE TABLE IF NOT EXISTS release_artifacts (
  instance_id   text NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  service       text NOT NULL CHECK (char_length(service) BETWEEN 1 AND 60),
  image         text NOT NULL CHECK (char_length(image) BETWEEN 3 AND 300),
  -- `sha256:` plus 64 hex and nothing else: the same shape constraint that stopped a placeholder digest
  -- reaching a provider (#84), moved from a file review into a column type.
  digest        text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  source_ref    text CHECK (source_ref IS NULL OR source_ref ~ '^[0-9a-f]{40}$'),
  version       text CHECK (version IS NULL OR char_length(version) BETWEEN 1 AND 80),
  reported_at   timestamptz NOT NULL DEFAULT now(),
  -- Who reported it. A verified runner identity is #159; until then this is an audit string, not a credential,
  -- and it deliberately has no foreign key because it may name a dispatch rather than a person.
  reported_by   text NOT NULL CHECK (char_length(reported_by) BETWEEN 1 AND 200),
  PRIMARY KEY (instance_id, service)
);

-- The resolution path: every artifact for one instance, newest first, so a stale report cannot win.
CREATE INDEX IF NOT EXISTS release_artifacts_instance_idx ON release_artifacts (instance_id, reported_at DESC);
