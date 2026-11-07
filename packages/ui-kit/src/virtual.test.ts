import { describe, expect, it } from 'vitest';
import { visibleRange } from './virtual';

describe('visibleRange', () => {
  it('renders the first screen plus overscan at the top', () => {
    expect(visibleRange(0, 300, 30, 500, 5)).toEqual({ start: 0, end: 16 });
  });

  it('keeps overscan on both sides in the middle', () => {
    expect(visibleRange(3000, 300, 30, 500, 5)).toEqual({ start: 95, end: 116 });
  });

  it('stops at the last row when scrolled to the bottom', () => {
    expect(visibleRange(500 * 30 - 300, 300, 30, 500, 5)).toEqual({ start: 485, end: 500 });
  });

  it('clamps a scroll position past the end, as after the list shrinks', () => {
    const r = visibleRange(30_000, 300, 30, 10, 3);
    expect(r.end).toBe(10);
    expect(r.start).toBeLessThan(r.end);
  });

  it('returns nothing for an empty list', () => {
    expect(visibleRange(0, 300, 30, 0, 5)).toEqual({ start: 0, end: 0 });
  });
});
