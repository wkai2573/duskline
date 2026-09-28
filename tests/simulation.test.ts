import { describe, expect, it } from 'vitest';
import { choosePlan } from '../src/ai/greedy.ts';
import { playMatch, runSeries } from '../src/ai/selfplay.ts';
import { PRESET_DECKS, RULES, newGame, resolveRound, validatePlan } from '../src/engine/index.ts';

describe('AI 對 AI 模擬', () => {
  it('AI 出的佈署永遠合法，而且對局會在回合上限內結束', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = newGame({ seed, decks: [PRESET_DECKS.dawn, PRESET_DECKS.dusk] });
      while (s.winner === null) {
        const plans = [choosePlan(s, 0), choosePlan(s, 1)] as const;
        expect(validatePlan(s, 0, plans[0])).toBeNull();
        expect(validatePlan(s, 1, plans[1])).toBeNull();
        s = resolveRound(s, plans).state;
      }
      expect(s.round).toBeLessThanOrEqual(RULES.maxRounds);
    }
  });

  it('AI 不偷看：對手的手牌不同，AI 的決定也不變', () => {
    const s = newGame({ seed: 3, decks: [PRESET_DECKS.dawn, PRESET_DECKS.dusk] });
    const peeked = structuredClone(s);
    peeked.sides[0].hand = peeked.sides[0].hand.slice(0, 1);
    expect(choosePlan(peeked, 1)).toEqual(choosePlan(s, 1));
  });

  it('同一個種子的對局結果完全相同', () => {
    expect(playMatch(99, ['dawn', 'dusk'])).toEqual(playMatch(99, ['dawn', 'dusk']));
  });

  it('兩個陣營的勝率都在 40%～60% 之間', () => {
    const r = runSeries(300);
    const decided = r.games - r.draws;
    console.log(
      `模擬 ${r.games} 局：晨曦 ${r.wins.dawn} 勝、暮影 ${r.wins.dusk} 勝、平手 ${r.draws}，` +
        `平均 ${r.avgRounds.toFixed(2)} 回合，提前分勝負 ${(r.earlyRate * 100).toFixed(0)}%`,
    );
    expect(r.avgRounds).toBeLessThanOrEqual(RULES.maxRounds);
    expect(r.wins.dawn / decided).toBeGreaterThan(0.4);
    expect(r.wins.dawn / decided).toBeLessThan(0.6);
  });
});
