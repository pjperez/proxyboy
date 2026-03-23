import { useEffect, useMemo, useState } from 'react';
import type {
  BreakpointPauseMessage,
  BreakpointResumeMessage,
  HttpHeaders,
  StoredBody,
} from '../../../shared/types';

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

interface EditableBodyState {
  data: string;
  encoding: StoredBody['encoding'];
}

interface BreakpointPauseDialogProps {
  pause: BreakpointPauseMessage;
  onResume: (message: BreakpointResumeMessage) => void;
}

function getContentType(headers: HttpHeaders | undefined): string | undefined {
  if (!headers) {
    return undefined;
  }
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
  if (!match) {
    return undefined;
  }
  return Array.isArray(match[1]) ? match[1][0] : match[1];
}

function encodeBodyForEditing(
  body: StoredBody | undefined,
  _contentType?: string,
): EditableBodyState {
  if (body == null) {
    return { data: '', encoding: 'utf8' };
  }
  if (body.encoding === 'utf8') {
    return { data: body.data, encoding: 'utf8' };
  }
  return { data: body.data, encoding: 'base64' };
}

function buildHeaderRows(headers: HttpHeaders | undefined): HeaderRow[] {
  if (!headers) {
    return [];
  }
  return Object.entries(headers).flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => ({
      id: crypto.randomUUID(),
      key,
      value: String(entry),
    }));
  });
}

function buildHeaders(rows: HeaderRow[]): HttpHeaders {
  const headers: HttpHeaders = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(headers, key)) {
      headers[key] = row.value;
      continue;
    }

    const currentValue = headers[key];
    if (Array.isArray(currentValue)) {
      currentValue.push(row.value);
      continue;
    }

    headers[key] = [currentValue, row.value];
  }
  return headers;
}

function normalizeHeaders(headers: HttpHeaders): Array<[string, string[]]> {
  return Object.entries(headers)
    .map(([key, value]) => [
      key.toLowerCase(),
      (Array.isArray(value) ? value : [value]).map((entry) => String(entry)),
    ] as [string, string[]])
    .sort(([left], [right]) => left.localeCompare(right));
}

function headersEqual(left: HttpHeaders, right: HttpHeaders): boolean {
  return JSON.stringify(normalizeHeaders(left)) === JSON.stringify(normalizeHeaders(right));
}

function bodyEqual(left: EditableBodyState, right: EditableBodyState): boolean {
  return left.encoding === right.encoding && left.data === right.data;
}

