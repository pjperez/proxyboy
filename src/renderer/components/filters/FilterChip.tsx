import React from 'react';

interface Props {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: 'default' | 'error' | 'success';
}

export default function FilterChip({ label, active, onClick, color = 'default' }: Props) {
  const colorClasses = {
    default: active ? 'bg-pb-accent/20 text-pb-accent border-pb-accent/40' : 'text-pb-text-dim border-pb-border',
    error: active ? 'bg-pb-error/20 text-pb-error border-pb-error/40' : 'text-pb-text-dim border-pb-border',
    success: active ? 'bg-pb-success/20 text-pb-success border-pb-success/40' : 'text-pb-text-dim border-pb-border',
  };

  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors hover:bg-pb-surface-hover ${colorClasses[color]}`}
    >
      {label}
    </button>
  );
}
