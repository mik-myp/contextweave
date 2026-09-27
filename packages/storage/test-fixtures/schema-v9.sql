-- Captured from published v0.2.0 source 596f32816e4195b8e7925710b2c42e044bd7124e before v10 changes.
CREATE TABLE "environments" (
      environment_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(environment_id)) > 0),
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('created','ready','starting','running','stopping','stopped','error','needs-recovery')),
      kernel_id TEXT NOT NULL, kernel_version TEXT NOT NULL,
      proxy_id TEXT REFERENCES proxies(proxy_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      config_json TEXT NOT NULL CHECK(CASE WHEN json_valid(config_json) THEN json_type(config_json) = 'object' ELSE 0 END),
      data_dir TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('win32','darwin','linux')),
      arch TEXT NOT NULL CHECK(arch IN ('x64','arm64')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
      lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','trashed')),
      trashed_at TEXT,
      CHECK((lifecycle = 'active' AND trashed_at IS NULL) OR (lifecycle = 'trashed' AND trashed_at IS NOT NULL)),
      FOREIGN KEY(environment_id, revision) REFERENCES environment_revisions(environment_id, revision)
        DEFERRABLE INITIALLY DEFERRED) STRICT;
CREATE TABLE "kernel_installations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id BETWEEN 1 AND 9007199254740991),
      kernel_id TEXT NOT NULL, version TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('win32','darwin','linux')),
      arch TEXT NOT NULL CHECK(arch IN ('x64','arm64')),
      source_url TEXT, sha256 TEXT, install_path TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('installed','removing')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE "runtime_sessions" (
      session_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(session_id)) > 0),
      environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      pid INTEGER NOT NULL CHECK(pid BETWEEN 1 AND 9007199254740991),
      control_port INTEGER NOT NULL CHECK(control_port BETWEEN 1 AND 65535),
      started_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('starting','running','stopping','stopped','crashed')),
      exit_reason TEXT, ended_at TEXT,
      revision INTEGER CHECK(revision BETWEEN 1 AND 9007199254740991),
      kernel_version TEXT, executable_version TEXT,
      phase TEXT NOT NULL DEFAULT 'legacy', process_identity TEXT,
      CHECK(process_identity IS NULL OR length(process_identity) > 0),
      FOREIGN KEY(environment_id, revision) REFERENCES environment_revisions(environment_id, revision)
        ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
CREATE TABLE "proxies" (
      proxy_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(proxy_id)) > 0),
      type TEXT NOT NULL CHECK(type IN ('http','https','socks5')),
      host TEXT NOT NULL CHECK(length(trim(host)) > 0),
      port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
      username TEXT, credential_ref TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '') STRICT;
CREATE TABLE "app_settings" (
      setting_key TEXT PRIMARY KEY NOT NULL CHECK(length(trim(setting_key)) > 0),
      value_json TEXT NOT NULL CHECK(json_valid(value_json)), updated_at TEXT NOT NULL) STRICT;
CREATE TABLE "environment_revisions" (
      environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      config_json TEXT NOT NULL CHECK(CASE WHEN json_valid(config_json) THEN json_type(config_json) = 'object' ELSE 0 END),
      created_at TEXT NOT NULL, PRIMARY KEY(environment_id, revision)) STRICT;
CREATE TABLE "operations" (
      operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(operation_id)) > 0),
      environment_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('start','stop','recover','create','update','trash','restore','install','remove-kernel')),
      status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled')),
      phase TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, error_code TEXT) STRICT;
CREATE TABLE "credential_cleanup" (
      credential_ref TEXT PRIMARY KEY NOT NULL CHECK(length(trim(credential_ref)) > 0),
      created_at TEXT NOT NULL) STRICT;
CREATE INDEX idx_environments_updated_at ON environments (updated_at);
CREATE INDEX idx_runtime_sessions_environment ON runtime_sessions (environment_id);
CREATE INDEX idx_runtime_sessions_status ON runtime_sessions (status);
CREATE UNIQUE INDEX idx_kernel_installations_identity ON kernel_installations (kernel_id,version,platform,arch);
CREATE INDEX idx_operations_started ON operations (started_at DESC);
CREATE INDEX idx_environments_proxy ON environments(proxy_id);
CREATE INDEX idx_sessions_timeline ON runtime_sessions(started_at DESC, session_id DESC);
CREATE INDEX idx_operations_timeline ON operations(started_at DESC, operation_id DESC);
CREATE INDEX idx_sessions_active ON runtime_sessions(environment_id, started_at DESC, session_id DESC)
        WHERE status IN ('starting', 'running', 'stopping');
