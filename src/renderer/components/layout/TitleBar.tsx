import React from 'react';

export default function TitleBar() {
  return (
    <div className="drag-region h-9 bg-pb-bg flex items-center px-4 border-b border-pb-border select-none">
      <div className="flex items-center gap-2 no-drag">
        <div className="w-3 h-3 rounded-full bg-pb-accent"></div>
        <span className="text-sm font-semibold text-pb-text">ProxyBoy</span>
      </div>
      <div className="flex-1"></div>
      <div className="no-drag text-xs text-pb-text-dim">
        HTTP/HTTPS Debugging Proxy
      </div>
    </div>
  );
}
