import { describe, expect, it } from 'vitest';
import { RULES, getDef, resolveRound } from '../src/engine/index.ts';
import { NO_PLAN, emptyBoard, findUnit, putUnit } from './helpers.ts';

const idle = [NO_PLAN, NO_PLAN] as const;
const atk = (id: string, phase: 'day' | 'night') => (phase === 'day' ? getDef(id).dayAtk : getDef(id).nightAtk) ?? 0;
const hp = (id: string) => getDef(id).hp ?? 0;

describe('交戰', () => {
  it('傷害先打最前方的單位，溢出的部分打塔', () => {
    const s = emptyBoard({ phase: 'day' });
    const knight = putUnit(s, 0, 1, 'knight');
    putUnit(s, 1, 1, 'squire');

    const { state } = resolveRound(s, idle, { advance: false });

    expect(state.sides[1].lanes[1]).toHaveLength(0);
    expect(state.sides[1].towers[1]).toBe(RULES.towerHp - (atk('knight', 'day') - hp('squire')));
    // 侍從的攻擊全部被騎士吃下，沒有溢出到塔
    expect(findUnit(state, knight.uid)?.hp).toBe(hp('knight') - atk('squire', 'day'));
    expect(state.sides[0].towers[1]).toBe(RULES.towerHp);
  });

  it('雙方同時出手：互相打死的單位也都會造成傷害', () => {
    const s = emptyBoard({ phase: 'day' });
    putUnit(s, 0, 0, 'squire');
    putUnit(s, 1, 0, 'squire');

    const { state, events } = resolveRound(s, idle, { advance: false });

    expect(state.sides[0].lanes[0]).toHaveLength(0);
    expect(state.sides[1].lanes[0]).toHaveLength(0);
    expect(events.filter((e) => e.t === 'death')).toHaveLength(2);
  });

  it('突襲不打單位、直接打塔，守護會減少塔受到的傷害', () => {
    const s = emptyBoard({ phase: 'day' });
    putUnit(s, 0, 0, 'griffon');
    const shield = putUnit(s, 1, 0, 'shieldbearer');

    const { state, events } = resolveRound(s, idle, { advance: false });

    const guard = getDef('shieldbearer').keywords?.guard ?? 0;
    expect(state.sides[1].towers[0]).toBe(RULES.towerHp - (atk('griffon', 'day') - guard));
    expect(findUnit(state, shield.uid)?.hp).toBe(hp('shieldbearer'));
    expect(events).toContainEqual(expect.objectContaining({ t: 'towerDamage', seat: 1, lane: 0, blocked: guard }));
  });

  it('攻擊力依交戰當下的晝夜決定', () => {
    for (const phase of ['day', 'night'] as const) {
      const s = emptyBoard({ phase });
      putUnit(s, 1, 2, 'werewolf');
      const { state } = resolveRound(s, idle, { advance: false });
      expect(state.sides[0].towers[2]).toBe(RULES.towerHp - atk('werewolf', phase));
    }
  });

  it('塔被摧毀後，打過去的傷害就浪費掉', () => {
    const s = emptyBoard();
    s.sides[1].towers[2] = 0;
    putUnit(s, 0, 2, 'knight');

    const { state, events } = resolveRound(s, idle, { advance: false });

    expect(state.sides[1].towers[2]).toBe(0);
    expect(events.some((e) => e.t === 'towerDamage')).toBe(false);
  });

  it('打倒塔時發出摧毀事件', () => {
    const s = emptyBoard({ phase: 'day' });
    s.sides[1].towers[0] = 1;
    putUnit(s, 0, 0, 'squire');

    const { state, events } = resolveRound(s, idle, { advance: false });

    expect(state.sides[1].towers[0]).toBe(0);
    expect(events).toContainEqual({ t: 'towerDestroyed', seat: 1, lane: 0 });
  });

  it('吸血：交戰結束時若仍存活，回復等同目前攻擊力的生命', () => {
    const s = emptyBoard({ phase: 'night' });
    putUnit(s, 0, 1, 'knight');
    const count = putUnit(s, 1, 1, 'count');

    const { state, events } = resolveRound(s, idle, { advance: false });

    const afterHit = hp('count') - atk('knight', 'night');
    const healed = Math.min(atk('count', 'night'), hp('count') - afterHit);
    expect(findUnit(state, count.uid)?.hp).toBe(afterHit + healed);
    expect(events).toContainEqual(expect.objectContaining({ t: 'unitHeal', uid: count.uid, amount: healed }));
  });

  it('亡語：食屍鬼陣亡時打最前方的敵人', () => {
    const s = emptyBoard({ phase: 'day' });
    const knight = putUnit(s, 0, 0, 'knight');
    putUnit(s, 0, 0, 'squire');
    putUnit(s, 1, 0, 'ghoul');

    const { state } = resolveRound(s, idle, { advance: false });

    expect(state.sides[1].lanes[0]).toHaveLength(0);
    expect(findUnit(state, knight.uid)?.hp).toBe(hp('knight') - atk('ghoul', 'day') - 2);
  });
});
