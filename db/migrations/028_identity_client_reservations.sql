-- Keep the exact binding in place until its customer-side client has been revoked.
ALTER TABLE capability_bindings ADD UNIQUE (consumer_instance_id, capability, provider_instance_id, bound_at);

CREATE TABLE identity_client_reservations (
  consumer_instance_id text NOT NULL,
  capability text NOT NULL DEFAULT 'identity' CHECK (capability = 'identity'),
  provider_instance_id text NOT NULL,
  bound_at timestamptz NOT NULL,
  environment text NOT NULL CHECK (environment IN ('production', 'staging')),
  target jsonb NOT NULL,
  PRIMARY KEY (consumer_instance_id, environment),
  FOREIGN KEY (consumer_instance_id, capability, provider_instance_id, bound_at)
    REFERENCES capability_bindings (consumer_instance_id, capability, provider_instance_id, bound_at) ON DELETE RESTRICT ON UPDATE RESTRICT
);
