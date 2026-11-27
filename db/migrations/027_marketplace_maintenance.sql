CREATE TABLE marketplace_maintenance (
  platform_id text NOT NULL REFERENCES marketplace_platforms(id),
  buyer_team_id text NOT NULL REFERENCES teams(id),
  eligible_through timestamptz NOT NULL,
  PRIMARY KEY (platform_id, buyer_team_id)
);
