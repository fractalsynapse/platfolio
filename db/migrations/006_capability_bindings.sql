-- Who offers what, who is allowed to use it, and who is actually using it (#177, D42).
--
-- Before this, the wiring existed only inside rendered manifests, so platfolio could not answer "what breaks
-- if I delete this?" -- the question the teardown issues (#106, #107) were opened to serve.
--
-- Note the FK direction. Every other table here cascades from instances, because an orphaned plan or
-- attestation is noise. These three use RESTRICT on the provider side: deleting the record out from under a
-- live binding is precisely the failure this table exists to make visible, and a schema that silently
-- cascades it would encode the bug instead of the rule (D43).

CREATE TABLE IF NOT EXISTS capability_offers (
  instance_id  text NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  capability   text NOT NULL CHECK (char_length(capability) BETWEEN 1 AND 60),
  team_id      text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- [{output, kind, state}] -- names and kinds only. The value a shared realm mints lives in the tenant's
  -- provider, never in a control-plane column (D4).
  outputs      jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, capability)
);
CREATE INDEX IF NOT EXISTS capability_offers_team_idx ON capability_offers (team_id, capability);

CREATE TABLE IF NOT EXISTS capability_shares (
  instance_id text NOT NULL,
  capability  text NOT NULL,
  -- A team id, or '*' for "any team". Recorded rather than implied: an absent row must never mean "open".
  to_team_id  text NOT NULL CHECK (char_length(to_team_id) BETWEEN 1 AND 120),
  shared_at   timestamptz NOT NULL DEFAULT now(),
  shared_by   text NOT NULL CHECK (char_length(shared_by) <= 200),
  PRIMARY KEY (instance_id, capability, to_team_id),
  FOREIGN KEY (instance_id, capability) REFERENCES capability_offers(instance_id, capability) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS capability_shares_target_idx ON capability_shares (to_team_id, capability);

CREATE TABLE IF NOT EXISTS capability_bindings (
  consumer_instance_id   text NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  capability             text NOT NULL CHECK (char_length(capability) BETWEEN 1 AND 60),
  -- RESTRICT, not CASCADE: the row that answers "what breaks if I delete this?" must not be deletable by
  -- deleting the thing it is about.
  provider_instance_id   text NOT NULL REFERENCES instances(id) ON DELETE RESTRICT,
  destinations         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- bound: share live. stale: share revoked, running configuration untouched (D42).
  state                  text NOT NULL DEFAULT 'bound' CHECK (state IN ('bound','stale')),
  bound_at               timestamptz NOT NULL DEFAULT now(),
  bound_by               text NOT NULL CHECK (char_length(bound_by) <= 200),
  PRIMARY KEY (consumer_instance_id, capability),
  FOREIGN KEY (provider_instance_id, capability) REFERENCES capability_offers(instance_id, capability) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS capability_bindings_provider_idx ON capability_bindings (provider_instance_id, capability);
