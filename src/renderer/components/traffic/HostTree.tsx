import React, { useMemo } from 'react';
import type { HttpFlow } from '../../../shared/types';

interface HostCount {
  host: string;
  count: number;
  errorCount: number;
}

interface Props {
  flows: HttpFlow[];
  selectedHost: string | null;
  onSelectHost: (host: string | null) => void;
}

function getHostCounts(flows: HttpFlow[]): HostCount[] {
  const counts = new Map<string, HostCount>();
  for (const flow of flows) {
    const host = flow.request.host || '(unknown)';
    const current = counts.get(host) ?? { host, count: 0, errorCount: 0 };
    current.count += 1;
    if (flow.state === 'error' || (flow.response && flow.response.statusCode >= 400)) {
      current.errorCount += 1;
    }
    counts.set(host, current);
  }

  return Array.from(counts.values()).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.host.localeCompare(right.host);
  });
}

export default function HostTree({ flows, selectedHost, onSelectHost }: Props) {
  const hosts = useMemo(() => getHostCounts(flows), [flows]);

  return (
    <div className="flex h-full w-52 shrink-0 flex-col border-r border-pb-border bg-pb-surface">
      <div className="flex items-center justify-between border-b border-pb-border px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-pb-text-dim">
          Hosts
        </div>
        <div className="text-[10px] text-pb-text-dim">{hosts.length}</div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <button
          type="button"
          onClick={() => onSelectHost(null)}
          className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
            selectedHost == null
              ? 'bg-pb-accent/15 text-pb-accent'
              : 'text-pb-text hover:bg-pb-surface-hover'
          }`}
        >
          <span>All hosts</span>
          <span className="font-mono text-[10px] text-pb-text-dim">{flows.length}</span>
        </button>
        {hosts.map((entry) => (
          <button
            key={entry.host}
            type="button"
            onClick={() => onSelectHost(entry.host === selectedHost ? null : entry.host)}
            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              selectedHost === entry.host
                ? 'bg-pb-accent/15 text-pb-accent'
                : 'text-pb-text hover:bg-pb-surface-hover'
            }`}
            title={entry.host}
          >
            <span className="truncate font-mono">{entry.host}</span>
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
              {entry.errorCount > 0 && (
                <span className="text-pb-error">{entry.errorCount}</span>
              )}
              <span className="text-pb-text-dim">{entry.count}</span>
            </span>
          </button>
        ))}
        {hosts.length === 0 && (
          <div className="px-3 py-4 text-xs text-pb-text-dim">
            Hosts appear here once traffic is captured.
          </div>
        )}
      </div>
    </div>
  );
}
