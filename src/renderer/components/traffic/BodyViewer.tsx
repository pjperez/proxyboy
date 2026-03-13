import React, { useMemo } from 'react';

interface Props {
  body: string;
  contentType: string;
}

export default function BodyViewer({ body, contentType }: Props) {
  const formatted = useMemo(() => {
    if (contentType.includes('json')) {
      try {
        return JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        return body;
      }
    }
    return body;
  }, [body, contentType]);

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