function SectionBadge({ modified }: { modified: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        modified
          ? 'bg-yellow-500/20 text-yellow-200'
          : 'bg-slate-700 text-slate-300'
      }`}
    >
      {modified ? 'Modified' : 'Original'}
    </span>
  );
}

function HeaderEditor({
  label,
  rows,
  onChange,
  modified,
}: {
  label: string;
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  modified: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-100">{label}</h4>
        <SectionBadge modified={modified} />
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">
            No headers. Add one below.
          </div>
        ) : null}
        {rows.map((row, index) => (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
            <input
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              placeholder="Header name"
              value={row.key}
              onChange={(event) => {
                const nextRows = rows.slice();
                nextRows[index] = { ...row, key: event.target.value };
                onChange(nextRows);
              }}
            />
            <input
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              placeholder="Header value"
              value={row.value}
              onChange={(event) => {
                const nextRows = rows.slice();
                nextRows[index] = { ...row, value: event.target.value };
                onChange(nextRows);
              }}
            />
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        onClick={() => onChange([...rows, { id: crypto.randomUUID(), key: '', value: '' }])}
      >
        Add header
      </button>
    </div>
  );
}

function BodyEditor({
  label,
  body,
  onChange,
  modified,
}: {
  label: string;
  body: EditableBodyState;
  onChange: (body: EditableBodyState) => void;
  modified: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-100">{label}</h4>
          <p className="text-xs text-slate-400">
            {body.encoding === 'base64' ? 'Editing base64-encoded body bytes.' : 'Editing UTF-8 body text.'}
          </p>
        </div>
        <SectionBadge modified={modified} />
      </div>
      <textarea
        className="min-h-48 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
        value={body.data}
        onChange={(event) => onChange({ ...body, data: event.target.value })}
        spellCheck={false}
      />
    </div>
  );
}

function BreakpointPauseDialog({
  pause,
  onResume,
}: BreakpointPauseDialogProps) {
  const { flow, phase } = pause;
  const request = flow.request;
  const response = flow.response;

  const originalRequestHeaders = useMemo(() => buildHeaderRows(request.headers), [request.headers]);
  const originalRequestBody = useMemo(
    () => encodeBodyForEditing(request.body, getContentType(request.headers)),
    [request.body, request.headers],
  );
  const originalResponseHeaders = useMemo(
    () => buildHeaderRows(response?.headers),
    [response?.headers],
  );
  const originalResponseBody = useMemo(
    () => encodeBodyForEditing(response?.body, getContentType(response?.headers)),
    [response?.body, response?.headers],
  );

  const [requestHeaders, setRequestHeaders] = useState<HeaderRow[]>(originalRequestHeaders);
  const [requestBody, setRequestBody] = useState<EditableBodyState>(originalRequestBody);
  const [responseHeaders, setResponseHeaders] = useState<HeaderRow[]>(originalResponseHeaders);
  const [responseBody, setResponseBody] = useState<EditableBodyState>(originalResponseBody);
  const [statusCode, setStatusCode] = useState(response ? String(response.statusCode) : '');
  const [statusMessage, setStatusMessage] = useState(response?.statusMessage ?? '');

  useEffect(() => {
    setRequestHeaders(originalRequestHeaders);
    setRequestBody(originalRequestBody);
    setResponseHeaders(originalResponseHeaders);
    setResponseBody(originalResponseBody);
    setStatusCode(response ? String(response.statusCode) : '');
    setStatusMessage(response?.statusMessage ?? '');
  }, [
    originalRequestBody,
    originalRequestHeaders,
    originalResponseBody,
    originalResponseHeaders,
    response,
  ]);

  const requestHeadersModified = useMemo(
    () => !headersEqual(buildHeaders(requestHeaders), buildHeaders(originalRequestHeaders)),
    [originalRequestHeaders, requestHeaders],
  );
  const requestBodyModified = useMemo(
    () => !bodyEqual(requestBody, originalRequestBody),
    [originalRequestBody, requestBody],
  );
  const responseHeadersModified = useMemo(
    () => !headersEqual(buildHeaders(responseHeaders), buildHeaders(originalResponseHeaders)),
    [originalResponseHeaders, responseHeaders],
  );
  const responseBodyModified = useMemo(
    () => !bodyEqual(responseBody, originalResponseBody),
    [originalResponseBody, responseBody],
  );
  const responseStatusModified = response
    ? statusCode !== String(response.statusCode) || statusMessage !== response.statusMessage
    : false;

  const statusCodeNumber = Number(statusCode);
  const invalidStatusCode = phase === 'response' && (
    Number.isNaN(statusCodeNumber) || !Number.isInteger(statusCodeNumber) || statusCodeNumber < 100 || statusCodeNumber > 999
  );

  const reset = () => {
    setRequestHeaders(originalRequestHeaders);
    setRequestBody(originalRequestBody);
    setResponseHeaders(originalResponseHeaders);
    setResponseBody(originalResponseBody);
    setStatusCode(response ? String(response.statusCode) : '');
    setStatusMessage(response?.statusMessage ?? '');
  };

  const forward = () => {
    if (phase === 'request') {
      onResume({
        flowId: flow.id,
        action: 'forward',
        request: {
          headers: buildHeaders(requestHeaders),
          body: requestBody.data === '' && originalRequestBody.data === ''
            ? undefined
            : { data: requestBody.data, encoding: requestBody.encoding },
        },
      });
      return;
    }

    if (!response || invalidStatusCode) {
      return;
    }

    onResume({
      flowId: flow.id,
      action: 'forward',
      response: {
        statusCode: statusCodeNumber,
        statusMessage,
        headers: buildHeaders(responseHeaders),
        body: responseBody.data === '' && originalResponseBody.data === ''
          ? undefined
          : { data: responseBody.data, encoding: responseBody.encoding },
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-700 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                Breakpoint paused on {phase}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {request.method} {request.url}
              </p>
            </div>
            <SectionBadge
              modified={phase === 'request'
                ? requestHeadersModified || requestBodyModified
                : responseHeadersModified || responseBodyModified || responseStatusModified}
            />
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400">Method</div>
              <div className="mt-1 text-sm text-slate-100">{request.method}</div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400">URL</div>
              <div className="mt-1 break-all text-sm text-slate-100">{request.url}</div>
            </div>
          </div>

          {phase === 'request' ? (
            <div className="space-y-6">
              <HeaderEditor
                label="Request headers"
                rows={requestHeaders}
                onChange={setRequestHeaders}
                modified={requestHeadersModified}
              />
              <BodyEditor
                label="Request body"
                body={requestBody}
                onChange={setRequestBody}
                modified={requestBodyModified}
              />
            </div>
          ) : response ? (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-100">Response status</h4>
                  <SectionBadge modified={responseStatusModified} />
                </div>
                <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                      Status code
                    </label>
                    <input
                      className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      value={statusCode}
                      onChange={(event) => setStatusCode(event.target.value)}
                    />
                    {invalidStatusCode ? (
                      <p className="mt-1 text-xs text-red-300">Use a numeric HTTP status between 100 and 999.</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                      Status message
                    </label>
                    <input
                      className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      value={statusMessage}
                      onChange={(event) => setStatusMessage(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <HeaderEditor
                label="Response headers"
                rows={responseHeaders}
                onChange={setResponseHeaders}
                modified={responseHeadersModified}
              />
              <BodyEditor
                label="Response body"
                body={responseBody}
                onChange={setResponseBody}
                modified={responseBodyModified}
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-slate-700 px-6 py-4">
          <div className="text-sm text-slate-400">
            Drop aborts the flow immediately. Forward applies the edits and resumes traffic.
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              onClick={reset}
            >
              Reset
            </button>
            <button
              type="button"
              className="rounded border border-red-500/60 px-4 py-2 text-sm text-red-200 hover:bg-red-500/10"
              onClick={() => onResume({ flowId: flow.id, action: 'drop' })}
            >
              Drop
            </button>
            <button
              type="button"
              className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={forward}
              disabled={invalidStatusCode}
            >
              Forward
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BreakpointPauseDialog;
