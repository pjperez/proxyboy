import React, { useMemo, useState } from 'react';

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

function base64Decode(b64: string): string | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Try gzip
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const { ungzip } = require('pako') as typeof import('pako');
      return ungzip(bytes, { to: 'string' });
    }
    // Try deflate
    if (bytes[0] === 0x78) {
      const { inflate } = require('pako') as typeof import('pako');
      return inflate(bytes, { to: 'string' });
    }
    // Not compressed — try decoding as UTF-8
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export default function BodyViewer({ body, contentType, isBase64 }: Props) {
  const isImage = contentType.startsWith('image/');
  const [showDecoded, setShowDecoded] = useState(true);

  // For base64 non-image bodies, attempt to decode/decompress
  const decoded = useMemo(() => {
    if (!isBase64 || isImage || !showDecoded) return null;
    return base64Decode(body);
  }, [body, isBase64, isImage, showDecoded]);

  const displayBody = (isBase64 && !isImage) ? (decoded ?? `[Binary data, ${formatSize(body.length * 0.75)} estimated]`) : body;

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
      {isBase64 && !isImage && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-pb-border bg-pb-surface">
          <span className="text-[10px] text-pb-text-dim">
            {decoded ? '✓ Decoded' : '⚠ Binary'}
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
