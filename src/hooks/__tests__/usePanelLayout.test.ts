// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { focusGuardedStorage } from '../usePanelLayout';

describe('focusGuardedStorage', () => {
  beforeEach(() => localStorage.clear());

  it('drops writes while blocked (focus mode) and passes them through otherwise', () => {
    let blocked = true;
    const s = focusGuardedStorage(() => blocked);
    s.setItem('layout', '{"thumb":0,"editor":100,"inspector":0}');
    expect(localStorage.getItem('layout')).toBeNull();
    blocked = false;
    s.setItem('layout', '{"thumb":20,"editor":60,"inspector":20}');
    expect(localStorage.getItem('layout')).toBe('{"thumb":20,"editor":60,"inspector":20}');
  });

  it('discards a saved layout with a collapsed (size 0) panel', () => {
    localStorage.setItem('layout', '{"thumb":0,"editor":86,"inspector":14}');
    const s = focusGuardedStorage(() => false);
    expect(s.getItem('layout')).toBeNull();
    expect(localStorage.getItem('layout')).toBeNull();
  });

  it('returns healthy and non-JSON values unchanged', () => {
    localStorage.setItem('ok', '{"thumb":22,"editor":64,"inspector":14}');
    localStorage.setItem('raw', 'not json');
    const s = focusGuardedStorage(() => false);
    expect(s.getItem('ok')).toBe('{"thumb":22,"editor":64,"inspector":14}');
    expect(s.getItem('raw')).toBe('not json');
  });
});
