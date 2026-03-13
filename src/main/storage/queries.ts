import { getDatabase, persistDatabase } from './database';
import { HttpFlow, HttpRequest, HttpResponse, Rule } from '../../shared/types';

export function saveFlow(flow: HttpFlow): void {
  const db = getDatabase();

  db.run(
    `INSERT OR REPLACE INTO flows (id, state, tags, notes, created_at) VALUES (?, ?, ?, ?, ?)`,
    [flow.id, flow.state, JSON.stringify(flow.tags), flow.notes || null, flow.createdAt],
  );

  db.run(
    `INSERT OR REPLACE INTO requests (id, flow_id, method, url, protocol, host, path, headers, body, body_size, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      flow.request.id, flow.id, flow.request.method, flow.request.url,
      flow.request.protocol, flow.request.host, flow.request.path,
      JSON.stringify(flow.request.headers),
      flow.request.body ? String(flow.request.body) : null,
      flow.request.bodySize, flow.request.timestamp,
    ],
  );

  if (flow.response) {
    db.run(
      `INSERT OR REPLACE INTO responses (id, request_id, flow_id, status_code, status_message, headers, body, body_size, timestamp, duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        flow.response.id, flow.response.requestId, flow.id,
        flow.response.statusCode, flow.response.statusMessage,
        JSON.stringify(flow.response.headers),
        flow.response.body ? String(flow.response.body) : null,
        flow.response.bodySize, flow.response.timestamp, flow.response.duration,
      ],
    );
  }

  persistDatabase();
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

export function getFlows(limit = 1000, offset = 0): HttpFlow[] {
  return queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body as req_body, r.body_size as req_body_size, r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body as res_body, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
    FROM flows f
    JOIN requests r ON r.flow_id = f.id
    LEFT JOIN responses res ON res.flow_id = f.id
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
}

export function searchFlows(query: string): HttpFlow[] {
  const pattern = `%${query}%`;
  return queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body as req_body, r.body_size as req_body_size, r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body as res_body, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
    FROM flows f
    JOIN requests r ON r.flow_id = f.id
    LEFT JOIN responses res ON res.flow_id = f.id
    WHERE r.url LIKE ? OR r.body LIKE ? OR res.body LIKE ?
    ORDER BY f.created_at DESC
    LIMIT 500
  `, [pattern, pattern, pattern]);
}

export function getErrorFlows(): HttpFlow[] {
  return queryFlows(`
    SELECT f.id, f.state, f.tags, f.notes, f.created_at,
           r.id as req_id, r.method, r.url, r.protocol, r.host, r.path,
           r.headers as req_headers, r.body as req_body, r.body_size as req_body_size, r.timestamp as req_timestamp,
           res.id as res_id, res.status_code, res.status_message,
           res.headers as res_headers, res.body as res_body, res.body_size as res_body_size,
           res.timestamp as res_timestamp, res.duration
    FROM flows f
    JOIN requests r ON r.flow_id = f.id
    JOIN responses res ON res.flow_id = f.id
    WHERE res.status_code >= 400
    ORDER BY f.created_at DESC
    LIMIT 500
  `);
}

export function clearAllFlows(): void {
  const db = getDatabase();
  db.run('DELETE FROM responses');
  db.run('DELETE FROM requests');
  db.run('DELETE FROM flows');
  persistDatabase();
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
  persistDatabase();
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
  persistDatabase();
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
    body: row.req_body || undefined,
    bodySize: row.req_body_size || 0,
    timestamp: row.req_timestamp,
  };

  let response: HttpResponse | undefined;
  if (row.res_id) {
    response = {
      id: row.res_id,
      requestId: row.req_id,
      statusCode: row.status_code,
      statusMessage: row.status_message || '',
      headers: JSON.parse(row.res_headers || '{}'),
      body: row.res_body || undefined,
      bodySize: row.res_body_size || 0,
      timestamp: row.res_timestamp,
      duration: row.duration || 0,
    };
  }

  return {
    id: row.id,
    request,
    response,
    state: row.state,
    tags: JSON.parse(row.tags || '[]'),
    notes: row.notes || undefined,
    createdAt: row.created_at,
  };
}
