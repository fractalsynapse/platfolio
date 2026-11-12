-- Invitations (D44): an intent that some person should become a member, kept apart from membership itself.
-- A pending invitation must never look like a role grant, so it gets its own table rather than a state on
-- team_members -- the confusion of "invited" with "allowed" is what the role split exists to prevent.
CREATE TABLE IF NOT EXISTS invitations (
  id            text PRIMARY KEY,
  team_id       text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email         text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  role          text NOT NULL CHECK (role IN ('owner','member')),
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','revoked','expired')),
  invited_by    text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_by   text REFERENCES persons(id) ON DELETE SET NULL,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  -- The transport's receipt. Nullable because a failed send is a fact worth keeping: it is the difference
  -- between "we never got it" meaning "nothing was sent" and "it left us and the relay ate it" (D46).
  email_receipt text,
  email_error   text
);

-- The claim path: what is pending, addressed to this exact address. Case-folded, because addresses are.
CREATE INDEX IF NOT EXISTS invitations_email_pending_idx ON invitations (lower(email)) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS invitations_team_idx ON invitations (team_id, created_at DESC);

-- One pending invitation per address per team. A second "invite" for the same person is a resend, and without
-- this the UI would show the same person three times with three expiry dates.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_team_email_pending_key ON invitations (team_id, lower(email)) WHERE state = 'pending';
