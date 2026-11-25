ALTER TABLE notification_rules ADD COLUMN active_since timestamptz NOT NULL DEFAULT now();

CREATE TABLE notification_email_preferences (
  person_id text PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  subject text NOT NULL,
  enabled_at timestamptz NOT NULL,
  FOREIGN KEY (issuer, subject) REFERENCES identities(issuer, subject) ON DELETE CASCADE
);

CREATE TABLE notification_email_deliveries (
  person_id text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  audit_id text NOT NULL REFERENCES audit_log(id) ON DELETE CASCADE,
  lease_id text NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 4),
  due_at timestamptz,
  PRIMARY KEY (person_id, audit_id)
);

CREATE INDEX notification_email_rule_matches ON notification_rules (instance_id, person_id) WHERE enabled;
