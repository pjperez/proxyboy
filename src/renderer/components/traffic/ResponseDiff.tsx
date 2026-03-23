import React, { useMemo } from 'react';
import type { HttpFlow, HttpHeaders } from '../../../shared/types';
import { buildDiffLineRows, formatResponseBodyForDiff, type DiffLineState } from '../../utils/response-diff';

interface Props {
  markedFlow: HttpFlow;
  selectedFlow: HttpFlow;
}

interface HeaderRow {
  key: string;
  leftValue: string;
  rightValue: string;
  state: DiffLineState;
}

function normalizeHeaderValue(value?: string | string[]): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return value ? String(value) : '';
}

function buildHeaderRows(leftHeaders: HttpHeaders, rightHeaders: HttpHeaders): HeaderRow[] {
  const keys = [...new Set([...Object.keys(leftHeaders), ...Object.keys(rightHeaders)])].sort();

  return keys.map((key) => {
    const leftValue = normalizeHeaderValue(leftHeaders[key]);
    const rightValue = normalizeHeaderValue(rightHeaders[key]);

    let state: DiffLineState = 'same';
    if (leftValue && !rightValue) {
      state = 'removed';
    } else if (!leftValue && rightValue) {
      state = 'added';
    } else if (leftValue !== rightValue) {
      state = 'changed';
    }

    return { key, leftValue, rightValue, state };
  });
}

function getRowClasses(state: DiffLineState): { left: string; right: string } {
  switch (state) {
    case 'added':
      return { left: 'bg-transparent', right: 'bg-pb-success/10 text-pb-success' };
    case 'removed':
      return { left: 'bg-pb-error/10 text-pb-error', right: 'bg-transparent' };
    case 'changed':
      return { left: 'bg-pb-warning/10 text-pb-warning', right: 'bg-pb-warning/10 text-pb-warning' };
    default:
      return { left: 'bg-transparent', right: 'bg-transparent' };
  }
}

function ResponseSummary({ title, flow }: { title: string; flow: HttpFlow }) {
  const response = flow.response!;
  const statusColor = response.statusCode < 300 ? 'text-pb-success' :
    response.statusCode < 400 ? 'text-pb-warning' : 'text-pb-error';

  return (
    <div className="rounded-lg border border-pb-border bg-pb-surface p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-pb-text-dim">{title}</div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`font-mono font-bold ${statusColor}`}>{response.statusCode}</span>
        <span className="text-pb-text-dim">{response.statusMessage}</span>
        <span className="ml-auto text-pb-text-dim">{response.duration}ms</span>
      </div>
      <div className="mt-2 truncate text-[11px] text-pb-text-dim" title={flow.request.url}>
        {flow.request.url}
      </div>
    </div>
  );
}

function DiffCell({
  lineNumber,
  text,
  className,
}: {
  lineNumber?: number;
  text: string;
  className: string;
}) {
  return (
    <div className={`flex min-h-7 items-start gap-3 px-3 py-1 font-mono text-xs ${className}`}>
      <span className="w-8 shrink-0 text-right text-pb-text-dim">
        {lineNumber ?? ''}
      </span>
      <span className="whitespace-pre-wrap break-all text-pb-text">
        {text || ' '}
      </span>
    </div>
  );
}

export default function ResponseDiff({ markedFlow, selectedFlow }: Props) {
  const markedResponse = markedFlow.response!;
  const selectedResponse = selectedFlow.response!;

  const headerRows = useMemo(
    () => buildHeaderRows(markedResponse.headers, selectedResponse.headers),
    [markedResponse.headers, selectedResponse.headers],
  );
  const bodyRows = useMemo(
    () => buildDiffLineRows(
      formatResponseBodyForDiff(markedResponse),
      formatResponseBodyForDiff(selectedResponse),
    ),
    [markedResponse, selectedResponse],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ResponseSummary title="Marked response" flow={markedFlow} />
        <ResponseSummary title="Selected response" flow={selectedFlow} />
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-pb-text-dim">Headers</h3>
        <div className="overflow-hidden rounded-lg border border-pb-border bg-pb-surface">
          <div className="grid grid-cols-[180px_1fr_1fr] border-b border-pb-border bg-pb-bg/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-pb-text-dim">
            <span>Header</span>
            <span>Marked</span>
            <span>Selected</span>
          </div>
          {headerRows.map((row) => {
            const rowClasses = getRowClasses(row.state);
            return (
              <div
                key={row.key}
                className="grid grid-cols-[180px_1fr_1fr] border-b border-pb-border last:border-b-0 text-xs"
              >
                <div className="px-3 py-2 font-mono text-pb-accent">{row.key}</div>
                <div className={`px-3 py-2 break-all ${rowClasses.left}`}>{row.leftValue || '—'}</div>
                <div className={`px-3 py-2 break-all ${rowClasses.right}`}>{row.rightValue || '—'}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-pb-text-dim">Body</h3>
        <div className="overflow-hidden rounded-lg border border-pb-border bg-pb-surface">
          <div className="grid grid-cols-2 border-b border-pb-border bg-pb-bg/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-pb-text-dim">
            <span>Marked</span>
            <span>Selected</span>
          </div>
          {bodyRows.length === 0 ? (
            <div className="px-3 py-4 text-sm text-pb-text-dim">Neither response has a text body to compare.</div>
          ) : (
            bodyRows.map((row, index) => {
              const rowClasses = getRowClasses(row.state);
              return (
                <div key={`${index}-${row.leftLineNumber ?? 'x'}-${row.rightLineNumber ?? 'y'}`} className="grid grid-cols-2 border-b border-pb-border last:border-b-0">
                  <DiffCell lineNumber={row.leftLineNumber} text={row.leftText} className={rowClasses.left} />
                  <DiffCell lineNumber={row.rightLineNumber} text={row.rightText} className={rowClasses.right} />
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
