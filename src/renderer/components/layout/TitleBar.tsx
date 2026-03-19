import React from 'react';

interface Props {
  onOpenShortcuts: () => void;
}

export default function TitleBar({ onOpenShortcuts }: Props) {
  return (
    <div className="drag-region h-9 bg-pb-bg flex items-center justify-between px-4 pr-36 border-b border-pb-border select-none">
      <div className="flex items-center gap-2 no-drag">
        <div className="w-3 h-3 rounded-full bg-pb-accent"></div>
        <span className="text-sm font-semibold text-pb-text">ProxyBoy</span>
      </div>
      <button
        onClick={onOpenShortcuts}
        className="no-drag w-7 h-7 rounded-md text-sm text-pb-text-dim hover:text-pb-text hover:bg-pb-surface transition-colors"
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>
    </div>
  );
}
