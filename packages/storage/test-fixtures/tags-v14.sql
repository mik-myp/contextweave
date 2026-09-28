-- Expected additive v14 schema on the frozen synthetic v13 fixture. No user rows.
CREATE TABLE environment_tags (
      tag_id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f'
        CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
      name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      updated_at TEXT NOT NULL
    ) STRICT;
PRAGMA user_version = 14;
