-- Captured from published v0.2.4 source 88cb4117dc51a5a02abc9213c8ab0154d7810a54; fresh synthetic workspace, no user rows.
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
      trashed_at TEXT, workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
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
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
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
      phase TEXT NOT NULL DEFAULT 'legacy', process_identity TEXT, workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
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
      name TEXT NOT NULL DEFAULT '', workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
CREATE TABLE "app_settings" (
      setting_key TEXT PRIMARY KEY NOT NULL CHECK(length(trim(setting_key)) > 0),
      value_json TEXT NOT NULL CHECK(json_valid(value_json)), updated_at TEXT NOT NULL, workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
CREATE TABLE "environment_revisions" (
      environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      config_json TEXT NOT NULL CHECK(CASE WHEN json_valid(config_json) THEN json_type(config_json) = 'object' ELSE 0 END),
      created_at TEXT NOT NULL, workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT, PRIMARY KEY(environment_id, revision)) STRICT;
CREATE TABLE "operations" (
      operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(operation_id)) > 0),
      environment_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('start','stop','recover','create','update','trash','restore','install','remove-kernel')),
      status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled')),
      phase TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, error_code TEXT, workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
CREATE TABLE "credential_cleanup" (
      credential_ref TEXT PRIMARY KEY NOT NULL CHECK(length(trim(credential_ref)) > 0),
      created_at TEXT NOT NULL, workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
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
      , workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
CREATE INDEX idx_artifacts_timeline ON screenshot_artifacts(completed_at DESC, artifact_id DESC);
CREATE INDEX idx_artifacts_environment ON screenshot_artifacts(environment_id);
CREATE TABLE screenshot_budget (
        id INTEGER PRIMARY KEY CHECK(id=1),
        limit_mib INTEGER NOT NULL CHECK(limit_mib BETWEEN 32 AND 102400),
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)
      , workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT) STRICT;
CREATE TABLE screenshot_reservations (
        artifact_id TEXT PRIMARY KEY NOT NULL CHECK(length(artifact_id)=36),
        environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 128 AND substr(task_id,1,1) GLOB '[a-zA-Z0-9]' AND task_id NOT GLOB '*[^a-zA-Z0-9_-]*'),
        reserved_at TEXT NOT NULL CHECK(length(reserved_at)=24 AND reserved_at GLOB '????-??-??T??:??:??.???Z'),
        allocation_name TEXT UNIQUE CHECK(allocation_name IS NULL OR (length(allocation_name)=10 AND substr(allocation_name,1,4)='run-' AND substr(allocation_name,5) NOT GLOB '*[^a-zA-Z0-9]*')),
        ownership_json TEXT CHECK(ownership_json IS NULL OR (length(ownership_json)<=1024 AND CASE WHEN json_valid(ownership_json) THEN json_type(ownership_json)='object' ELSE 0 END)), workspace_id TEXT NOT NULL
      DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
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
CREATE TRIGGER local_workspace_no_update BEFORE UPDATE ON local_workspace
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
CREATE TRIGGER local_workspace_no_delete BEFORE DELETE ON local_workspace
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
CREATE TRIGGER local_workspace_no_replace BEFORE INSERT ON local_workspace
      WHEN EXISTS (SELECT 1 FROM local_workspace)
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
CREATE TABLE environment_groups (
      group_id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f'
    CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), updated_at TEXT NOT NULL
    ) STRICT;
CREATE TABLE environment_organization (
      environment_id TEXT PRIMARY KEY NOT NULL REFERENCES environments(environment_id) ON DELETE CASCADE ON UPDATE RESTRICT,
      workspace_id TEXT NOT NULL DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f'
    CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT, group_id TEXT REFERENCES environment_groups(group_id) ON DELETE SET NULL ON UPDATE RESTRICT,
      tags_json TEXT NOT NULL CHECK(CASE WHEN json_valid(tags_json) THEN json_type(tags_json)='array' AND json_array_length(tags_json)<=20 ELSE 0 END),
      note TEXT NOT NULL CHECK(length(note)<=4000),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)
    ) STRICT;
CREATE INDEX idx_environment_organization_group ON environment_organization(group_id);
CREATE TABLE environment_views (
      view_id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f'
    CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
      view_json TEXT NOT NULL CHECK(CASE WHEN json_valid(view_json) THEN json_type(view_json)='object' ELSE 0 END),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), updated_at TEXT NOT NULL
    ) STRICT;
