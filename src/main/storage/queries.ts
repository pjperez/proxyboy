import { getDatabase, schedulePersist } from './database';
import { FlowTiming, HttpFlow, HttpRequest, HttpResponse, Rule, Session, StoredBody } from '../../shared/types';
import { annotateGraphQLRequest } from '../../shared/graphql';

function isProbablyTextBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(512, buf.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) nonPrintable++;
  }
  return nonPrintable <= sample.length * 0.1;
}

function encodeBody(body?: Buffer | string): StoredBody | null {
  if (!body) return null;
  if (typeof body === 'string') {
    return { data: body, encoding: 'utf8' };
  }
  if (isProbablyTextBuffer(body)) {
    return { data: body.toString('utf8'), encoding: 'utf8' };
  }
  return { data: body.toString('base64'), encoding: 'base64' };
}

function decodeBody(data?: string, encoding?: string): Buffer | string | undefined {
  if (!data) return undefined;
  if (encoding === 'base64') {
    return Buffer.from(data, 'base64');
  }
  return data;
}

export function saveFlow(flow: HttpFlow, sessionId?: string): void {
  const db = getDatabase();
  const requestBody = encodeBody(flow.request.body);
  const responseBody = encodeBody(flow.response?.body);

  db.run(
    `INSERT OR REPLACE INTO flows (id, state, tags, notes, created_at, timing, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [flow.id, flow.state, JSON.stringify(flow.tags), flow.notes || null, flow.createdAt, flow.timing ? JSON.stringify(flow.timing) : null, sessionId || null],
  );

  db.run(
    `INSERT OR REPLACE INTO requests (
       id, flow_id, method, url, protocol, host, path, headers,
       body, body_encoding, body_size, graphql_operation_type, graphql_operation_name, timestamp
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      flow.request.id, flow.id, flow.request.method, flow.request.url,
      flow.request.protocol, flow.request.host, flow.request.path,
      JSON.stringify(flow.request.headers),
      requestBody?.data || null,
      requestBody?.encoding || null,
      flow.request.bodySize,
      flow.request.graphqlOperationType || null,
      flow.request.graphqlOperationName || null,
      flow.request.timestamp,
    ],
  );

  if (flow.response) {
    db.run(
      `INSERT OR REPLACE INTO responses (id, request_id, flow_id, status_code, status_message, headers, body, body_encoding, body_size, timestamp, duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        flow.response.id, flow.response.requestId, flow.id,
        flow.response.statusCode, flow.response.statusMessage,
        JSON.stringify(flow.response.headers),
        responseBody?.data || null,
        responseBody?.encoding || null,
        flow.response.bodySize, flow.response.timestamp, flow.response.duration,
      ],
    );
  }

  schedulePersist();
}

function queryFlows(sql: string, params: any[] = []): HttpFlow[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);

  const flows: HttpFlow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    flows.push(rowToFlow(row));
  }
  stmt.free();
  return flows;
}

export function getFlows(limit = 1000, offset = 0, sessionId?: string): HttpFlow[] {
  const sessionFilter = sessionId ? 'AND f.session_id = ?' : '';
  // Place sessionId params before limit/offset in the WHERE clause
  const reorderedParams = sessionId ? [sessionId, limit, offset] : [limit, offset];
  return queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at, f.timing,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body as req_body, r.body_encoding as req_body_encoding, r.body_size as req_body_size,
           r.graphql_operation_type as req_graphql_operation_type, r.graphql_operation_name as req_graphql_operation_name,
           r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body as res_body, res.body_encoding as res_body_encoding, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
    FROM flows f
    JOIN requests r ON r.flow_id = f.id
    LEFT JOIN responses res ON res.flow_id = f.id
    WHERE 1=1 ${sessionFilter}
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `, reorderedParams);
}

/**
 * Lightweight list query that omits request/response bodies.
 * The UI only needs metadata (method, url, status, size) for the flow list;
 * bodies are loaded on demand via getFlowById() when a flow is selected.
 * This avoids transferring potentially gigabytes of body data on each refresh.
 */
export function getFlowsSummary(limit = 1000, offset = 0, sessionId?: string): HttpFlow[] {
  const sessionFilter = sessionId ? 'AND f.session_id = ?' : '';
  const reorderedParams = sessionId ? [sessionId, limit, offset] : [limit, offset];
  return queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at, f.timing,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body_size as req_body_size,
           r.graphql_operation_type as req_graphql_operation_type, r.graphql_operation_name as req_graphql_operation_name,
           r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
    FROM flows f
    JOIN requests r ON r.flow_id = f.id
    LEFT JOIN responses res ON res.flow_id = f.id
    WHERE 1=1 ${sessionFilter}
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `, reorderedParams);
}

export function getFlowById(id: string): HttpFlow | null {
  const results = queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at, f.timing,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body as req_body, r.body_encoding as req_body_encoding, r.body_size as req_body_size,
           r.graphql_operation_type as req_graphql_operation_type, r.graphql_operation_name as req_graphql_operation_name,
           r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body as res_body, res.body_encoding as res_body_encoding, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
    FROM flows f
    JOIN requests r ON r.flow_id = f.id
    LEFT JOIN responses res ON res.flow_id = f.id
    WHERE f.id = ?
  `, [id]);
  return results.length > 0 ? results[0] : null;
}

