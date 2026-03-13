import { getDatabase } from './database';
import { HttpFlow, HttpRequest, HttpResponse, Rule } from '../../shared/types';

export function saveFlow(flow: HttpFlow): void {
  const db = getDatabase();
  const insertFlow = db.prepare(`
    INSERT OR REPLACE INTO flows (id, state, tags, notes, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertRequest = db.prepare(`
    INSERT OR REPLACE INTO requests (id, flow_id, method, url, protocol, host, path, headers, body, body_size, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertResponse = db.prepare(`
    INSERT OR REPLACE INTO responses (id, request_id, flow_id, status_code, status_message, headers, body, body_size, timestamp, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    insertFlow.run(
      flow.id,
      flow.state,
      JSON.stringify(flow.tags),
      flow.notes || null,
      flow.createdAt,
    );

    insertRequest.run(
      flow.request.id,
      flow.id,
      flow.request.method,
      flow.request.url,
      flow.request.protocol,
      flow.request.host,
      flow.request.path,
      JSON.stringify(flow.request.headers),
      flow.request.body ? String(flow.request.body) : null,
      flow.request.bodySize,
      flow.request.timestamp,
    );

    if (flow.response) {
      insertResponse.run(
        flow.response.id,
        flow.response.requestId,
        flow.id,
        flow.response.statusCode,
        flow.response.statusMessage,
        JSON.stringify(flow.response.headers),
        flow.response.body ? String(flow.response.body) : null,
        flow.response.bodySize,
        flow.response.timestamp,
        flow.response.duration,
      );
    }
  });

  transaction();
}

export function getFlows(limit = 1000, offset = 0): HttpFlow[] {
  const db = getDatabase();
  const rows = db.prepare(`
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
  `).all(limit, offset) as any[];

  return rows.map(rowToFlow);
}

export function searchFlows(query: string): HttpFlow[] {
  const db = getDatabase();
  const rows = db.prepare(`
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
  `).all(`%${query}%`, `%${query}%`, `%${query}%`) as any[];

  return rows.map(rowToFlow);
}

export function getErrorFlows(): HttpFlow[] {
  const db = getDatabase();
  const rows = db.prepare(`
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
  `).all() as any[];

  return rows.map(rowToFlow);
}

export function clearAllFlows(): void {
  const db = getDatabase();
  db.exec('DELETE FROM responses; DELETE FROM requests; DELETE FROM flows;');
}

export function saveRule(rule: Rule): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO rules (id, type, name, enabled, match_criteria, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.id,
    rule.type,
    rule.name,
    rule.enabled ? 1 : 0,
    JSON.stringify(rule.matchCriteria),
    JSON.stringify(rule),
    rule.createdAt,
    rule.updatedAt,
  );
}

export function getRules(): Rule[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT config FROM rules ORDER BY created_at DESC').all() as any[];
  return rows.map((r: any) => JSON.parse(r.config));
}

export function deleteRule(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM rules WHERE id = ?').run(id);
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
