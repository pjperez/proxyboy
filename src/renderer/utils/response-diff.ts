import type { HttpResponse } from '../../shared/types';

export type DiffLineState = 'same' | 'added' | 'removed' | 'changed';

export interface DiffLineRow {
  leftLineNumber?: number;
  rightLineNumber?: number;
  leftText: string;
  rightText: string;
  state: DiffLineState;
}

const MAX_LCS_LINES = 250;
const MAX_FALLBACK_LINES = 400;

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }

  return text.replace(/\r\n/g, '\n').split('\n');
}

function fallbackIndexedDiff(leftLines: string[], rightLines: string[]): DiffLineRow[] {
  const maxLength = Math.min(Math.max(leftLines.length, rightLines.length), MAX_FALLBACK_LINES);
  const rows: DiffLineRow[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const leftText = leftLines[index] ?? '';
    const rightText = rightLines[index] ?? '';
    const hasLeft = index < leftLines.length;
    const hasRight = index < rightLines.length;

    let state: DiffLineState = 'same';
    if (hasLeft && !hasRight) {
      state = 'removed';
    } else if (!hasLeft && hasRight) {
      state = 'added';
    } else if (leftText !== rightText) {
      state = 'changed';
    }

    rows.push({
      leftLineNumber: hasLeft ? index + 1 : undefined,
      rightLineNumber: hasRight ? index + 1 : undefined,
      leftText,
      rightText,
      state,
    });
  }

  if (Math.max(leftLines.length, rightLines.length) > MAX_FALLBACK_LINES) {
    rows.push({
      leftText: '… diff truncated for very large bodies …',
      rightText: '… diff truncated for very large bodies …',
      state: 'changed',
    });
  }

  return rows;
}

export function formatResponseBodyForDiff(response?: HttpResponse): string {
  if (!response?.body) {
    return '';
  }

  const body = typeof response.body === 'string' ? response.body : String(response.body);
  const contentType = String(response.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  return body;
}

export function buildDiffLineRows(leftText: string, rightText: string): DiffLineRow[] {
  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);

  if (leftLines.length > MAX_LCS_LINES || rightLines.length > MAX_LCS_LINES) {
    return fallbackIndexedDiff(leftLines, rightLines);
  }

  const dp: number[][] = Array.from({ length: leftLines.length + 1 }, () =>
    Array.from({ length: rightLines.length + 1 }, () => 0),
  );

  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (leftLines[leftIndex] === rightLines[rightIndex]) {
        dp[leftIndex][rightIndex] = dp[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        dp[leftIndex][rightIndex] = Math.max(dp[leftIndex + 1][rightIndex], dp[leftIndex][rightIndex + 1]);
      }
    }
  }

  type Op =
    | { type: 'same'; leftText: string; rightText: string }
    | { type: 'removed'; leftText: string }
    | { type: 'added'; rightText: string };

  const ops: Op[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
    if (leftLines[leftIndex] === rightLines[rightIndex]) {
      ops.push({ type: 'same', leftText: leftLines[leftIndex], rightText: rightLines[rightIndex] });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (dp[leftIndex + 1][rightIndex] >= dp[leftIndex][rightIndex + 1]) {
      ops.push({ type: 'removed', leftText: leftLines[leftIndex] });
      leftIndex += 1;
    } else {
      ops.push({ type: 'added', rightText: rightLines[rightIndex] });
      rightIndex += 1;
    }
  }

  while (leftIndex < leftLines.length) {
    ops.push({ type: 'removed', leftText: leftLines[leftIndex] });
    leftIndex += 1;
  }

  while (rightIndex < rightLines.length) {
    ops.push({ type: 'added', rightText: rightLines[rightIndex] });
    rightIndex += 1;
  }

  const rows: DiffLineRow[] = [];
  let leftLineNumber = 1;
  let rightLineNumber = 1;
  let opIndex = 0;

  while (opIndex < ops.length) {
    const op = ops[opIndex];
    if (op.type === 'same') {
      rows.push({
        leftLineNumber,
        rightLineNumber,
        leftText: op.leftText,
        rightText: op.rightText,
        state: 'same',
      });
      leftLineNumber += 1;
      rightLineNumber += 1;
      opIndex += 1;
      continue;
    }

    const removedLines: string[] = [];
    const addedLines: string[] = [];

    while (opIndex < ops.length && ops[opIndex].type !== 'same') {
      const pendingOp = ops[opIndex];
      if (pendingOp.type === 'removed') {
        removedLines.push(pendingOp.leftText);
      } else {
        addedLines.push(pendingOp.rightText);
      }
      opIndex += 1;
    }

    const changedCount = Math.min(removedLines.length, addedLines.length);
    for (let index = 0; index < changedCount; index += 1) {
      rows.push({
        leftLineNumber,
        rightLineNumber,
        leftText: removedLines[index],
        rightText: addedLines[index],
        state: 'changed',
      });
      leftLineNumber += 1;
      rightLineNumber += 1;
    }

    for (let index = changedCount; index < removedLines.length; index += 1) {
      rows.push({
        leftLineNumber,
        leftText: removedLines[index],
        rightText: '',
        state: 'removed',
      });
      leftLineNumber += 1;
    }

    for (let index = changedCount; index < addedLines.length; index += 1) {
      rows.push({
        rightLineNumber,
        leftText: '',
        rightText: addedLines[index],
        state: 'added',
      });
      rightLineNumber += 1;
    }
  }

  return rows;
}
