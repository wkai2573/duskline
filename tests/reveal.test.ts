import { describe, expect, it } from 'vitest';
import { RULES, resolveRound, type GameEvent } from '../src/engine/index.ts';
import { NO_PLAN, emptyBoard, giveCard, putUnit } from './helpers.ts';

/** 交戰開始前發生的事件 */
function beforeCombat(events: GameEvent[]): GameEvent[] {
  const i = events.findIndex((e) => e.t === 'combat');
  return events.slice(0, i);
}

describe('揭曉', () => {
  it('主動權方先揭曉：它的揭曉效果打不到對手這回合才進場的單位', () => {
    const s = emptyBoard({ initiative: 0 });
    const archer = giveCard(s, 0, 'archer');
    const squire = giveCard(s, 1, 'squire');

    const { events } = resolveRound(s, [{ plays: [{ uid: archer, lane: 0 }] }, { plays: [{ uid: squire, lane: 0 }] }], {
      advance: false,
    });

    expect(beforeCombat(events).some((e) => e.t === 'unitDamage')).toBe(false);
  });

  it('後揭曉的一方可以用揭曉效果打到先進場的單位', () => {
    const s = emptyBoard({ initiative: 1 });
    const archer = giveCard(s, 0, 'archer');
    const squire = giveCard(s, 1, 'squire');

    const { events } = resolveRound(s, [{ plays: [{ uid: archer, lane: 0 }] }, { plays: [{ uid: squire, lane: 0 }] }], {
      advance: false,
    });

    expect(beforeCombat(events)).toContainEqual(expect.objectContaining({ t: 'unitDamage', seat: 1, uid: squire, amount: 1 }));
  });

  it('後揭曉的晝夜法術會蓋掉先揭曉的', () => {
    for (const initiative of [0, 1] as const) {
      const s = emptyBoard({ initiative, phase: 'day' });
      const daybreak = giveCard(s, 0, 'daybreak');
      const nightfall = giveCard(s, 1, 'nightfall');

      const { state } = resolveRound(s, [{ plays: [{ uid: daybreak }] }, { plays: [{ uid: nightfall }] }], { advance: false });

      // 主動權在 0 → 暮影後揭曉 → 黑夜；反之為白晝
      expect(state.phase).toBe(initiative === 0 ? 'night' : 'day');
    }
  });

  it('晝夜條件在發動當下判斷：先施放夜幕，刺客的揭曉效果就會發動', () => {
    const s = emptyBoard({ phase: 'day' });
    putUnit(s, 0, 1, 'knight');
    const nightfall = giveCard(s, 1, 'nightfall');
    const assassin = giveCard(s, 1, 'assassin');

    const { events } = resolveRound(s, [NO_PLAN, { plays: [{ uid: nightfall }, { uid: assassin, lane: 1 }] }], {
      advance: false,
    });

    expect(beforeCombat(events)).toContainEqual(expect.objectContaining({ t: 'unitDamage', seat: 0, amount: 3 }));
  });

  it('永夜會讓下回合維持黑夜', () => {
    const s = emptyBoard({ round: 4, phase: 'night' });
    const eternal = giveCard(s, 1, 'eternal');

    const control = resolveRound(s, [NO_PLAN, NO_PLAN]).state;
    const locked = resolveRound(s, [NO_PLAN, { plays: [{ uid: eternal }] }]).state;

    expect(control.round).toBe(5);
    expect(control.phase).toBe('day');
    expect(locked.phase).toBe('night');
    expect(locked.nextPhase).toBeNull();
  });

  it('骷髏兵在黑夜陣亡會回到手牌，白天陣亡則進棄牌堆', () => {
    for (const phase of ['day', 'night'] as const) {
      const s = emptyBoard({ phase });
      putUnit(s, 0, 0, 'knight');
      const skeleton = putUnit(s, 1, 0, 'skeleton');

      const { state } = resolveRound(s, [NO_PLAN, NO_PLAN], { advance: false });

      const inHand = state.sides[1].hand.some((c) => c.uid === skeleton.uid);
      const inDiscard = state.sides[1].discard.some((c) => c.uid === skeleton.uid);
      expect(inHand).toBe(phase === 'night');
      expect(inDiscard).toBe(phase === 'day');
    }
  });

  it('召喚時戰線已滿，衍生物就不會出現', () => {
    const s = emptyBoard();
    putUnit(s, 1, 0, 'werewolf');
    putUnit(s, 1, 0, 'werewolf');
    const necro = giveCard(s, 1, 'necromancer');

    const { events } = resolveRound(s, [NO_PLAN, { plays: [{ uid: necro, lane: 0 }] }], { advance: false });

    expect(events).toContainEqual({ t: 'laneFull', seat: 1, defId: 'corpse', lane: 0 });
    expect(events.some((e) => e.t === 'summon')).toBe(false);
  });

  it('修復不會超過塔的上限，也修不回已經倒下的塔', () => {
    const s = emptyBoard();
    s.sides[0].towers = [RULES.towerHp - 1, 0, 3];
    const plays = [giveCard(s, 0, 'sister'), giveCard(s, 0, 'sister')].map((uid, i) => ({ uid, lane: i as 0 | 1 }));
    s.round = 6;

    const { state } = resolveRound(s, [{ plays }, NO_PLAN], { advance: false });

    expect(state.sides[0].towers[0]).toBe(RULES.towerHp);
    expect(state.sides[0].towers[1]).toBe(0);
  });
});