export function searchFlows(query: string): HttpFlow[] {
  const pattern = `%${query}%`;
  return queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at, f.timing,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body as req_body, r.body_encoding as req_body_encoding, r.body_size as req_body_size,
           r.graphql_operation_type as req_graphql_operation_type, r.graphql_operation_name as req_graphql_operation_name,
           r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body as res_body, res.body_encoding as res_body_encoding, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
     FROM flows f
     JOIN requests r ON r.flow_id = f.id
     LEFT JOIN responses res ON res.flow_id = f.id
     WHERE r.url LIKE ?
       OR COALESCE(r.graphql_operation_name, '') LIKE ?
       OR (r.body LIKE ? AND COALESCE(r.body_encoding, 'utf8') != 'base64')
       OR (res.body LIKE ? AND COALESCE(res.body_encoding, 'utf8') != 'base64')
     ORDER BY f.created_at DESC
     LIMIT 500
  `, [pattern, pattern, pattern, pattern]);
}

export function getErrorFlows(): HttpFlow[] {
  return queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at, f.timing,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body as req_body, r.body_encoding as req_body_encoding, r.body_size as req_body_size,
           r.graphql_operation_type as req_graphql_operation_type, r.graphql_operation_name as req_graphql_operation_name,
           r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body as res_body, res.body_encoding as res_body_encoding, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
    FROM flows f
    JOIN requests r ON r.flow_id = f.id
    JOIN responses res ON res.flow_id = f.id
    WHERE res.status_code >= 400
    ORDER BY f.created_at DESC
    LIMIT 500
  `);
}

export function clearAllFlows(sessionId?: string): void {
  const db = getDatabase();
  if (sessionId) {
    db.run('DELETE FROM responses WHERE flow_id IN (SELECT id FROM flows WHERE session_id = ?)', [sessionId]);
    db.run('DELETE FROM requests WHERE flow_id IN (SELECT id FROM flows WHERE session_id = ?)', [sessionId]);
    db.run('DELETE FROM flows WHERE session_id = ?', [sessionId]);
  } else {
    db.run('DELETE FROM responses');
    db.run('DELETE FROM requests');
    db.run('DELETE FROM flows');
  }
  schedulePersist();
}

export function deleteFlow(id: string): void {
  const db = getDatabase();
  db.run('DELETE FROM flows WHERE id = ?', [id]);
  schedulePersist();
}

