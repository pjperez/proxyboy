export interface ShortcutDefinition {
  keys: string[];
  description: string;
}

export interface ShortcutSection {
  title: string;
  shortcuts: ShortcutDefinition[];
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'App',
    shortcuts: [
      { keys: ['Ctrl', 'E'], description: 'Start or stop recording' },
      { keys: ['Ctrl', 'Shift', 'A'], description: 'Toggle the AI panel' },
      { keys: ['Ctrl', 'I'], description: 'Import a HAR file' },
      { keys: ['Ctrl', 'S'], description: 'Export captured traffic as HAR' },
      { keys: ['?'], description: 'Open this shortcuts reference' },
    ],
  },
  {
    title: 'Traffic',
    shortcuts: [
      { keys: ['Ctrl', 'F'], description: 'Focus the traffic filter' },
      { keys: ['Ctrl', 'D'], description: 'Open or close the selected request detail' },
      { keys: ['Ctrl', 'Shift', 'C'], description: 'Copy the selected request as cURL' },
      { keys: ['Ctrl', 'Shift', 'M'], description: 'Mark the selected response for comparison' },
      { keys: ['Ctrl', 'Shift', 'V'], description: 'Compare the selected response with the marked one' },
      { keys: ['Delete'], description: 'Remove the selected completed request' },
      { keys: ['Ctrl', 'K'], description: 'Clear all captured traffic' },
      { keys: ['Arrow Up'], description: 'Select the previous request' },
      { keys: ['Arrow Down'], description: 'Select the next request' },
      { keys: ['Escape'], description: 'Close the shortcuts dialog, detail panel, or inline AI panel' },
    ],
  },
];

export function getNextSelectedFlowIdAfterDelete(flowIds: string[], selectedFlowId: string): string | null {
  const currentIndex = flowIds.indexOf(selectedFlowId);
  if (currentIndex === -1) {
    return null;
  }

  if (flowIds.length === 1) {
    return null;
  }

  return flowIds[currentIndex + 1] ?? flowIds[currentIndex - 1] ?? null;
}
