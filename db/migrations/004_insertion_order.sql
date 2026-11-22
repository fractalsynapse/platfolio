-- A monotonic insertion counter, because `at` alone cannot order rows.
--
-- Found in CI, not locally: three audit rows written in quick succession share the same `now()` value -- a
-- statement-time constant, identical inside one transaction -- so `ORDER BY at DESC` between them is
-- non-deterministic and the conformance suite's "newest first" assertion flipped. My local Postgres happened to
-- order them one way, the runner's the other. That is the whole argument for running the same suite against a
-- second implementation in a second environment.
--
-- The interface said "newest first" without saying what breaks a tie. Now it can say so, and both drivers have
-- something to obey.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_seq_key ON audit_log (seq);

-- The same hazard on the other two recency-ordered listings: a tie on a client-supplied timestamp is not a
-- coin flip if a stable secondary key decides it.
CREATE INDEX IF NOT EXISTS audit_log_target_seq_idx ON audit_log (target, seq DESC);