export interface PruneOptions {
  /** Delete flows beyond this many newest (0/null disables). */
  maxCount?: number;
  /** Delete flows older than this many milliseconds (0/null disables). */
  maxAgeMs?: number;
}

/**
 * Prune flows by age and/or count. Flows are removed from the flows table and
 * cascade to their requests/responses. Returns the number of flows deleted.
 */
export function pruneFlows(options: PruneOptions): number {
  const db = getDatabase();
  const idsToDelete = new Set<string>();

  if (options.maxAgeMs != null && options.maxAgeMs > 0) {
    const cutoff = Date.now() - options.maxAgeMs;
    const stmt = db.prepare('SELECT id FROM flows WHERE created_at < ?');
    stmt.bind([cutoff]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (typeof row.id === 'string') idsToDelete.add(row.id);
    }
    stmt.free();
  }

  if (options.maxCount != null && options.maxCount > 0) {
    // Everything beyond the newest maxCount (LIMIT -1 = unbounded, OFFSET skips the kept rows)
    const stmt = db.prepare('SELECT id FROM flows ORDER BY created_at DESC LIMIT -1 OFFSET ?');
    stmt.bind([options.maxCount]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (typeof row.id === 'string') idsToDelete.add(row.id);
    }
    stmt.free();
  }

  if (idsToDelete.size === 0) return 0;

  const ids = [...idsToDelete];
  const placeholders = ids.map(() => '?').join(',');
  db.run(`DELETE FROM flows WHERE id IN (${placeholders})`, ids);
  schedulePersist();
  return ids.length;
}

export interface RetentionSettings {
  maxFlows: number;
  maxAgeDays: number;
}

const DEFAULT_RETENTION: RetentionSettings = { maxFlows: 10000, maxAgeDays: 30 };

/** Read the user-configurable retention policy from app_settings. */
export function getRetentionSettings(): RetentionSettings {
  const rawMaxFlows = getAppSetting('retention_max_flows');
  const rawMaxAgeDays = getAppSetting('retention_max_age_days');
  const maxFlows = rawMaxFlows ? Number(rawMaxFlows) : DEFAULT_RETENTION.maxFlows;
  const maxAgeDays = rawMaxAgeDays ? Number(rawMaxAgeDays) : DEFAULT_RETENTION.maxAgeDays;
  return {
    maxFlows: Number.isFinite(maxFlows) && maxFlows >= 0 ? maxFlows : DEFAULT_RETENTION.maxFlows,
    maxAgeDays: Number.isFinite(maxAgeDays) && maxAgeDays >= 0 ? maxAgeDays : DEFAULT_RETENTION.maxAgeDays,
  };
}

export function setRetentionSettings(settings: RetentionSettings): void {
  setAppSetting('retention_max_flows', String(Math.max(0, Math.round(settings.maxFlows))));
  setAppSetting('retention_max_age_days', String(Math.max(0, settings.maxAgeDays)));
}

/** Apply the configured retention policy now. Returns the number of flows deleted. */
export function runRetentionPolicy(): number {
  const { maxFlows, maxAgeDays } = getRetentionSettings();
  return pruneFlows({
    maxCount: maxFlows > 0 ? maxFlows : undefined,
    maxAgeMs: maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : undefined,
  });
}

/**
 * Hosts whose CONNECT tunnels should be intercepted as HTTP/2 (gRPC) traffic.
 * Stored as a JSON array in app_settings. Plain suffix match is applied at
 * runtime (see ProxyEngine.isGrpcTarget). Empty array = gRPC interception off.
 */
export function getGrpcHosts(): string[] {
  const raw = getAppSetting('grpc_hosts');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : ''))
      .filter((h) => h.length > 0);
  } catch {
    return [];
  }
}

export function setGrpcHosts(hosts: string[]): string[] {
  const cleaned = Array.from(
    new Set(
      hosts
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0),
    ),
  ).sort();
  setAppSetting('grpc_hosts', JSON.stringify(cleaned));
  return cleaned;
}

