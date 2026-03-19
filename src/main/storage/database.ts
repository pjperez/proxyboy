import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

let db: SqlJsDatabase | null = null;
let dbPath: string = '';

function getWasmPath(): string {
  // In packaged app, the WASM file is in the app resources
  // In development, it's in node_modules
  const candidates = [
    path.join(__dirname, 'sql-wasm.wasm'),
    path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
    path.resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.resolve('node_modules/sql.js/dist/sql-wasm.wasm'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Fallback: let sql.js try its default resolution
  return 'sql-wasm.wasm';
}

export async function initDatabase(): Promise<void> {
  if (db) return;

  const wasmPath = getWasmPath();
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });
  dbPath = path.join(app.getPath('userData'), 'proxyboy.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');
  initializeSchema(db);
  persistDatabase();
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function persistDatabase(): void {
  if (db && dbPath) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistDatabase();
  }, 5000);
}

function initializeSchema(database: SqlJsDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'pending',
      tags TEXT DEFAULT '[]',
      notes TEXT,
      created_at INTEGER NOT NULL,
      timing TEXT
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      protocol TEXT NOT NULL,
      host TEXT NOT NULL,
      path TEXT NOT NULL,
      headers TEXT NOT NULL DEFAULT '{}',
      body TEXT,
      body_encoding TEXT DEFAULT 'utf8',
      body_size INTEGER DEFAULT 0,
      graphql_operation_type TEXT,
      graphql_operation_name TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      status_message TEXT,
      headers TEXT NOT NULL DEFAULT '{}',
      body TEXT,
      body_encoding TEXT DEFAULT 'utf8',
      body_size INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      duration INTEGER DEFAULT 0,
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      match_criteria TEXT NOT NULL DEFAULT '{}',
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
    );
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_requests_flow_id ON requests(flow_id);');
  database.run('CREATE INDEX IF NOT EXISTS idx_responses_flow_id ON responses(flow_id);');
  database.run('CREATE INDEX IF NOT EXISTS idx_requests_url ON requests(url);');
  database.run('CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);');
  database.run('CREATE INDEX IF NOT EXISTS idx_responses_status_code ON responses(status_code);');
  database.run('CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id);');
  ensureColumn(database, 'flows', 'timing', 'TEXT');
  ensureColumn(database, 'requests', 'body_encoding', "TEXT DEFAULT 'utf8'");
  ensureColumn(database, 'requests', 'graphql_operation_type', 'TEXT');
  ensureColumn(database, 'requests', 'graphql_operation_name', 'TEXT');
  ensureColumn(database, 'responses', 'body_encoding', "TEXT DEFAULT 'utf8'");
  ensureColumn(database, 'rules', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'app_settings', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'agent_conversations', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');
}

function ensureColumn(database: SqlJsDatabase, table: string, column: string, definition: string): void {
  const stmt = database.prepare(`PRAGMA table_info(${table})`);
  let exists = false;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (row.name === column) {
      exists = true;
      break;
    }
  }
  stmt.free();

  if (!exists) {
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function closeDatabase(): void {
  if (db) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistDatabase();
    db.close();
    db = null;
  }
}
