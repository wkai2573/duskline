import { describe, expect, it } from 'vitest';
import { CARDS, PLAYABLE_FACTIONS, cardsOf, type CardDef } from '../src/engine/index.ts';

/** 卡面上最強的那一面：最高攻擊力＋生命 */
const peak = (d: CardDef) => Math.max(d.dayAtk ?? 0, d.nightAtk ?? 0) + (d.hp ?? 0);

const units = Object.values(CARDS).filter((d) => d.type === 'unit' && d.faction !== 'token');

describe('卡面數值要平衡', () => {
  it('同費用的單位，最高攻擊力＋生命相差不超過 3（跨陣營）', () => {
    for (const cost of [...new Set(units.map((d) => d.cost))]) {
      const group = units.filter((d) => d.cost === cost);
      const values = group.map(peak);
      const spread = Math.max(...values) - Math.min(...values);
      const detail = group.map((d) => `${d.name} ${peak(d)}`).join('、');
      expect(spread, `${cost} 費：${detail}`).toBeLessThanOrEqual(3);
    }
  });

  it('單位不能只有攻擊或只有生命：最高攻擊力和生命相差不超過 4', () => {
    for (const d of units) expect(Math.abs(Math.max(d.dayAtk!, d.nightAtk!) - d.hp!), d.name).toBeLessThanOrEqual(4);
  });

  it('每個陣營都剛好有 10 種卡', () => {
    for (const f of PLAYABLE_FACTIONS) expect(cardsOf(f), f).toHaveLength(10);
  });

  it('星軌學會的單位不受晝夜影響', () => {
    for (const d of cardsOf('orbit').filter((c) => c.type === 'unit')) expect(d.dayAtk, d.name).toBe(d.nightAtk);
  });
});
