import type { DatabaseSync } from 'node:sqlite'

// Versioned SQL, not generated from current contracts: historical migrations stay immutable.
const tables = [
  {
    name: 'environments',
    columns:
      'environment_id,name,status,kernel_id,kernel_version,proxy_id,config_json,data_dir,platform,arch,created_at,updated_at,revision,lifecycle,trashed_at',
    definition: `
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
        DEFERRABLE INITIALLY DEFERRED`,
  },
  {
    name: 'kernel_installations',
    columns:
      'id,kernel_id,version,platform,arch,source_url,sha256,install_path,state,created_at,updated_at',
    definition: `
      id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id BETWEEN 1 AND 9007199254740991),
      kernel_id TEXT NOT NULL, version TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('win32','darwin','linux')),
      arch TEXT NOT NULL CHECK(arch IN ('x64','arm64')),
      source_url TEXT, sha256 TEXT, install_path TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('installed','removing')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL`,
  },
  {
    name: 'runtime_sessions',
    columns:
      'session_id,environment_id,pid,control_port,started_at,status,exit_reason,ended_at,revision,kernel_version,executable_version,phase,process_identity',
    definition: `
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
        ON DELETE RESTRICT ON UPDATE RESTRICT`,
  },
  {
    name: 'proxies',
    columns: 'proxy_id,type,host,port,username,credential_ref,created_at,updated_at,name',
    definition: `
      proxy_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(proxy_id)) > 0),
      type TEXT NOT NULL CHECK(type IN ('http','https','socks5')),
      host TEXT NOT NULL CHECK(length(trim(host)) > 0),
      port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
      username TEXT, credential_ref TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT ''`,
  },
  {
    name: 'app_settings',
    columns: 'setting_key,value_json,updated_at',
    definition: `
      setting_key TEXT PRIMARY KEY NOT NULL CHECK(length(trim(setting_key)) > 0),
      value_json TEXT NOT NULL CHECK(json_valid(value_json)), updated_at TEXT NOT NULL`,
  },
  {
    name: 'environment_revisions',
    columns: 'environment_id,revision,config_json,created_at',
    definition: `
      environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      config_json TEXT NOT NULL CHECK(CASE WHEN json_valid(config_json) THEN json_type(config_json) = 'object' ELSE 0 END),
      created_at TEXT NOT NULL, PRIMARY KEY(environment_id, revision)`,
  },
  {
    name: 'operations',
    columns: 'operation_id,environment_id,kind,status,phase,started_at,ended_at,error_code',
    definition: `
      operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(operation_id)) > 0),
      environment_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('start','stop','recover','create','update','trash','restore','install','remove-kernel')),
      status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled')),
      phase TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, error_code TEXT`,
  },
  {
    name: 'credential_cleanup',
    columns: 'credential_ref,created_at',
    definition: `
      credential_ref TEXT PRIMARY KEY NOT NULL CHECK(length(trim(credential_ref)) > 0),
      created_at TEXT NOT NULL`,
  },
] as const

const indexes = [
  ['idx_environments_updated_at', 'environments', 'updated_at', false, 0],
  ['idx_runtime_sessions_environment', 'runtime_sessions', 'environment_id', false, 0],
  ['idx_runtime_sessions_status', 'runtime_sessions', 'status', false, 0],
  [
    'idx_kernel_installations_identity',
    'kernel_installations',
    'kernel_id,version,platform,arch',
    true,
    0,
  ],
  ['idx_operations_started', 'operations', 'started_at', false, 1],
] as const

// Column metadata as shipped in v4, including intentionally nullable legacy PKs.
const legacyColumns: Record<
  string,
  { integers: string[]; nullable: string[]; primary: string[]; defaults: Record<string, string> }
> = {
  environments: {
    integers: ['revision'],
    nullable: ['environment_id', 'proxy_id', 'trashed_at'],
    primary: ['environment_id'],
    defaults: { revision: '1', lifecycle: "'active'" },
  },
  kernel_installations: {
    integers: ['id'],
    nullable: ['id', 'source_url', 'sha256'],
    primary: ['id'],
    defaults: {},
  },
  runtime_sessions: {
    integers: ['pid', 'control_port', 'revision'],
    nullable: [
      'session_id',
      'exit_reason',
      'ended_at',
      'revision',
      'kernel_version',
      'executable_version',
      'process_identity',
    ],
    primary: ['session_id'],
    defaults: { phase: "'legacy'" },
  },
  proxies: {
    integers: ['port'],
    nullable: ['proxy_id', 'username', 'credential_ref'],
    primary: ['proxy_id'],
    defaults: { name: "''" },
  },
  app_settings: { integers: [], nullable: ['setting_key'], primary: ['setting_key'], defaults: {} },
  environment_revisions: {
    integers: ['revision'],
    nullable: [],
    primary: ['environment_id', 'revision'],
    defaults: {},
  },
  operations: {
    integers: [],
    nullable: ['operation_id', 'environment_id', 'ended_at', 'error_code'],
    primary: ['operation_id'],
    defaults: {},
  },
  credential_cleanup: { integers: [], nullable: [], primary: ['credential_ref'], defaults: {} },
}

