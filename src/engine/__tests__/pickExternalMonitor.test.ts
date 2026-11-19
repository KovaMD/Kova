import { describe, it, expect } from 'vitest';
import { pickExternalMonitor, type MonitorLike } from '../pickExternalMonitor';

const mon = (name: string | null, x: number, y: number): MonitorLike => ({ name, position: { x, y } });

describe('pickExternalMonitor', () => {
  it('returns null with no monitors', () => {
    expect(pickExternalMonitor([], null)).toBeNull();
  });

  it('returns null with a single monitor, current known or not', () => {
    const only = mon('eDP-1', 0, 0);
    expect(pickExternalMonitor([only], only)).toBeNull();
    expect(pickExternalMonitor([only], null)).toBeNull();
  });

  describe('with a current monitor (macOS, Windows, X11)', () => {
    it('picks the first monitor whose name differs from the current one', () => {
      const laptop = mon('eDP-1', 0, 0);
      const hdmi = mon('HDMI-1', 1920, 0);
      const dp = mon('DP-1', 3840, 0);
      expect(pickExternalMonitor([laptop, hdmi, dp], laptop)).toBe(hdmi);
      expect(pickExternalMonitor([hdmi, laptop, dp], hdmi)).toBe(laptop);
    });

    it('matches by name, not position: an external left of the origin still wins', () => {
      const laptop = mon('eDP-1', 0, 0);
      const left = mon('HDMI-1', -1920, 0);
      expect(pickExternalMonitor([laptop, left], laptop)).toBe(left);
    });

    it('returns null when every monitor shares the current name', () => {
      const a = mon('Generic', 0, 0);
      const b = mon('Generic', 1920, 0);
      expect(pickExternalMonitor([a, b], a)).toBeNull();
    });

    it('treats null names as a name (null !== "x" picks it)', () => {
      const laptop = mon('eDP-1', 0, 0);
      const unnamed = mon(null, 1920, 0);
      expect(pickExternalMonitor([laptop, unnamed], laptop)).toBe(unnamed);
    });
  });

  describe('Wayland: current monitor is null', () => {
    it('picks the monitor to the right of the origin', () => {
      const left = mon(null, 0, 0);
      const right = mon(null, 2560, 0);
      expect(pickExternalMonitor([left, right], null)).toBe(right);
      expect(pickExternalMonitor([right, left], null)).toBe(right);
    });

    it('picks the monitor below the origin', () => {
      const top = mon(null, 0, 0);
      const below = mon(null, 0, 1440);
      expect(pickExternalMonitor([top, below], null)).toBe(below);
    });

    it('picks the origin furthest from (0, 0) by x + y among three', () => {
      const a = mon('a', 0, 0);
      const b = mon('b', 1920, 0);
      const c = mon('c', 1920, 1080);
      expect(pickExternalMonitor([c, a, b], null)).toBe(c);
    });

    it('keeps the earlier monitor on a tie', () => {
      const a = mon('a', 1920, 0);
      const b = mon('b', 0, 1920);
      expect(pickExternalMonitor([a, b], null)).toBe(a);
      expect(pickExternalMonitor([b, a], null)).toBe(b);
    });

    it('a monitor left of the origin loses to the one at the origin', () => {
      const left = mon('left', -1920, 0);
      const main = mon('main', 0, 0);
      expect(pickExternalMonitor([left, main], null)).toBe(main);
    });
  });
});
