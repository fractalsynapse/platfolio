ALTER TABLE marketplace_platforms
  ADD COLUMN publisher_team_id text REFERENCES teams(id),
  ADD COLUMN slug text,
  ADD COLUMN title text,
  ADD UNIQUE (publisher_team_id, slug),
  ADD CHECK (
    (legacy_template IS NOT NULL AND publisher_team_id IS NULL AND slug IS NULL AND title IS NULL) OR
    (legacy_template IS NULL AND publisher_team_id IS NOT NULL AND slug IS NOT NULL AND title IS NOT NULL)
  );

CREATE TABLE marketplace_platform_releases (
  platform_id text NOT NULL REFERENCES marketplace_platforms(id),
  version     text NOT NULL,
  descriptor  jsonb NOT NULL,
  PRIMARY KEY (platform_id, version),
  CHECK (descriptor ->> 'platformId' IS NOT DISTINCT FROM platform_id),
  CHECK (descriptor ->> 'version' IS NOT DISTINCT FROM version)
);

CREATE TABLE marketplace_platform_acquisitions (
  team_id           text NOT NULL REFERENCES teams(id),
  platform_id       text NOT NULL REFERENCES marketplace_platforms(id),
  version           text NOT NULL,
  descriptor_digest text NOT NULL CHECK (descriptor_digest ~ '^[a-f0-9]{64}$'),
  id                text NOT NULL UNIQUE,
  acquired_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, platform_id, version)
);
