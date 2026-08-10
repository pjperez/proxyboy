import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Track disk writes so we can assert the dirty-flag persistence behavior.
const { writeFileCalls } = vi.hoisted(() => ({ writeFileCalls: { count: 0 } }));

vi.mock('fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fs')>();
  return {
    ...mod,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      writeFileCalls.count++;
      return mod.writeFileSync(...args);
    },
  };
});

// Re-pointable so each test gets an isolated DB file.
let userDataPath = '/tmp/proxyboy-storage-default';
vi.mock('electron', () => ({
  app: { getPath: () => userDataPath },
}));

import * as database from './database';
import {
  pruneFlows,
  runRetentionPolicy,
  getRetentionSettings,
  setRetentionSettings,
  getGrpcHosts,
  setGrpcHosts,
  saveFlow,
} from './queries';
import type { HttpFlow } from '../../shared/types';

function makeFlow(id: string, createdAt: number): HttpFlow {
  return {
    id,
    request: {
      id: `${id}-req`,
      method: 'GET',
      url: `https://example.com/${id}`,
      protocol: 'https',
      host: 'example.com',
      path: `/${id}`,
      headers: { host: 'example.com' },
      bodySize: 0,
      timestamp: createdAt,
    },
    response: {
      id: `${id}-res`,
      requestId: `${id}-req`,
      statusCode: 200,
      statusMessage: 'OK',
      headers: {},
      bodySize: 0,
      timestamp: createdAt,
      duration: 1,
    },
    state: 'complete',
    tags: [],
    createdAt,
  };
}

function flowIds(): string[] {
  const stmt = database.getDatabase().prepare('SELECT id FROM flows');
  const ids: string[] = [];
  while (stmt.step()) ids.push(stmt.getAsObject().id as string);
  stmt.free();
  return ids;
}

let tempDir: string;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxyboy-storage-'));
});

afterEach(async () => {
  database.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function freshDb(file: string): Promise<void> {
  database.closeDatabase();
  userDataPath = path.join(tempDir, file, 'userData');
  fs.mkdirSync(userDataPath, { recursive: true });
  await database.initDatabase();
}

describe('pruneFlows', () => {
  it('deletes nothing when no limits are set', async () => {
    await freshDb('a');
    saveFlow(makeFlow('f1', Date.now() - 1000));
    expect(pruneFlows({})).toBe(0);
    expect(flowIds()).toEqual(['f1']);
  });

  it('keeps the newest maxCount flows', async () => {
    await freshDb('b');
    const now = Date.now();
    saveFlow(makeFlow('f-old', now - 5000));
    saveFlow(makeFlow('f-new', now));

    expect(pruneFlows({ maxCount: 1 })).toBe(1);
    expect(flowIds()).toEqual(['f-new']);
  });

  it('deletes flows older than maxAgeMs', async () => {
    await freshDb('c');
    const now = Date.now();
    saveFlow(makeFlow('f-old', now - 40 * 24 * 60 * 60 * 1000)); // 40 days ago
    saveFlow(makeFlow('f-recent', now - 1000));

    expect(pruneFlows({ maxAgeMs: 30 * 24 * 60 * 60 * 1000 })).toBe(1);
    expect(flowIds()).toEqual(['f-recent']);
  });

  it('combines age and count pruning', async () => {
    await freshDb('d');
    const now = Date.now();
    saveFlow(makeFlow('f-oldest', now - 40 * 24 * 60 * 60 * 1000));
    saveFlow(makeFlow('f-old2', now - 35 * 24 * 60 * 60 * 1000));
    saveFlow(makeFlow('f-mid', now - 1000));
    saveFlow(makeFlow('f-newest', now));

    // Age cap (30d) removes f-oldest + f-old2; count cap of 1 additionally
    // removes f-mid. Union of both caps is 3 deletions.
    expect(pruneFlows({ maxCount: 1, maxAgeMs: 30 * 24 * 60 * 60 * 1000 })).toBe(3);
    expect(flowIds()).toEqual(['f-newest']);
  });
});

describe('runRetentionPolicy', () => {
  it('uses default retention settings when nothing is configured', async () => {
    await freshDb('e');
    expect(getRetentionSettings()).toEqual({ maxFlows: 10000, maxAgeDays: 30 });
  });

  it('round-trips configured retention settings', async () => {
    await freshDb('f');
    setRetentionSettings({ maxFlows: 500, maxAgeDays: 7 });
    expect(getRetentionSettings()).toEqual({ maxFlows: 500, maxAgeDays: 7 });
  });

  it('applies configured count cap on next run', async () => {
    await freshDb('g');
    setRetentionSettings({ maxFlows: 1, maxAgeDays: 0 });
    const now = Date.now();
    saveFlow(makeFlow('f1', now - 2000));
    saveFlow(makeFlow('f2', now));

    expect(runRetentionPolicy()).toBe(1);
    expect(flowIds()).toEqual(['f2']);
  });
});

describe('grpc hosts', () => {
  it('defaults to an empty list when nothing is configured', async () => {
    await freshDb('grpc-default');
    expect(getGrpcHosts()).toEqual([]);
  });

  it('round-trips a configured host list', async () => {
    await freshDb('grpc-roundtrip');
    setGrpcHosts(['grpc.example.com', 'api.grpcbin.com']);
    expect(getGrpcHosts()).toEqual(['api.grpcbin.com', 'grpc.example.com']);
  });

  it('trims, lowercases, dedupes and sorts hosts', async () => {
    await freshDb('grpc-normalize');
    const cleaned = setGrpcHosts([
      '  Grpc.Example.COM  ',
      'grpc.example.com',
      'second.example.com',
      '',
      '   ',
    ]);
    expect(cleaned).toEqual(['grpc.example.com', 'second.example.com']);
    expect(getGrpcHosts()).toEqual(['grpc.example.com', 'second.example.com']);
  });

  it('returns an empty list when stored value is corrupt JSON', async () => {
    await freshDb('grpc-corrupt');
    // Write a malformed value directly through the underlying app-settings key.
    const { setAppSetting } = await import('./queries');
    setAppSetting('grpc_hosts', '{not json');
    expect(getGrpcHosts()).toEqual([]);
  });

  it('returns an empty list when stored value is a non-array JSON', async () => {
    await freshDb('grpc-nonarray');
    const { setAppSetting } = await import('./queries');
    setAppSetting('grpc_hosts', '"grpc.example.com"');
    expect(getGrpcHosts()).toEqual([]);
  });
});

describe('persistence efficiency', () => {
  it('writes the database file only when data is dirty', async () => {
    await freshDb('h');
    writeFileCalls.count = 0;

    // Fresh DB wrote during init; no mutations since → close writes nothing.
    await database.closeDatabase();
    expect(writeFileCalls.count).toBe(0);
  });

  it('does not rewrite an existing database file on load', async () => {
    await freshDb('i');
    await database.closeDatabase(); // closes, no writes since init

    writeFileCalls.count = 0;
    await database.initDatabase(); // loads existing file
    expect(writeFileCalls.count).toBe(0);
  });

  it('persists after a mutation via schedulePersist debounce', async () => {
    await freshDb('j');
    writeFileCalls.count = 0;

    saveFlow(makeFlow('f-dirty', Date.now()));
    await database.closeDatabase(); // persists because data changed
    expect(writeFileCalls.count).toBe(1);
  });
});
