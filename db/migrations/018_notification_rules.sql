CREATE TABLE notification_rules (
  id            text PRIMARY KEY,
  person_id     text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  instance_id   text NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  environment   text,
  event         text NOT NULL CHECK (event IN ('deployment-failed', 'app-outage', 'secret-updated')),
  enabled       boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (person_id, instance_id, environment, event)
);
CREATE INDEX notification_rules_person ON notification_rules (person_id, created_at, id);
