import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import TrafficRow from './TrafficRow';
import ContextMenu from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { flowToCurl } from '../../utils/curl';
import { useAppStore } from '../../stores/app';
import { useRulesStore } from '../../stores/rules';
import type { HttpFlow, HttpHeaders } from '../../../shared/types';

export type ColumnKey = 'timestamp' | 'method' | 'status' | 'graphql' | 'url' | 'host' | 'type' | 'size' | 'time';
type SortDirection = 'asc' | 'desc';

interface SortState {
  column: ColumnKey | null;
  direction: SortDirection;
}

interface ContextMenuState {
  x: number;
  y: number;
  flow: HttpFlow;
}

interface Props {
  flows: HttpFlow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEditAndResend: (flow: HttpFlow) => void;
  markedFlowId: string | null;
  compareTargetFlowId: string | null;
  onMarkForCompare: (flow: HttpFlow) => void;
  onCompareWithMarked: (flow: HttpFlow) => void;
  onClearComparison: () => void;
}

function getContentType(headers?: HttpHeaders): string {
  if (!headers) return '';
  const ct = (headers['content-type'] || '').toString();
  if (ct.includes('json')) return 'JSON';
  if (ct.includes('html')) return 'HTML';
  if (ct.includes('xml')) return 'XML';
  if (ct.includes('javascript')) return 'JS';
  if (ct.includes('css')) return 'CSS';
  if (ct.includes('image')) return 'Image';
  if (ct.includes('text')) return 'Text';
  return ct.split(';')[0].split('/').pop() || '';
}

function getFlowContentType(flow: HttpFlow): string {
  if (flow.streamKind === 'websocket') return 'WebSocket';
  if (flow.streamKind === 'sse') return 'SSE';
  return getContentType(flow.response?.headers);
}

function formatHeaders(headers: HttpHeaders): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getQuickAddRulePattern(flow: HttpFlow): { hostLabel: string; urlPattern: string } | null {
  try {
    const parsedUrl = new URL(flow.request.url);
    const hostLabel = parsedUrl.hostname || flow.request.host;
    if (!hostLabel) {
      return null;
    }

    return {
      hostLabel,
      urlPattern: `^https?:\\/\\/${escapeRegex(hostLabel)}(?::\\d+)?\\/.*$`,
    };
  } catch {
    return null;
  }
}

function getSortValue(flow: HttpFlow, column: ColumnKey): string | number {
  switch (column) {
    case 'timestamp': return flow.createdAt || flow.request.timestamp;
    case 'method': return flow.request.method;
    case 'status': return flow.response?.statusCode ?? 0;
    case 'graphql':
      return flow.request.graphqlOperationName
        ?? flow.request.graphqlOperationType
        ?? (flow.tags.includes('graphql') ? 'graphql' : '');
    case 'url': return flow.request.path || flow.request.url;
    case 'host': return flow.request.host;
    case 'type': return getFlowContentType(flow);
    case 'size': return flow.response?.bodySize ?? 0;
    case 'time': return flow.response?.duration ?? 0;
  }
}

function sortFlows(flows: HttpFlow[], sort: SortState): HttpFlow[] {
  if (!sort.column) return flows;
  const col = sort.column;
  const dir = sort.direction === 'asc' ? 1 : -1;
  return [...flows].sort((a, b) => {
    const aVal = getSortValue(a, col);
    const bVal = getSortValue(b, col);
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * dir;
    }
    return ((aVal as number) - (bVal as number)) * dir;
  });
}

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  className: string;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'timestamp', label: 'Start', className: 'w-20' },
  { key: 'method', label: 'Method', className: 'w-16' },
  { key: 'status', label: 'Status', className: 'w-12' },
  { key: 'graphql', label: 'GraphQL', className: 'w-32 truncate' },
  { key: 'host', label: 'Host', className: 'w-40 truncate' },
  { key: 'url', label: 'Path', className: 'flex-1 ml-2' },
  { key: 'type', label: 'Type', className: 'w-24 text-right' },
  { key: 'size', label: 'Size', className: 'w-16 text-right' },
  { key: 'time', label: 'Duration', className: 'w-16 text-right' },
];

