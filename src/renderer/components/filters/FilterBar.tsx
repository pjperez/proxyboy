import React, { useState } from 'react';
import FilterChip from './FilterChip';
import { useTrafficStore } from '../../stores/traffic';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
const STATUS_PRESETS = [
  { label: '2xx', min: 200, max: 299 },
  { label: '3xx', min: 300, max: 399 },
  { label: '4xx', min: 400, max: 499 },
  { label: '5xx', min: 500, max: 599 },
];
const CONTENT_TYPE_PRESETS = [
  { label: 'JSON', types: ['application/json'] },
  { label: 'XML', types: ['application/xml', 'text/xml'] },
  { label: 'HTML', types: ['text/html'] },
  { label: 'CSS', types: ['text/css'] },
  { label: 'JS', types: ['javascript'] },
  { label: 'Form', types: ['application/x-www-form-urlencoded', 'multipart/form-data'] },
  { label: 'Image', types: ['image/'] },
  { label: 'Font', types: ['font/', 'application/font', 'woff'] },
  { label: 'Media', types: ['video/', 'audio/'] },
];

export default function FilterBar() {
  const { filter, setFilter } = useTrafficStore();
  const [searchText, setSearchText] = useState('');

  const handleSearch = (text: string) => {
    setSearchText(text);
    setFilter({ ...filter, text: text || undefined });
  };

  const toggleMethod = (method: string) => {
    const current = filter.methods || [];
    const updated = current.includes(method)
      ? current.filter(m => m !== method)
      : [...current, method];
    setFilter({ ...filter, methods: updated.length ? updated : undefined });
  };

  const toggleStatus = (preset: { label: string; min: number; max: number }) => {
    const current = filter.statusCodes || [];
    const exists = current.some(s => s.label === preset.label);
    const updated = exists
      ? current.filter(s => s.label !== preset.label)
      : [...current, preset];
    setFilter({ ...filter, statusCodes: updated.length ? updated : undefined });
  };

  const toggleContentType = (preset: { label: string; types: string[] }) => {
    const current = filter.contentTypes || [];
    // Check if any of this preset's types are active
    const isActive = preset.types.some(t => current.includes(t));
    let updated: string[];
    if (isActive) {
      updated = current.filter(t => !preset.types.includes(t));
    } else {
      updated = [...current, ...preset.types];
    }
    setFilter({ ...filter, contentTypes: updated.length ? updated : undefined });
  };

  const isContentTypeActive = (preset: { types: string[] }) => {
    const current = filter.contentTypes || [];
    return preset.types.some(t => current.includes(t));
  };

  const toggleErrors = () => {
    setFilter({ ...filter, hasError: !filter.hasError });
  };

  const clearFilters = () => {
    setSearchText('');
    setFilter({});
  };

  const hasFilters = searchText || filter.methods?.length || filter.statusCodes?.length || filter.contentTypes?.length || filter.hasError;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-pb-surface border-b border-pb-border overflow-x-auto">
      {/* Search */}
      <div className="relative shrink-0 w-52">
        <input
          type="text"
          value={searchText}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Filter URL... (Ctrl+F)"
          className="w-full h-7 bg-pb-bg border border-pb-border rounded px-3 pr-8 text-xs text-pb-text placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
        />
        {searchText && (
          <button
            onClick={() => handleSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-pb-text-dim hover:text-pb-text text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Method filters */}
      <div className="flex items-center gap-1 shrink-0">
        {METHOD_OPTIONS.slice(0, 4).map(method => (
          <FilterChip
            key={method}
            label={method}
            active={filter.methods?.includes(method) || false}
            onClick={() => toggleMethod(method)}
          />
        ))}
      </div>

      {/* Status filters */}
      <span className="text-pb-border shrink-0">|</span>
      <div className="flex items-center gap-1 shrink-0">
        {STATUS_PRESETS.map(preset => (
          <FilterChip
            key={preset.label}
            label={preset.label}
            active={filter.statusCodes?.some(s => s.label === preset.label) || false}
            onClick={() => toggleStatus(preset)}
          />
        ))}
      </div>

      {/* Content type filters */}
      <span className="text-pb-border shrink-0">|</span>
      <div className="flex items-center gap-1 shrink-0">
        {CONTENT_TYPE_PRESETS.map(preset => (
          <FilterChip
            key={preset.label}
            label={preset.label}
            active={isContentTypeActive(preset)}
            onClick={() => toggleContentType(preset)}
            color="success"
          />
        ))}
      </div>

      {/* Error toggle */}
      <span className="text-pb-border shrink-0">|</span>
      <FilterChip
        label="Errors"
        active={filter.hasError || false}
        onClick={toggleErrors}
        color="error"
      />

      {/* Clear all */}
      {hasFilters && (
        <button
          onClick={clearFilters}
          className="text-xs text-pb-text-dim hover:text-pb-error ml-1 shrink-0"
        >
          Clear
        </button>
      )}
    </div>
  );
}
