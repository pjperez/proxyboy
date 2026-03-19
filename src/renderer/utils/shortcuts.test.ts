import { describe, expect, it } from 'vitest';
import { SHORTCUT_SECTIONS, getNextSelectedFlowIdAfterDelete } from './shortcuts';

describe('SHORTCUT_SECTIONS', () => {
  it('documents the primary keyboard shortcuts exposed by the app', () => {
    const shortcuts = SHORTCUT_SECTIONS.flatMap((section) =>
      section.shortcuts.map((shortcut) => shortcut.keys.join('+')),
    );

    expect(shortcuts).toEqual(expect.arrayContaining([
      'Ctrl+E',
      'Ctrl+Shift+A',
      'Ctrl+Shift+C',
      'Ctrl+D',
      'Ctrl+F',
      'Ctrl+I',
      'Ctrl+K',
      'Ctrl+S',
      'Delete',
      'Escape',
      '?',
    ]));
  });
});

describe('getNextSelectedFlowIdAfterDelete', () => {
  it('selects the next flow when one exists', () => {
    expect(getNextSelectedFlowIdAfterDelete(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('falls back to the previous flow when deleting the last entry', () => {
    expect(getNextSelectedFlowIdAfterDelete(['a', 'b', 'c'], 'c')).toBe('b');
  });

  it('clears selection when deleting the only flow', () => {
    expect(getNextSelectedFlowIdAfterDelete(['a'], 'a')).toBeNull();
  });
});
