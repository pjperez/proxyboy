import React, { useMemo } from 'react';

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

export default function BodyViewer({ body, contentType, isBase64 }: Props) {
  const isImage = contentType.startsWith('image/');

  const formatted = useMemo(() => {
    if (isImage) return body;
    if (contentType.includes('json')) {
      try {
        return JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        return body;
      }
    }
    return body;
  }, [body, contentType, isImage]);

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
      <pre className={`p-3 text-xs font-mono whitespace-pre-wrap break-all
        ${isJson ? 'text-pb-info' : isHtml || isXml ? 'text-pb-warning' : 'text-pb-text'}`}
      >
        {formatted}
      </pre>
    </div>
  );
}