CREATE TABLE batch_tasks (
      task_id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT, action TEXT NOT NULL CHECK(action IN ('start','stop','trash','restore')),
      status TEXT NOT NULL CHECK(status IN ('queued','running','cancelling','completed','cancelled','interrupted')),
      source_task_id TEXT REFERENCES batch_tasks(task_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 100),
      created_at TEXT NOT NULL, ended_at TEXT
    ) STRICT;
CREATE INDEX idx_batch_tasks_created ON batch_tasks(created_at DESC, task_id DESC);
CREATE TABLE batch_items (
      task_id TEXT NOT NULL REFERENCES batch_tasks(task_id) ON DELETE CASCADE ON UPDATE RESTRICT,
      workspace_id TEXT NOT NULL DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id = '61ec0077-5f26-4569-ab0d-c1474503305f') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT, ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
      environment_id TEXT NOT NULL CHECK(length(environment_id) BETWEEN 1 AND 512),
      name TEXT NOT NULL CHECK(length(name)<=200), revision INTEGER CHECK(revision BETWEEN 1 AND 9007199254740991),
      status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','skipped','cancelled','unknown')),
      reason TEXT CHECK(reason IN ('NOT_FOUND','CONFIG_CONFLICT','ENVIRONMENT_BUSY','OPERATION_IN_PROGRESS','ENVIRONMENT_TRASHED','ENVIRONMENT_NOT_TRASHED','ENVIRONMENT_NOT_RUNNING','BATCH_INTERRUPTED','CANCELLED','COMMAND_FAILED','KERNEL_UNAVAILABLE','PROVIDER_UNVERIFIED','CONFIG_INVALID','PROXY_MISSING','APP_CLOSING','APP_UPDATING','BATCH_STORAGE_FAILED')),
      started_at TEXT, ended_at TEXT,
      PRIMARY KEY(task_id, ordinal), UNIQUE(task_id, environment_id)
    ) STRICT;
CREATE TABLE environment_commands (
      request_id TEXT PRIMARY KEY NOT NULL CHECK(length(request_id)=36 AND request_id NOT GLOB '*[^a-f0-9-]*'),
      workspace_id TEXT NOT NULL DEFAULT '61ec0077-5f26-4569-ab0d-c1474503305f' CHECK(workspace_id='61ec0077-5f26-4569-ab0d-c1474503305f')
        REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN ('create','update','start','stop','trash','restore','recover')),
      environment_id TEXT NOT NULL CHECK(length(environment_id) BETWEEN 1 AND 512),
      expected_revision INTEGER CHECK(expected_revision BETWEEN 1 AND 9007199254740991),
      intent_digest TEXT NOT NULL CHECK(length(intent_digest)=64 AND intent_digest NOT GLOB '*[^a-f0-9]*'),
      status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','unknown')),
      created_at TEXT CHECK(created_at IS NULL OR (length(created_at)=24 AND created_at GLOB '????-??-??T??:??:??.???Z')) NOT NULL,
      started_at TEXT CHECK(started_at IS NULL OR (length(started_at)=24 AND started_at GLOB '????-??-??T??:??:??.???Z')),
      ended_at TEXT CHECK(ended_at IS NULL OR (length(ended_at)=24 AND ended_at GLOB '????-??-??T??:??:??.???Z')),
      error_code TEXT CHECK(error_code IN ('CONFIG_INVALID','ENVIRONMENT_TRASHED','KERNEL_UNAVAILABLE','PROVIDER_UNVERIFIED','PLATFORM_MISMATCH','RUNTIME_BUSY','RECOVERY_REQUIRED','PROXY_MISSING','PROXY_UNREACHABLE','PROXY_TEST_FAILED','CREDENTIAL_UNAVAILABLE','DIRECTORY_UNWRITABLE','LOW_DISK','NATIVE_MODE','VERSION_CHANGED','LEGACY_SETTINGS_UNSUPPORTED','NOT_FOUND','CONFIG_CONFLICT','ENVIRONMENT_BUSY','OPERATION_IN_PROGRESS','ENVIRONMENT_NOT_TRASHED','ENVIRONMENT_NOT_RUNNING','ALREADY_RUNNING','RECOVERY_LOCK_UNREADABLE','RECOVERY_MANUAL_REQUIRED','IP_LOCALE_FAILED','KERNEL_VERSION_MISMATCH','SPAWN_FAILED','START_FAILED','STOP_TIMEOUT','CANCELLED','APP_CLOSING','APP_UPDATING','COMMAND_FAILED','COMMAND_INTERRUPTED','COMMAND_RESULT_UNKNOWN','COMMAND_STORAGE_FAILED','COMMAND_INTENT_CONFLICT','COMMAND_QUEUE_FULL')),
      CHECK((kind='create' AND expected_revision IS NULL) OR (kind!='create' AND expected_revision IS NOT NULL)),
      CHECK(
        (status='queued' AND started_at IS NULL AND ended_at IS NULL AND error_code IS NULL) OR
        (status='running' AND started_at IS NOT NULL AND ended_at IS NULL AND error_code IS NULL) OR
        (status='succeeded' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND error_code IS NULL) OR
        (status='failed' AND ended_at IS NOT NULL AND error_code IS NOT NULL AND error_code NOT IN ('CANCELLED','COMMAND_INTERRUPTED','COMMAND_STORAGE_FAILED','COMMAND_RESULT_UNKNOWN')) OR
        (status='cancelled' AND ended_at IS NOT NULL AND error_code IN ('CANCELLED','APP_CLOSING','COMMAND_INTERRUPTED') AND error_code IS NOT NULL) OR
        (status='unknown' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND error_code IN ('COMMAND_INTERRUPTED','COMMAND_STORAGE_FAILED','COMMAND_RESULT_UNKNOWN','STOP_TIMEOUT','START_FAILED','SPAWN_FAILED') AND error_code IS NOT NULL)
      )
    ) STRICT;
