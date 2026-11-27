CREATE TABLE marketplace_platforms (
  id              text PRIMARY KEY,
  variant         text NOT NULL CHECK (variant IN ('starter-template', 'shared-service', 'hosted-application')),
  legacy_template text UNIQUE
);

INSERT INTO marketplace_platforms (id, variant, legacy_template) VALUES
  ('platfolio.shared-identity', 'shared-service', 'shared-identity'),
  ('platfolio.starter-web', 'starter-template', 'starter-web'),
  ('platfolio.starter-worker', 'starter-template', 'starter-worker');

-- Releases written before and after migration resolve through the same alias.
ALTER TABLE marketplace_releases
  ADD CONSTRAINT marketplace_releases_legacy_platform_fkey
  FOREIGN KEY (template) REFERENCES marketplace_platforms (legacy_template);