function assertLegacyShape(sqlite: DatabaseSync): void {
  const objects = sqlite
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'")
    .all()
  for (const object of objects) {
    const supported =
      object.type === 'table'
        ? tables.some((table) => table.name === object.name)
        : object.type === 'index' &&
          indexes.some(([name, table]) => name === object.name && table === object.tbl_name)
    if (
      !supported ||
      (object.type === 'table' &&
        typeof object.sql === 'string' &&
        /\b(CHECK|REFERENCES|FOREIGN|UNIQUE|STRICT|WITHOUT|GENERATED|COLLATE)\b/i.test(object.sql))
    )
      throw new Error('DATABASE_SCHEMA_UNSUPPORTED')
  }
  for (const table of tables) {
    const columns = sqlite.prepare(`PRAGMA table_xinfo(${table.name})`).all()
    const expected = legacyColumns[table.name]!
    for (const column of columns) {
      const name = typeof column.name === 'string' ? column.name : ''
      if (
        column.type !== (expected.integers.includes(name) ? 'INTEGER' : 'TEXT') ||
        column.notnull !== Number(!expected.nullable.includes(name)) ||
        column.pk !== expected.primary.indexOf(name) + 1 ||
        column.dflt_value !== (expected.defaults[name] ?? null)
      )
        throw new Error('DATABASE_SCHEMA_UNSUPPORTED')
    }
    if (
      columns.map((column) => column.name).join(',') !== table.columns ||
      columns.some((column) => column.hidden !== 0)
    )
      throw new Error('DATABASE_SCHEMA_UNSUPPORTED')
  }
  for (const [name, table, columns, unique, descending] of indexes) {
    const index = sqlite
      .prepare(`PRAGMA index_list(${table})`)
      .all()
      .find((row) => row.name === name)
    const info = sqlite
      .prepare(`PRAGMA index_xinfo(${name})`)
      .all()
      .filter((row) => row.key === 1)
    if (
      !index ||
      index.unique !== Number(unique) ||
      index.partial !== 0 ||
      info.map((row) => row.name).join(',') !== columns ||
      info.some((row) => row.desc !== descending || row.coll !== 'BINARY')
    )
      throw new Error('DATABASE_SCHEMA_UNSUPPORTED')
  }
}

/** A consistent snapshot/write transaction is owned by the caller. Never expose row values. */
export function verifyDatabaseRelations(sqlite: DatabaseSync): void {
  // Operations intentionally include failed requests and non-environment installation keys.
  const invalid = sqlite
    .prepare(
      `
    SELECT 1 FROM environments e LEFT JOIN proxies p ON p.proxy_id = e.proxy_id
      WHERE e.proxy_id IS NOT NULL AND p.proxy_id IS NULL
    UNION ALL
    SELECT 1 FROM environment_revisions r LEFT JOIN environments e ON e.environment_id = r.environment_id
      WHERE e.environment_id IS NULL
    UNION ALL
    SELECT 1 FROM environments e LEFT JOIN environment_revisions r
      ON r.environment_id = e.environment_id AND r.revision = e.revision
      WHERE r.environment_id IS NULL OR r.config_json <> e.config_json
    UNION ALL
    SELECT 1 FROM runtime_sessions s LEFT JOIN environments e ON e.environment_id = s.environment_id
      WHERE e.environment_id IS NULL
    UNION ALL
    SELECT 1 FROM runtime_sessions s LEFT JOIN environment_revisions r
      ON r.environment_id = s.environment_id AND r.revision = s.revision
      WHERE s.revision IS NOT NULL AND r.environment_id IS NULL
    LIMIT 1
  `,
    )
    .get()
  if (invalid || sqlite.prepare('PRAGMA foreign_key_check').get())
    throw new Error('DATABASE_INTEGRITY_FAILED')
}

/** Called with foreign_keys disabled outside the encompassing write transaction. */
export function migrateIntegritySchema(sqlite: DatabaseSync): void {
  assertLegacyShape(sqlite)
  verifyDatabaseRelations(sqlite)
  const sequence = sqlite
    .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'kernel_installations'")
    .get()?.seq
  for (const table of tables) {
    // Both identifiers and every SQL fragment are compile-time migration constants.
    sqlite.exec(`CREATE TABLE next_${table.name} (${table.definition}) STRICT`)
    try {
      sqlite.exec(
        `INSERT INTO next_${table.name} (${table.columns}) SELECT ${table.columns} FROM ${table.name}`,
      )
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'errcode' in error &&
        typeof error.errcode === 'number' &&
        (error.errcode & 255) === 19
      )
        throw new Error('DATABASE_INTEGRITY_FAILED')
      throw error
    }
  }
  if (sequence !== undefined) {
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
      throw new Error('DATABASE_INTEGRITY_FAILED')
    sqlite
      .prepare(
        "UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'next_kernel_installations'",
      )
      .run(sequence)
  }
  for (const table of tables) sqlite.exec(`DROP TABLE ${table.name}`)
  for (const table of tables) sqlite.exec(`ALTER TABLE next_${table.name} RENAME TO ${table.name}`)
  for (const [name, table, columns, unique, descending] of indexes)
    sqlite.exec(
      `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table} (${columns}${descending ? ' DESC' : ''})`,
    )
  sqlite.exec('CREATE INDEX idx_environments_proxy ON environments(proxy_id)')
  verifyDatabaseRelations(sqlite)
}
