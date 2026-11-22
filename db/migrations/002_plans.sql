-- Registered desired state per instance. Kept in its own table rather than a column on instances because the
-- plan is the artifact a dispatch authorises and an attestation is checked against: it needs a history of its
-- own once reconciliation compares "what we asked" with "what the provider has".
CREATE TABLE IF NOT EXISTS plans (
  instance_id text PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  plan_hash   text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  plan        jsonb NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now()
);

-- Dispatches carry the plan they authorise, copied at issue time: a runner must receive the plan the dispatch
-- was created for, not whatever the desired state became while it was queueing.
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS plan_hash_locked text;