CREATE INDEX idx_sessions_executable ON runtime_sessions(environment_id, started_at DESC, session_id DESC)
        WHERE executable_version IS NOT NULL AND executable_version != '';
CREATE TABLE screenshot_artifacts (
        artifact_id TEXT PRIMARY KEY NOT NULL CHECK(length(artifact_id) = 36),
        environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 128 AND substr(task_id, 1, 1) GLOB '[a-zA-Z0-9]' AND task_id NOT GLOB '*[^a-zA-Z0-9_-]*'),
        allocation_name TEXT NOT NULL UNIQUE CHECK(length(allocation_name) = 10 AND substr(allocation_name, 1, 4) = 'run-' AND substr(allocation_name, 5) NOT GLOB '*[^a-zA-Z0-9]*'),
        bytes INTEGER NOT NULL CHECK(bytes BETWEEN 8 AND 33554432),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
        completed_at TEXT NOT NULL CHECK(length(completed_at) = 24 AND completed_at GLOB '????-??-??T??:??:??.???Z'),
        ownership_json TEXT NOT NULL CHECK(length(ownership_json) <= 1024) CHECK(CASE WHEN json_valid(ownership_json) THEN json_type(ownership_json) = 'object' ELSE 0 END)
      ) STRICT;
CREATE INDEX idx_artifacts_timeline ON screenshot_artifacts(completed_at DESC, artifact_id DESC);
CREATE INDEX idx_artifacts_environment ON screenshot_artifacts(environment_id);
CREATE TABLE screenshot_budget (
        id INTEGER PRIMARY KEY CHECK(id=1),
        limit_mib INTEGER NOT NULL CHECK(limit_mib BETWEEN 32 AND 102400),
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)
      ) STRICT;
CREATE TABLE screenshot_reservations (
        artifact_id TEXT PRIMARY KEY NOT NULL CHECK(length(artifact_id)=36),
        environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 128 AND substr(task_id,1,1) GLOB '[a-zA-Z0-9]' AND task_id NOT GLOB '*[^a-zA-Z0-9_-]*'),
        reserved_at TEXT NOT NULL CHECK(length(reserved_at)=24 AND reserved_at GLOB '????-??-??T??:??:??.???Z'),
        allocation_name TEXT UNIQUE CHECK(allocation_name IS NULL OR (length(allocation_name)=10 AND substr(allocation_name,1,4)='run-' AND substr(allocation_name,5) NOT GLOB '*[^a-zA-Z0-9]*')),
        ownership_json TEXT CHECK(ownership_json IS NULL OR (length(ownership_json)<=1024 AND CASE WHEN json_valid(ownership_json) THEN json_type(ownership_json)='object' ELSE 0 END)),
        CHECK((allocation_name IS NULL AND ownership_json IS NULL) OR (allocation_name IS NOT NULL AND ownership_json IS NOT NULL))
      ) STRICT;
CREATE INDEX idx_screenshot_reservations_environment ON screenshot_reservations(environment_id);
CREATE TABLE local_workspace (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      workspace_id TEXT NOT NULL UNIQUE CHECK(
        length(workspace_id) = 36 AND workspace_id GLOB '????????-????-????-????-????????????'
        AND length(replace(workspace_id, '-', '')) = 32
        AND replace(workspace_id, '-', '') NOT GLOB '*[^0-9a-f]*'
      ),
      kind TEXT NOT NULL CHECK(kind = 'personal'),
      storage_mode TEXT NOT NULL CHECK(storage_mode = 'local'),
      created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z')
    ) STRICT;
INSERT INTO local_workspace VALUES (1, '05365bbc-0982-4738-add7-b4f3bfcdccee', 'personal', 'local', '2026-09-27T10:33:58.978Z');
CREATE TRIGGER local_workspace_no_update BEFORE UPDATE ON local_workspace
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
CREATE TRIGGER local_workspace_no_delete BEFORE DELETE ON local_workspace
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
CREATE TRIGGER local_workspace_no_replace BEFORE INSERT ON local_workspace
      WHEN EXISTS (SELECT 1 FROM local_workspace)
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
INSERT INTO screenshot_budget VALUES (1,1024,1);
PRAGMA user_version = 9;
