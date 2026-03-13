import React from 'react';

interface Props {
  title: string;
  description: string;
  action: () => void;
  icon?: string;
}

export default function AgentSuggestion({ title, description, action, icon = '💡' }: Props) {
  return (
    <button
      onClick={action}
      className="w-full text-left bg-pb-surface hover:bg-pb-surface-hover border border-pb-border hover:border-pb-accent/40 rounded-lg p-3 transition-colors group"
    >
      <div className="flex items-start gap-2">
        <span className="text-sm mt-0.5">{icon}</span>
        <div>
          <div className="text-xs font-medium text-pb-text group-hover:text-pb-accent transition-colors">
            {title}
          </div>
          <div className="text-[10px] text-pb-text-dim mt-0.5">{description}</div>
        </div>
      </div>
    </button>
  );
}
