import { describe, expect, it } from 'vitest';
import { buildDiffLineRows, formatResponseBodyForDiff } from './response-diff';

describe('formatResponseBodyForDiff', () => {
  it('pretty-prints JSON response bodies for easier comparison', () => {
    expect(
      formatResponseBodyForDiff({
        id: 'res-1',
        requestId: 'req-1',
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"hello":"world"}',
        bodySize: 17,
        timestamp: 1,
        duration: 10,
      }),
    ).toContain('\n  "hello": "world"\n');
  });
});

describe('buildDiffLineRows', () => {
  it('marks identical lines as same', () => {
    expect(buildDiffLineRows('same', 'same')).toEqual([
      {
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: 'same',
        rightText: 'same',
        state: 'same',
      },
    ]);
  });

  it('pairs adjacent removals and additions as changed lines', () => {
    expect(buildDiffLineRows('alpha\nold', 'alpha\nnew')).toEqual([
      {
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: 'alpha',
        rightText: 'alpha',
        state: 'same',
      },
      {
        leftLineNumber: 2,
        rightLineNumber: 2,
        leftText: 'old',
        rightText: 'new',
        state: 'changed',
      },
    ]);
  });

  it('keeps insertions and deletions aligned when one side is missing lines', () => {
    expect(buildDiffLineRows('alpha', 'alpha\nbeta')).toEqual([
      {
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftText: 'alpha',
        rightText: 'alpha',
        state: 'same',
      },
      {
        rightLineNumber: 2,
        leftText: '',
        rightText: 'beta',
        state: 'added',
      },
    ]);
  });
});