export function saveRule(rule: Rule): void {
  const db = getDatabase();
  db.run(
    `INSERT OR REPLACE INTO rules (id, type, name, enabled, match_criteria, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rule.id, rule.type, rule.name, rule.enabled ? 1 : 0,
      JSON.stringify(rule.matchCriteria), JSON.stringify(rule),
      rule.createdAt, rule.updatedAt,
    ],
  );
  schedulePersist();
}

export function getRules(): Rule[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT config FROM rules ORDER BY created_at DESC');
  const rules: Rule[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rules.push(JSON.parse(row.config as string));
  }
  stmt.free();
  return rules;
}

export function deleteRule(id: string): void {
  const db = getDatabase();
  db.run('DELETE FROM rules WHERE id = ?', [id]);
  schedulePersist();
}

export function getAppSetting(key: string): string | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1');
  stmt.bind([key]);

  let value: string | null = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    value = typeof row.value === 'string' ? row.value : null;
  }

  stmt.free();
  return value;
}

export function setAppSetting(key: string, value: string): void {
  const db = getDatabase();
  const updatedAt = Date.now();
  db.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, updatedAt],
  );
  schedulePersist();
}

function rowToFlow(row: any): HttpFlow {
  const request: HttpRequest = {
    id: row.req_id,
    method: row.method,
    url: row.url,
    protocol: row.protocol,
    host: row.host,
    path: row.path,
    headers: JSON.parse(row.req_headers || '{}'),
    body: decodeBody(row.req_body as string | undefined, row.req_body_encoding as string | undefined),
    bodySize: row.req_body_size || 0,
    timestamp: row.req_timestamp,
    graphqlOperationType: row.req_graphql_operation_type ? String(row.req_graphql_operation_type) as HttpRequest['graphqlOperationType'] : undefined,
    graphqlOperationName: row.req_graphql_operation_name ? String(row.req_graphql_operation_name) : undefined,
  };

  let response: HttpResponse | undefined;
  if (row.res_id) {
    response = {
      id: row.res_id,
      requestId: row.req_id,
      statusCode: row.status_code,
      statusMessage: row.status_message || '',
      headers: JSON.parse(row.res_headers || '{}'),
      body: decodeBody(row.res_body as string | undefined, row.res_body_encoding as string | undefined),
      bodySize: row.res_body_size || 0,
      timestamp: row.res_timestamp,
      duration: row.duration || 0,
    };
  }

  const tags = JSON.parse(row.tags || '[]');
  if ((request.graphqlOperationType || request.graphqlOperationName) && !tags.includes('graphql')) {
    tags.push('graphql');
  }
  if (!request.graphqlOperationType && !request.graphqlOperationName) {
    annotateGraphQLRequest(request, tags);
  }

  return {
    id: row.id,
    request,
    response,
    state: row.state,
    tags,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    timing: row.timing ? JSON.parse(row.timing as string) as FlowTiming : undefined,
  };
}

// Session CRUD
export function getSessions(): Session[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT id, name, created_at, updated_at FROM sessions ORDER BY created_at ASC');
  const sessions: Session[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    sessions.push({
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    });
  }
  stmt.free();
  return sessions;
}

export function createSession(session: Session): void {
  const db = getDatabase();
  db.run(
    'INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [session.id, session.name, session.createdAt, session.updatedAt],
  );
  schedulePersist();
}

export function renameSession(id: string, name: string): void {
  const db = getDatabase();
  db.run(
    'UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?',
    [name, Date.now(), id],
  );
  schedulePersist();
}

export function deleteSession(id: string): void {
  const db = getDatabase();
  clearAllFlows(id);
  db.run('DELETE FROM sessions WHERE id = ?', [id]);
  schedulePersist();
}

export function getActiveSessionId(): string | null {
  return getAppSetting('active_session_id');
}

export function setActiveSessionId(id: string): void {
  setAppSetting('active_session_id', id);
}
