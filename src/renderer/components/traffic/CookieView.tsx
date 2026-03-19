import React, { useMemo, useState } from 'react';
import type { HttpFlow } from '../../../shared/types';
import {
  parseRequestCookies,
  parseResponseCookies,
  type ParsedRequestCookie,
  type ParsedResponseCookie,
} from '../../utils/cookies';

interface Props {
  flow: HttpFlow;
}

function matchesSearch(value: string | undefined, query: string): boolean {
  return value?.toLowerCase().includes(query) ?? false;
}

function matchesRequestCookie(cookie: ParsedRequestCookie, query: string): boolean {
  return (
    matchesSearch(cookie.name, query) ||
    matchesSearch(cookie.value, query) ||
    matchesSearch(cookie.raw, query)
  );
}

function matchesResponseCookie(cookie: ParsedResponseCookie, query: string): boolean {
  return (
    matchesSearch(cookie.name, query) ||
    matchesSearch(cookie.value, query) ||
    matchesSearch(cookie.domain, query) ||
    matchesSearch(cookie.path, query) ||
    matchesSearch(cookie.expires, query) ||
    matchesSearch(cookie.maxAge, query) ||
    matchesSearch(cookie.sameSite, query) ||
    matchesSearch(cookie.raw, query)
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-pb-border px-3 py-5 text-xs text-pb-text-dim">
      {message}
    </div>
  );
}

export default function CookieView({ flow }: Props) {
  const [searchText, setSearchText] = useState('');

  const requestCookies = useMemo(
    () => parseRequestCookies(flow.request.headers).sort((a, b) => a.name.localeCompare(b.name)),
    [flow.request.headers],
  );
  const responseCookies = useMemo(
    () => parseResponseCookies(flow.response?.headers || {}).sort((a, b) => a.name.localeCompare(b.name)),
    [flow.response?.headers],
  );

  const query = searchText.trim().toLowerCase();
  const filteredRequestCookies = useMemo(
    () => (query ? requestCookies.filter((cookie) => matchesRequestCookie(cookie, query)) : requestCookies),
    [query, requestCookies],
  );
  const filteredResponseCookies = useMemo(
    () => (query ? responseCookies.filter((cookie) => matchesResponseCookie(cookie, query)) : responseCookies),
    [query, responseCookies],
  );

  const totalCookieCount = requestCookies.length + responseCookies.length;
  const visibleCookieCount = filteredRequestCookies.length + filteredResponseCookies.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Filter cookies by name, value, domain, or path"
            className="w-full h-8 bg-pb-surface border border-pb-border rounded px-3 pr-8 text-xs text-pb-text placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-pb-text-dim hover:text-pb-text text-xs"
            >
              ✕
            </button>
          )}
        </div>
        <div className="text-xs text-pb-text-dim">
          {visibleCookieCount} of {totalCookieCount} cookies
        </div>
      </div>

      <section className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold text-pb-text-dim uppercase">Request Cookies</h3>
          <p className="text-[11px] text-pb-text-dim mt-1">
            Parsed from the outgoing <span className="font-mono text-pb-text">Cookie</span> header.
          </p>
        </div>

        {requestCookies.length === 0 ? (
          <EmptyState message="This request did not send any cookies." />
        ) : filteredRequestCookies.length === 0 ? (
          <EmptyState message="No request cookies match the current filter." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-pb-border bg-pb-surface">
            <table className="min-w-full text-xs">
              <thead className="bg-pb-bg/70 text-pb-text-dim">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequestCookies.map((cookie) => (
                  <tr key={`request-${cookie.name}-${cookie.raw}`} className="border-t border-pb-border">
                    <td className="px-3 py-2 font-mono text-pb-accent whitespace-nowrap">{cookie.name}</td>
                    <td className="px-3 py-2 font-mono text-pb-text break-all">{cookie.value || '(empty)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold text-pb-text-dim uppercase">Response Cookies</h3>
          <p className="text-[11px] text-pb-text-dim mt-1">
            Parsed from the incoming <span className="font-mono text-pb-text">Set-Cookie</span> headers.
          </p>
        </div>

        {responseCookies.length === 0 ? (
          <EmptyState message="This response did not set any cookies." />
        ) : filteredResponseCookies.length === 0 ? (
          <EmptyState message="No response cookies match the current filter." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-pb-border bg-pb-surface">
            <table className="min-w-full text-xs">
              <thead className="bg-pb-bg/70 text-pb-text-dim">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Value</th>
                  <th className="px-3 py-2 text-left font-medium">Domain</th>
                  <th className="px-3 py-2 text-left font-medium">Path</th>
                  <th className="px-3 py-2 text-left font-medium">Expires / Max-Age</th>
                  <th className="px-3 py-2 text-left font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filteredResponseCookies.map((cookie) => (
                  <tr key={`response-${cookie.name}-${cookie.raw}`} className="border-t border-pb-border">
                    <td className="px-3 py-2 font-mono text-pb-accent whitespace-nowrap">{cookie.name}</td>
                    <td className="px-3 py-2 font-mono text-pb-text break-all">{cookie.value || '(empty)'}</td>
                    <td className="px-3 py-2 text-pb-text break-all">{cookie.domain || '—'}</td>
                    <td className="px-3 py-2 text-pb-text break-all">{cookie.path || '—'}</td>
                    <td className="px-3 py-2 text-pb-text break-all">
                      {cookie.expires || cookie.maxAge
                        ? [cookie.expires, cookie.maxAge ? `Max-Age=${cookie.maxAge}` : null].filter(Boolean).join(' • ')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-pb-text break-all">
                      {[cookie.sameSite ? `SameSite=${cookie.sameSite}` : null, cookie.secure ? 'Secure' : null, cookie.httpOnly ? 'HttpOnly' : null]
                        .filter(Boolean)
                        .join(' • ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
