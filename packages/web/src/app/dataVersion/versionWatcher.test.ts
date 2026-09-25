import { describe, expect, it } from 'vitest';
import { createVersionWatcher } from './versionWatcher';

describe('createVersionWatcher', () => {
  it('1回目は基準にするだけ、2回目以降に違う値が来たら変わったとする', () => {
    const watcher = createVersionWatcher();
    expect(watcher.observe('3')).toBe('baseline');
    expect(watcher.observe('3')).toBe('unchanged');
    expect(watcher.observe('4')).toBe('changed');
    expect(watcher.observe('4')).toBe('unchanged');
  });

  it('空の値は無視する', () => {
    const watcher = createVersionWatcher();
    expect(watcher.observe('')).toBe('unchanged');
    expect(watcher.observe('1')).toBe('baseline');
  });
});
