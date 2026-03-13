import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'proxyboy.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'pending',
      tags TEXT DEFAULT '[]',
      notes TEXT,
      created_at INTEGER NOT NULL
    );

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
      body_size INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      status_message TEXT,
      headers TEXT NOT NULL DEFAULT '{}',
      body TEXT,
      body_size INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      duration INTEGER DEFAULT 0,
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );

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

    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_requests_flow_id ON requests(flow_id);
    CREATE INDEX IF NOT EXISTS idx_responses_flow_id ON responses(flow_id);
    CREATE INDEX IF NOT EXISTS idx_requests_url ON requests(url);
    CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);
    CREATE INDEX IF NOT EXISTS idx_responses_status_code ON responses(status_code);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id);
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
