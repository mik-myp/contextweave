import type { DatabaseSync } from 'node:sqlite'
import {
  commandErrorCodeSchema,
  environmentCommandKindSchema,
  environmentCommandStatusSchema,
} from '@contextweave/contracts'
import { WorkspaceRepository } from './workspaces'

export const commandTable = 'environment_commands'
export function migrateCommands(sqlite: DatabaseSync) {
  const { workspaceId } = new WorkspaceRepository(sqlite).current()
  const values = (options: readonly string[]) => options.map((value) => `'${value}'`).join(',')
  const timestamp = (column: string) =>
    `${column} TEXT CHECK(${column} IS NULL OR (length(${column})=24 AND ${column} GLOB '????-??-??T??:??:??.???Z'))`
  sqlite.exec(`
    CREATE TABLE environment_commands (
      request_id TEXT PRIMARY KEY NOT NULL CHECK(length(request_id)=36 AND request_id NOT GLOB '*[^a-f0-9-]*'),
      workspace_id TEXT NOT NULL DEFAULT '${workspaceId}' CHECK(workspace_id='${workspaceId}')
        REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN (${values(environmentCommandKindSchema.options)})),
      environment_id TEXT NOT NULL CHECK(length(environment_id) BETWEEN 1 AND 512),
      expected_revision INTEGER CHECK(expected_revision BETWEEN 1 AND 9007199254740991),
      intent_digest TEXT NOT NULL CHECK(length(intent_digest)=64 AND intent_digest NOT GLOB '*[^a-f0-9]*'),
      status TEXT NOT NULL CHECK(status IN (${values(environmentCommandStatusSchema.options)})),
      ${timestamp('created_at')} NOT NULL,
      ${timestamp('started_at')},
      ${timestamp('ended_at')},
      error_code TEXT CHECK(error_code IN (${values(commandErrorCodeSchema.options)})),
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
  `)
}
