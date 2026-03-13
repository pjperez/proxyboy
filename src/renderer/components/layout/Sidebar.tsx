import React from 'react';

interface Props {
  selectedView: string;
  onSelectView: (view: any) => void;
  onToggleAgent: () => void;
  showAgent: boolean;
}

const navItems = [
  { id: 'traffic', label: 'Traffic', icon: '📡' },
  { id: 'breakpoints', label: 'Breakpoints', icon: '⏸' },
  { id: 'map-local', label: 'Map Local', icon: '📁' },
];

export default function Sidebar({ selectedView, onSelectView, onToggleAgent, showAgent }: Props) {
  return (
    <div className="w-14 bg-pb-surface flex flex-col items-center py-3 gap-2 border-r border-pb-border">
      {navItems.map(item => (
        <button
          key={item.id}
          onClick={() => onSelectView(item.id)}
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors
            ${selectedView === item.id ? 'bg-pb-accent/20 text-pb-accent' : 'text-pb-text-dim hover:bg-pb-surface-hover hover:text-pb-text'}`}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={onToggleAgent}
        className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors
          ${showAgent ? 'bg-pb-accent/20 text-pb-accent' : 'text-pb-text-dim hover:bg-pb-surface-hover hover:text-pb-text'}`}
        title="AI Agent (Ctrl+Shift+A)"
      >
        🤖
      </button>
    </div>
  );
}
