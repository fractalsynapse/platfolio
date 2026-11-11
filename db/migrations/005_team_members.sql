-- Membership: the missing half of authentication (D4's cross-tenant rule, #173).
--
-- The token's `sub` is the join key. Deliberately not username or email: those are mutable and owned by the
-- IdP's presentation layer, while `sub` is the stable identifier the verifier already trusts. A mapping table
-- keyed on anything else would be a second source of who a person is.
CREATE TABLE IF NOT EXISTS team_members (
  team_id  text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  subject  text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  role     text NOT NULL CHECK (role IN ('owner','member')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, subject)
);

-- The authorization query every scoped request runs: which teams may this subject act for? Indexed because
-- it is on the request path, not a reporting afterthought.
CREATE INDEX IF NOT EXISTS team_members_subject_idx ON team_members (subject);