CREATE UNIQUE INDEX idx_environment_commands_active ON environment_commands(environment_id)
      WHERE status IN ('queued','running') AND kind!='stop';
CREATE UNIQUE INDEX idx_environment_commands_stop ON environment_commands(environment_id)
      WHERE status IN ('queued','running') AND kind='stop';
CREATE INDEX idx_environment_commands_target ON environment_commands(environment_id);
CREATE TRIGGER environment_commands_reservation BEFORE INSERT ON environment_commands
      WHEN NEW.status IN ('queued','running') AND EXISTS (
        SELECT 1 FROM environment_commands WHERE environment_id=NEW.environment_id AND status IN ('queued','running')
          AND NOT (NEW.kind='stop' AND kind='start')
      )
      BEGIN SELECT RAISE(ABORT,'COMMAND_RESOURCE_RESERVED'); END;
CREATE TRIGGER environment_commands_execution BEFORE UPDATE OF status ON environment_commands
      WHEN NEW.status='running' AND EXISTS (
        SELECT 1 FROM environment_commands WHERE environment_id=NEW.environment_id AND status='running' AND request_id!=NEW.request_id
      )
      BEGIN SELECT RAISE(ABORT,'COMMAND_RESOURCE_RESERVED'); END;
CREATE TRIGGER environment_commands_identity BEFORE UPDATE ON environment_commands
      WHEN NEW.rowid!=OLD.rowid OR NEW.request_id!=OLD.request_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.kind!=OLD.kind
        OR NEW.environment_id!=OLD.environment_id OR NEW.expected_revision IS NOT OLD.expected_revision
        OR NEW.intent_digest!=OLD.intent_digest OR NEW.created_at!=OLD.created_at
      BEGIN SELECT RAISE(ABORT,'COMMAND_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER environment_commands_transition BEFORE UPDATE OF status, started_at ON environment_commands
      WHEN (OLD.status='queued' AND NEW.status NOT IN ('running','failed','cancelled'))
        OR (OLD.status='running' AND (NEW.status IN ('queued','running') OR NEW.started_at IS NOT OLD.started_at))
      BEGIN SELECT RAISE(ABORT,'COMMAND_STATE_CONFLICT'); END;
CREATE TRIGGER environment_commands_terminal BEFORE UPDATE ON environment_commands
      WHEN OLD.status NOT IN ('queued','running')
      BEGIN SELECT RAISE(ABORT,'COMMAND_TERMINAL_IMMUTABLE'); END;
CREATE TRIGGER environment_commands_retain BEFORE DELETE ON environment_commands
      BEGIN SELECT RAISE(ABORT,'COMMAND_RECEIPT_REQUIRED'); END;
INSERT INTO local_workspace VALUES (1, '61ec0077-5f26-4569-ab0d-c1474503305f', 'personal', 'local', '2026-09-27T18:24:31.493Z');
INSERT INTO screenshot_budget VALUES (1, 1024, 1, '61ec0077-5f26-4569-ab0d-c1474503305f');
PRAGMA user_version = 13;
