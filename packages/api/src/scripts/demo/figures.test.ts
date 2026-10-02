import { normalizeCustomerSnapshot } from '@katahimo/core/usecases';
import { describe, expect, it } from 'vitest';
import { birthDateFromAgeMonths, DEMO_FIGURES, figureToCustomerSnapshot } from './figures';

describe('DEMO_FIGURES', () => {
  it('20世帯、externalId が重複なく PD-XXXX の形', () => {
    expect(DEMO_FIGURES).toHaveLength(20);
    const ids = DEMO_FIGURES.map((f) => f.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^PD-\d{4}$/);
  });

  it('全世帯が最低1人の子どもを持つ', () => {
    for (const figure of DEMO_FIGURES) expect(figure.children.length).toBeGreaterThan(0);
  });
});

describe('birthDateFromAgeMonths', () => {
  it('今日から ageMonths か月前の1日になる', () => {
    const today = new Date('2026-09-28T00:00:00Z');
    expect(birthDateFromAgeMonths(today, 12)).toBe('2025-09-01');
    expect(birthDateFromAgeMonths(today, 0)).toBe('2026-09-01');
  });
});

describe('figureToCustomerSnapshot', () => {
  it('normalizeCustomerSnapshot を通る有効な CustomerSnapshot になる', () => {
    const today = new Date('2026-09-28T00:00:00Z');
    for (const figure of DEMO_FIGURES) {
      const snapshot = figureToCustomerSnapshot(figure, today);
      const { snapshot: normalized, issues } = normalizeCustomerSnapshot(snapshot);
      expect(issues).toEqual([]);
      expect(normalized).not.toBeNull();
      expect(normalized?.recipients).toHaveLength(figure.children.length);
    }
  });

  it('緯度経度を latLng の "lat,lng" 表記で持つ', () => {
    const today = new Date('2026-09-28T00:00:00Z');
    const figure = DEMO_FIGURES[0];
    if (!figure) throw new Error('unreachable');
    const snapshot = figureToCustomerSnapshot(figure, today);
    expect(snapshot.home?.latLng).toBe(`${figure.lat},${figure.lng}`);
  });
});
