import React from 'react';
import { SHORTCUT_SECTIONS } from '../../utils/shortcuts';

interface Props {
  onClose: () => void;
}

export default function ShortcutHelpDialog({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-2xl rounded-xl border border-pb-border bg-pb-surface shadow-2xl overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-pb-border px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-pb-text">Keyboard Shortcuts</h2>
            <p className="mt-1 text-xs text-pb-text-dim">
              Quick access to the most common capture and inspection actions.
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close shortcuts (Esc)"
            className="text-lg text-pb-text-dim hover:text-pb-text transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-2">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pb-text-dim">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={`${section.title}-${shortcut.description}`}
                    className="flex items-start justify-between gap-4 rounded-lg border border-pb-border bg-pb-bg/50 px-3 py-2"
                  >
                    <span className="text-xs text-pb-text">{shortcut.description}</span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={`${shortcut.description}-${key}`}
                          className="rounded border border-pb-border bg-pb-surface px-2 py-0.5 text-[11px] font-medium text-pb-accent"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
