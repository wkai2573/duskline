import { describe, expect, it } from 'vitest';
import {
  PRESET_DECKS,
  RULES,
  checkWinner,
  newGame,
  resolveRound,
  validateDeck,
  validatePlan,
} from '../src/engine/index.ts';
import { NO_PLAN, emptyBoard, giveCard, putUnit } from './helpers.ts';

describe('佈署驗證', () => {
  it('魔力不足時拒絕', () => {
    const s = emptyBoard({ round: 2 });
    const knight = giveCard(s, 0, 'knight');
    expect(validatePlan(s, 0, { plays: [{ uid: knight, lane: 0 }] })).toMatch('魔力不足');
  });

  it('焚卷一張手牌可以多 1 點魔力', () => {
    const s = emptyBoard({ round: 3 });
    const knight = giveCard(s, 0, 'knight');
    const squire = giveCard(s, 0, 'squire');
    expect(validatePlan(s, 0, { plays: [{ uid: knight, lane: 0 }], burn: squire })).toBeNull();
  });

  it('同一張卡不能又出又焚', () => {
    const s = emptyBoard();
    const squire = giveCard(s, 0, 'squire');
    expect(validatePlan(s, 0, { plays: [{ uid: squire, lane: 0 }], burn: squire })).not.toBeNull();
  });

  it('戰線滿了不能再放單位（包含同一次佈署放進去的）', () => {
    const s = emptyBoard();
    putUnit(s, 0, 0, 'squire');
    putUnit(s, 0, 0, 'squire');
    const a = giveCard(s, 0, 'squire');
    const b = giveCard(s, 0, 'squire');
    expect(validatePlan(s, 0, { plays: [{ uid: a, lane: 0 }] })).toBeNull();
    expect(validatePlan(s, 0, { plays: [{ uid: a, lane: 0 }, { uid: b, lane: 0 }] })).toMatch('已經滿了');
  });

  it('單位和指定路線的法術要選一路，全場法術不用', () => {
    const s = emptyBoard();
    const squire = giveCard(s, 0, 'squire');
    const judgment = giveCard(s, 0, 'judgment');
    const daybreak = giveCard(s, 0, 'daybreak');
    expect(validatePlan(s, 0, { plays: [{ uid: squire }] })).toMatch('需要指定一路');
    expect(validatePlan(s, 0, { plays: [{ uid: judgment }] })).toMatch('需要指定一路');
    expect(validatePlan(s, 0, { plays: [{ uid: daybreak }] })).toBeNull();
  });

  it('不合法的佈署會讓 resolveRound 丟出錯誤', () => {
    const s = emptyBoard({ round: 1 });
    const knight = giveCard(s, 0, 'knight');
    expect(() => resolveRound(s, [{ plays: [{ uid: knight, lane: 0 }] }, NO_PLAN])).toThrow('魔力不足');
  });
});

describe('純函式與可重現', () => {
  it('resolveRound 不會修改傳進去的 state', () => {
    const s = emptyBoard({ phase: 'day' });
    putUnit(s, 0, 0, 'knight');
    putUnit(s, 1, 0, 'werewolf');
    const before = JSON.stringify(s);
    resolveRound(s, [NO_PLAN, NO_PLAN]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('同一個種子得到同樣的開局，不同種子通常不同', () => {
    const decks = [PRESET_DECKS.dawn, PRESET_DECKS.dusk] as const;
    expect(newGame({ seed: 7, decks })).toEqual(newGame({ seed: 7, decks }));
    expect(newGame({ seed: 7, decks })).not.toEqual(newGame({ seed: 8, decks }));
  });

  it('開局：起手加上第 1 回合的抽牌', () => {
    const s = newGame({ seed: 1, decks: [PRESET_DECKS.dawn, PRESET_DECKS.dusk] });
    expect(s.round).toBe(1);
    for (const side of s.sides) {
      expect(side.hand).toHaveLength(RULES.openingHand + 1);
      expect(side.deck).toHaveLength(RULES.deckSize - RULES.openingHand - 1);
    }
  });
});

describe('牌組構築', () => {
  it('預設牌組都合法', () => {
    expect(validateDeck(PRESET_DECKS.dawn)).toBeNull();
    expect(validateDeck(PRESET_DECKS.dusk)).toBeNull();
  });

  it('同名超過上限、衍生物、張數不對都不合法', () => {
    const deck = [...PRESET_DECKS.dawn];
    expect(validateDeck([...deck.slice(1), deck[2]])).toMatch('超過');
    expect(validateDeck([...deck.slice(1), 'militia'])).toMatch('衍生物');
    expect(validateDeck(deck.slice(1))).toMatch('剛好');
  });
});

describe('勝負判定', () => {
  it('摧毀對手兩座塔就獲勝', () => {
    const s = emptyBoard({ round: 3 });
    s.sides[1].towers = [0, 0, 8];
    expect(checkWinner(s)).toBe(0);
  });

  it('打滿回合數時比塔的總生命', () => {
    const s = emptyBoard({ round: RULES.maxRounds });
    s.sides[0].towers = [3, 8, 8];
    s.sides[1].towers = [8, 8, 2];
    expect(checkWinner(s)).toBe(0);
    s.sides[1].towers = [8, 8, 3];
    expect(checkWinner(s)).toBe('draw');
  });

  it('雙方同時失去兩座塔時比總生命', () => {
    const s = emptyBoard({ round: 4 });
    s.sides[0].towers = [0, 0, 5];
    s.sides[1].towers = [0, 0, 6];
    expect(checkWinner(s)).toBe(1);
  });

  it('還沒分出勝負時回傳 null', () => {
    expect(checkWinner(emptyBoard({ round: 4 }))).toBeNull();
  });
});
