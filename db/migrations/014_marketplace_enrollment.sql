ALTER TABLE marketplace_links
  ADD COLUMN enrollment_digest TEXT,
  ADD COLUMN enrollment_expires_at TIMESTAMPTZ,
  ADD COLUMN registry_digest TEXT,
  ADD CHECK ((enrollment_digest IS NULL) = (enrollment_expires_at IS NULL)),
  ADD CHECK (enrollment_digest IS NULL OR registry_digest IS NULL);
