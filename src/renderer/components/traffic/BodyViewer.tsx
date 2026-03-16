import React, { useMemo, useState } from 'react';
import pako from 'pako';

interface Props {
  body: string;
  contentType: string;
  isBase64?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function looksCompressed(str: string): boolean {
  // Check for common garbled gzip/deflate patterns (non-printable chars in first 20 bytes)
  const sample = str.slice(0, 40);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) nonPrintable++;
    if (c > 126 && c < 160) nonPrintable++;
  }
  return nonPrintable > sample.length * 0.3;
}

function tryDecompress(str: string): string | null {
  try {
    // Convert the garbled UTF-8 string back to bytes
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }
    // Try gzip first
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      return pako.ungzip(bytes, { to: 'string' });
    }
    // Try inflate (raw deflate or zlib)
    try {
      return pako.inflate(bytes, { to: 'string' });
    } catch {
      return pako.inflateRaw(bytes, { to: 'string' });
    }
  } catch {
    return null;
  }
}

export default function BodyViewer({ body, contentType, isBase64 }: Props) {
  const isImage = contentType.startsWith('image/');
  const compressed = useMemo(() => !isImage && looksCompressed(body), [body, isImage]);
  const [showDecoded, setShowDecoded] = useState(true);

  const decoded = useMemo(() => {
    if (!compressed || !showDecoded) return null;
    return tryDecompress(body);
  }, [body, compressed, showDecoded]);

  const displayBody = decoded ?? body;

  const formatted = useMemo(() => {
    if (isImage) return displayBody;
    if (contentType.includes('json')) {
      try {
        return JSON.stringify(JSON.parse(displayBody), null, 2);
      } catch {
        return displayBody;
      }
    }
    return displayBody;
  }, [displayBody, contentType, isImage]);

  if (isImage && isBase64) {
    const dataUrl = `data:${contentType};base64,${body}`;
    return (
      <div className="flex flex-col items-center gap-3 p-4">
        <div
          className="rounded border border-pb-border p-2"
          style={{
            backgroundImage:
              'linear-gradient(45deg, #2a2b3d 25%, transparent 25%, transparent 75%, #2a2b3d 75%), linear-gradient(45deg, #2a2b3d 25%, transparent 25%, transparent 75%, #2a2b3d 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 8px 8px',
          }}
        >
          <img
            src={dataUrl}
            className="max-w-full max-h-96 object-contain"
            alt="Response image"
          />
        </div>
        <div className="text-xs text-pb-text-dim">
          {contentType} • {formatSize(body.length)} (base64)
        </div>
      </div>
    );
  }

  const isJson = contentType.includes('json');
  const isHtml = contentType.includes('html');
  const isXml = contentType.includes('xml');

  return (
    <div className="bg-pb-bg rounded border border-pb-border overflow-auto max-h-96">
      {compressed && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-pb-border bg-pb-surface">
          <span className="text-[10px] text-pb-text-dim">
            {decoded ? '✓ Decoded' : '⚠ Compressed'}
          </span>
          <button
            onClick={() => setShowDecoded(!showDecoded)}
            className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
              showDecoded
                ? 'bg-pb-accent text-white'
                : 'bg-pb-border text-pb-text-dim hover:text-pb-text'
            }`}
          >
            {showDecoded ? 'Raw' : 'Decode'}
          </button>
        </div>
      )}
      <pre className={`p-3 text-xs font-mono whitespace-pre-wrap break-all
        ${isJson ? 'text-pb-info' : isHtml || isXml ? 'text-pb-warning' : 'text-pb-text'}`}
      >
        {formatted}
      </pre>
    </div>
  );
}
