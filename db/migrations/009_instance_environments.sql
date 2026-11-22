-- Per-environment state (#179). `Instance.state` was a single value while every instance ships staging and
-- production, so "staging degraded, production live" -- an ordinary Tuesday -- had nowhere to be recorded.
--
-- The instance-level field stays as a rollup so existing clients keep a stable answer; the truth moves here.
CREATE TABLE IF NOT EXISTS instance_environments (
  instance_id          text NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  environment          text NOT NULL CHECK (char_length(environment) BETWEEN 1 AND 60),
  state                text NOT NULL CHECK (state IN ('pending','provisioning','live','degraded','paused','failed','deprovisioning','removed')),
  applied_plan_hash    text,
  last_attestation_id  text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, environment)
);

-- Seed one row per existing instance from the old single value, so nothing reads as "no environments" after
-- the migration. Staging and production both inherit it; the controller corrects them on the next sweep.
INSERT INTO instance_environments (instance_id, environment, state, applied_plan_hash)
SELECT i.id, 'production', i.state, i.last_applied_plan_hash FROM instances i
ON CONFLICT (instance_id, environment) DO NOTHING;

CREATE INDEX IF NOT EXISTS instance_environments_instance_idx ON instance_environments (instance_id);
