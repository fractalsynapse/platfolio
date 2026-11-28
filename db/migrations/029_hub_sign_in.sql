-- Private installations opt in to one explicitly configured hub issuer and client.
CREATE TABLE hub_sign_in (
  team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  client_id text NOT NULL
);
