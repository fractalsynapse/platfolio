ALTER TABLE installation_journals DROP CONSTRAINT installation_journals_provider_workspace_id_name_key;
CREATE UNIQUE INDEX installation_journals_active_name
  ON installation_journals (provider, workspace_id, name)
  WHERE NOT (document ? 'removedAt');
