-- One Postgres instance, two owners, separate namespaces.
--
-- Keycloak migrates its own tables automatically on the first boot of a new version (docs/design/05), so they
-- must never share a namespace with platfolio's, whose migrations are ours. Separate schemas inside one
-- instance still buy the consolidation that matters: one container, one backup, one connection story.
CREATE SCHEMA IF NOT EXISTS platfolio;
CREATE SCHEMA IF NOT EXISTS keycloak;
