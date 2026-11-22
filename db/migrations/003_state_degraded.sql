-- The `degraded` state: an attestation of `partial` means some resources landed and some did not, which is
-- neither `live` nor `failed`. The enum in packages/contracts carried it while the CHECK constraint did not,
-- so the database rejected the exact transition the controller makes -- a constraint that disagrees with the
-- interface is a second source of truth. Found by running the conformance suite against the real schema rather
-- than by reading either one.
ALTER TABLE instances DROP CONSTRAINT IF EXISTS instances_state_check;
ALTER TABLE instances ADD CONSTRAINT instances_state_check
  CHECK (state IN ('pending','provisioning','live','degraded','paused','failed','deprovisioning','removed'));
