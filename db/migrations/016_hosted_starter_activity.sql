-- Carry the latest verified starter observation forward for apps registered before activity was enabled.
INSERT INTO audit_log (id, at, actor_kind, actor_ref, action, target, detail)
SELECT 'hosting-' || deployment_id, observed_at, 'controller', 'private-launch-worker',
       CASE state WHEN 'live' THEN 'hosting.verified' ELSE 'hosting.' || state END,
       instance_id, jsonb_build_object('environment', 'staging', 'deploymentId', deployment_id)
FROM hosted_starters
ORDER BY observed_at, instance_id
ON CONFLICT (id) DO NOTHING;
