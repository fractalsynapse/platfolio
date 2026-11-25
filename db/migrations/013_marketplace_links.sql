CREATE TABLE marketplace_links (
  installation_id UUID PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  disconnected BOOLEAN NOT NULL DEFAULT FALSE
);