const DEFAULT_VISIBLE: ColumnKey[] = ['timestamp', 'method', 'status', 'url', 'type', 'size', 'time'];
const STORAGE_KEY = 'proxyboy-visible-columns';

function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const arr = JSON.parse(saved) as ColumnKey[];
      if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set(DEFAULT_VISIBLE);
}

function saveVisibleColumns(columns: Set<ColumnKey>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...columns]));
}

export default function TrafficList({
  flows,
  selectedId,
  onSelect,
  onEditAndResend,
  markedFlowId,
  compareTargetFlowId,
  onMarkForCompare,
  onCompareWithMarked,
  onClearComparison,
}: Props) {
  const trafficRowColorMode = useAppStore((state) => state.trafficRowColorMode);
  const [sort, setSort] = useState<SortState>({ column: null, direction: 'asc' });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close column picker on outside click
  useEffect(() => {
    if (!showColumnPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColumnPicker]);

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 2) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Persist column visibility outside of state updater to avoid sync IO during render
  const columnKey = useMemo(() => [...visibleColumns].sort().join(','), [visibleColumns]);
  useEffect(() => { saveVisibleColumns(visibleColumns); }, [columnKey]);

  const activeColumns = useMemo(
    () => ALL_COLUMNS.filter(c => visibleColumns.has(c.key)),
    [visibleColumns],
  );

  const handleSort = useCallback((column: ColumnKey) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return { column: null, direction: 'asc' };
    });
  }, []);

  const sortedFlows = useMemo(() => sortFlows(flows, sort), [flows, sort]);

  const handleContextMenu = useCallback((e: React.MouseEvent, flow: HttpFlow) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, flow });
  }, []);

  const quickAddCaptureRule = useCallback(async (flow: HttpFlow, type: 'allow-list' | 'block-list') => {
    const api = (window as any).proxyboy;
    if (!api?.rules) {
      window.alert('Capture rule controls are unavailable.');
      return;
    }

    const derivedPattern = getQuickAddRulePattern(flow);
    if (!derivedPattern) {
      window.alert('Could not derive a host pattern from this request.');
      return;
    }

    await useRulesStore.getState().loadRules();
    const existingRule = useRulesStore.getState().rules.find((rule) =>
      rule.type === type &&
      rule.matchCriteria.urlPattern === derivedPattern.urlPattern &&
      rule.matchCriteria.isRegex
    );

    if (!existingRule) {
      await api.rules.create({
        type,
        name: `${type === 'allow-list' ? 'Allow' : 'Block'} ${derivedPattern.hostLabel}`,
        enabled: true,
        matchCriteria: {
          urlPattern: derivedPattern.urlPattern,
          isRegex: true,
        },
      });
    }

    const mode = type === 'allow-list' ? 'allow-list' : 'block-list';
    const modeResult = await api.rules.setCaptureMode(mode);
    if (!modeResult?.success) {
      window.alert(modeResult?.error || 'Failed to switch the capture mode.');
      return;
    }

    await Promise.all([
      useRulesStore.getState().loadRules(),
      useRulesStore.getState().loadCaptureMode(),
    ]);

    window.alert(
      existingRule
        ? `Switched capture mode to ${mode === 'allow-list' ? 'Allow List' : 'Block List'} for ${derivedPattern.hostLabel}.`
        : `Added a ${mode === 'allow-list' ? 'Allow List' : 'Block List'} rule for ${derivedPattern.hostLabel} and switched capture mode.`,
    );
  }, []);

  const buildMenuItems = useCallback((flow: HttpFlow): ContextMenuItem[] => {
    const compareItems: ContextMenuItem[] = [];

    if (flow.response) {
      if (markedFlowId === flow.id || compareTargetFlowId === flow.id) {
        compareItems.push({
          label: 'Clear comparison state',
          icon: '✕',
          onClick: onClearComparison,
        });
      } else {
        compareItems.push({
          label: 'Mark response for compare',
          icon: '🎯',
          onClick: () => onMarkForCompare(flow),
        });
      }

      if (markedFlowId && markedFlowId !== flow.id) {
        compareItems.push({
          label: 'Compare with marked',
          icon: '🔀',
          onClick: () => onCompareWithMarked(flow),
        });
      }
    }

    return [
      ...compareItems,
      {
        label: 'Block this domain',
        icon: '🛑',
        onClick: () => quickAddCaptureRule(flow, 'block-list'),
      },
      {
        label: 'Allow only this domain',
        icon: '✅',
        onClick: () => quickAddCaptureRule(flow, 'allow-list'),
      },
      {
        label: 'Edit and Resend',
        icon: '✍️',
        onClick: () => onEditAndResend(flow),
      },
      {
        label: 'Repeat Request',
        icon: '↻',
        onClick: async () => {
          const result = await window.proxyboy?.traffic.repeat(flow.id);
          if (!result?.success) {
            window.alert(result?.error || 'Failed to replay the request.');
          }
        },
      },
      {
        label: 'Copy as cURL',
        icon: '⌘',
        onClick: () => navigator.clipboard.writeText(flowToCurl(flow)),
      },
      {
        label: 'Copy URL',
        icon: '🔗',
        onClick: () => navigator.clipboard.writeText(flow.request.url),
      },
      {
        label: 'Copy Response Body',
        icon: '📋',
        onClick: () => {
          const body = flow.response?.body;
          const text = typeof body === 'string' ? body : body ? String(body) : '';
          navigator.clipboard.writeText(text);
        },
      },
      {
        label: 'Copy Request Headers',
        icon: '📤',
        onClick: () => navigator.clipboard.writeText(formatHeaders(flow.request.headers)),
      },
      {
        label: 'Copy Response Headers',
        icon: '📥',
        onClick: () => {
          if (flow.response?.headers) {
            navigator.clipboard.writeText(formatHeaders(flow.response.headers));
          }
        },
      },
    ];
  }, [compareTargetFlowId, markedFlowId, onClearComparison, onCompareWithMarked, onEditAndResend, onMarkForCompare, quickAddCaptureRule]);

  if (flows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-pb-text-dim">
        <div className="text-4xl mb-4">📡</div>
        <div className="text-lg font-medium">No traffic captured</div>
        <div className="text-sm mt-1">Start the proxy and make some requests</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-8 px-3 bg-pb-surface border-b border-pb-border text-xs font-medium text-pb-text-dim select-none relative">
        {activeColumns.map(({ key, label, className }) => (
          <span
            key={key}
            className={`${className} cursor-pointer hover:text-pb-text transition-colors`}
            onClick={() => handleSort(key)}
          >
            {label}
            {sort.column === key && (
              <span className="ml-1 text-pb-accent">
                {sort.direction === 'asc' ? '▲' : '▼'}
              </span>
            )}
          </span>
        ))}
        {/* Column picker toggle */}
        <div className="relative ml-1" ref={pickerRef}>
          <button
            onClick={() => setShowColumnPicker(p => !p)}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
              showColumnPicker ? 'text-pb-accent bg-pb-accent/10' : 'text-pb-text-dim hover:text-pb-text'
            }`}
            title="Configure columns"
          >
            ⚙
          </button>
          {showColumnPicker && (
            <div className="absolute right-0 top-6 bg-pb-surface border border-pb-border rounded-lg shadow-xl p-1.5 z-50 min-w-[140px]">
              {ALL_COLUMNS.map(col => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-pb-surface-hover rounded transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="accent-[var(--color-pb-accent)]"
                  />
                  <span className="text-pb-text">{col.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Rows */}
      <Virtuoso
        data={sortedFlows}
        itemContent={(index, flow) => (
          <TrafficRow
            key={flow.id}
            flow={flow}
            selected={flow.id === selectedId}
            onSelect={onSelect}
            onContextMenu={handleContextMenu}
            visibleColumns={visibleColumns}
            colorMode={trafficRowColorMode}
            markedForCompare={flow.id === markedFlowId}
            comparisonTarget={flow.id === compareTargetFlowId}
            columnKey={columnKey}
          />
        )}
        style={{ height: '100%', flex: 1 }}
      />
      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu.flow)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
