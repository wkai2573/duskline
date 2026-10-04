import { describe, expect, it } from 'vitest';
import { PRESET_DECKS, RULES, resolveRound, validateDeck, validatePlan } from '../src/engine/index.ts';
import { NO_PLAN, emptyBoard, findUnit, giveCard, putUnit } from './helpers.ts';

describe('星軌學會：牌組', () => {
  it('預設牌組合法', () => {
    expect(validateDeck(PRESET_DECKS.orbit)).toBeNull();
  });
});

describe('星軌學會：預約', () => {
  it('預約的單位這回合不進場，只付費；下回合揭曉階段開始時才進場並參與交戰', () => {
    const s = emptyBoard({ round: 3, initiative: 0 });
    const lurker = giveCard(s, 0, 'lurker');

    const r1 = resolveRound(s, [{ plays: [{ uid: lurker, lane: 1 }] }, NO_PLAN]);
    expect(r1.state.sides[0].lanes[1]).toHaveLength(0);
    expect(r1.state.sides[0].hand.some((c) => c.uid === lurker)).toBe(false);
    expect(r1.state.sides[0].pending).toEqual([{ card: { uid: lurker, defId: 'lurker' }, lane: 1, due: 4 }]);
    expect(r1.events).toContainEqual(expect.objectContaining({ t: 'schedule', seat: 0, uid: lurker }));
    // 沒進場，所以這回合沒有任何傷害
    expect(r1.state.sides[1].towers).toEqual([8, 8, 8]);

    const r2 = resolveRound(r1.state, [NO_PLAN, NO_PLAN]);
    expect(r2.state.sides[0].pending).toHaveLength(0);
    // 時隙伏兵 ☀☾2：進場當回合就打塔
    expect(r2.state.sides[1].towers[1]).toBe(6);
    expect(findUnit(r2.state, lurker)?.hp).toBe(3);
  });

  it('預約會佔用這回合的魔力，但不佔戰線的位置', () => {
    const s = emptyBoard({ round: 1 });
    const lurker = giveCard(s, 0, 'lurker');
    const filler = [1, 2, 3].map(() => putUnit(s, 0, 0, 'squire'));
    expect(filler).toHaveLength(RULES.laneCapacity);

    // 左路已滿，但預約現在不檢查位置
    expect(validatePlan(s, 0, { plays: [{ uid: lurker, lane: 0 }] })).toBeNull();
    // 1 點魔力：再出第二張 1 費牌就不夠
    const apprentice = giveCard(s, 0, 'apprentice');
    expect(validatePlan(s, 0, { plays: [{ uid: lurker, lane: 0 }, { uid: apprentice, lane: 1 }] })).toMatch('魔力不足');
  });

  it('進場時那一路已經滿了，單位進棄牌堆', () => {
    const s = emptyBoard({ round: 3 });
    const lurker = giveCard(s, 0, 'lurker');
    const r1 = resolveRound(s, [{ plays: [{ uid: lurker, lane: 0 }] }, NO_PLAN]);
    for (let i = 0; i < RULES.laneCapacity; i++) putUnit(r1.state, 0, 0, 'shieldbearer');

    const r2 = resolveRound(r1.state, [NO_PLAN, NO_PLAN]);
    expect(r2.events).toContainEqual(expect.objectContaining({ t: 'laneFull', seat: 0, defId: 'lurker' }));
    expect(r2.state.sides[0].discard.some((c) => c.uid === lurker)).toBe(true);
  });

  it('最後一回合不能預約，因為不會生效', () => {
    const s = emptyBoard({ round: RULES.maxRounds });
    const lurker = giveCard(s, 0, 'lurker');
    expect(validatePlan(s, 0, { plays: [{ uid: lurker, lane: 0 }] })).toMatch('最後一回合');
  });

  it('預約的法術：下回合揭曉階段開始時發動', () => {
    const s = emptyBoard({ round: 3, initiative: 0 });
    const preview = giveCard(s, 0, 'preview');
    const a = putUnit(s, 1, 0, 'shieldbearer');
    const b = putUnit(s, 1, 2, 'knight');

    const r1 = resolveRound(s, [{ plays: [{ uid: preview }] }, NO_PLAN]);
    expect(findUnit(r1.state, a.uid)?.hp).toBe(5);

    const r2 = resolveRound(r1.state, [NO_PLAN, NO_PLAN], { advance: false });
    expect(r2.events.filter((e) => e.t === 'unitDamage')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: a.uid, amount: 2 }),
        expect.objectContaining({ uid: b.uid, amount: 2 }),
      ]),
    );
    expect(r2.state.sides[0].discard.some((c) => c.uid === preview)).toBe(true);
  });

  it('預約法術在下一回合若是後揭曉，可以打到對手剛放下的單位', () => {
    const s = emptyBoard({ round: 3, initiative: 1 });
    const preview = giveCard(s, 0, 'preview');
    const r1 = resolveRound(s, [{ plays: [{ uid: preview }] }, NO_PLAN]);
    // 第 4 回合主動權換成座位 0，先揭曉：預約法術打不到對手同回合才放下的單位
    expect(r1.state.initiative).toBe(0);

    const squire = giveCard(r1.state, 1, 'squire');
    const r2 = resolveRound(r1.state, [NO_PLAN, { plays: [{ uid: squire, lane: 0 }] }], { advance: false });
    expect(r2.events.some((e) => e.t === 'unitDamage' && e.uid === squire)).toBe(false);

    // 主動權在對手時，同樣的牌就打得到
    const late = structuredClone(r1.state);
    late.initiative = 1;
    const squire2 = giveCard(late, 1, 'squire');
    const r3 = resolveRound(late, [NO_PLAN, { plays: [{ uid: squire2, lane: 0 }] }], { advance: false });
    expect(r3.events).toContainEqual(expect.objectContaining({ t: 'unitDamage', uid: squire2, amount: 2 }));
  });
});

describe('星軌學會：先揭曉／後揭曉', () => {
  it('觀星學徒：只有後揭曉才抽牌', () => {
    for (const initiative of [0, 1] as const) {
      const s = emptyBoard({ initiative });
      const apprentice = giveCard(s, 0, 'apprentice');
      const handBefore = s.sides[0].hand.length;
      const { events } = resolveRound(s, [{ plays: [{ uid: apprentice, lane: 0 }] }, NO_PLAN], { advance: false });
      const drew = events.some((e) => e.t === 'draw' && e.seat === 0);
      // 座位 0 在 initiative=1 時後揭曉
      expect(drew).toBe(initiative === 1);
      expect(handBefore).toBe(1);
    }
  });

  it('星軌觀測者：先揭曉打前排，後揭曉抽牌', () => {
    const first = emptyBoard({ initiative: 0 });
    const target = putUnit(first, 1, 0, 'shieldbearer');
    const obs1 = giveCard(first, 0, 'observer');
    const r1 = resolveRound(first, [{ plays: [{ uid: obs1, lane: 0 }] }, NO_PLAN], { advance: false });
    expect(r1.events).toContainEqual(expect.objectContaining({ t: 'unitDamage', uid: target.uid, amount: 2 }));
    expect(r1.events.some((e) => e.t === 'draw')).toBe(false);

    const second = emptyBoard({ initiative: 1 });
    putUnit(second, 1, 0, 'shieldbearer');
    const obs2 = giveCard(second, 0, 'observer');
    const r2 = resolveRound(second, [{ plays: [{ uid: obs2, lane: 0 }] }, NO_PLAN], { advance: false });
    expect(r2.events.some((e) => e.t === 'draw' && e.seat === 0)).toBe(true);
    // 後揭曉不打前排（交戰前沒有傷害事件）
    const beforeCombat = r2.events.slice(0, r2.events.findIndex((e) => e.t === 'combat'));
    expect(beforeCombat.some((e) => e.t === 'unitDamage')).toBe(false);
  });

  it('星軌執政官：後揭曉才對整路敵人造成傷害', () => {
    for (const initiative of [0, 1] as const) {
      const s = emptyBoard({ initiative });
      const x = putUnit(s, 1, 2, 'knight');
      const y = putUnit(s, 1, 2, 'knight');
      const archon = giveCard(s, 0, 'archon');
      const { events } = resolveRound(s, [{ plays: [{ uid: archon, lane: 2 }] }, NO_PLAN], { advance: false });
      const hit = events.filter((e) => e.t === 'unitDamage' && (e.uid === x.uid || e.uid === y.uid) && e.amount === 1);
      const beforeCombat = events.slice(0, events.findIndex((e) => e.t === 'combat'));
      expect(beforeCombat.filter((e) => e.t === 'unitDamage')).toHaveLength(initiative === 1 ? 2 : 0);
      expect(hit.length).toBeGreaterThanOrEqual(initiative === 1 ? 2 : 0);
    }
  });
});

describe('星軌學會：流放', () => {
  it('敵方最前方的單位被移出戰場，這回合不出手也不擋傷害', () => {
    const s = emptyBoard({ initiative: 0 });
    const tank = putUnit(s, 1, 1, 'shieldbearer');
    const banish = giveCard(s, 0, 'banish');
    const guard = putUnit(s, 0, 1, 'knight'); // ☀4

    const { state } = resolveRound(s, [{ plays: [{ uid: banish, lane: 1 }] }, NO_PLAN], { advance: false });
    expect(findUnit(state, tank.uid)).toBeUndefined();
    expect(state.sides[1].pending).toEqual([{ card: { uid: tank.uid, defId: 'shieldbearer' }, lane: 1, due: 6, hp: 5 }]);
    // 盾衛不在，騎士的 4 點直接打到塔上
    expect(state.sides[1].towers[1]).toBe(4);
    expect(findUnit(state, guard.uid)?.hp).toBe(5);
  });

  it('下回合回到同一路的最後方，生命保留，而且不會再發動揭曉效果', () => {
    const s = emptyBoard({ initiative: 0 });
    const archer = putUnit(s, 1, 0, 'archer');
    archer.hp = 1;
    putUnit(s, 1, 0, 'squire');
    putUnit(s, 0, 0, 'shieldbearer'); // 弓手如果又發動揭曉效果，會打到這個單位
    const banish = giveCard(s, 0, 'banish');

    const r1 = resolveRound(s, [{ plays: [{ uid: banish, lane: 0 }] }, NO_PLAN]);
    expect(r1.state.sides[1].lanes[0].map((u) => u.defId)).toEqual(['squire']);

    const r2 = resolveRound(r1.state, [NO_PLAN, NO_PLAN], { advance: false, record: true });
    expect(r2.events).toContainEqual(expect.objectContaining({ t: 'arrive', seat: 1, uid: archer.uid, returning: true }));
    const arrived = r2.frames.find((f) => f.event.t === 'arrive')!;
    expect(arrived.state.sides[1].lanes[0].map((u) => u.defId)).toEqual(['squire', 'archer']);
    // 晨曦弓手的揭曉效果沒有再發動一次：交戰之前沒有任何傷害
    const beforeCombat = r2.events.slice(0, r2.events.findIndex((e) => e.t === 'combat'));
    expect(beforeCombat.some((e) => e.t === 'unitDamage')).toBe(false);
    expect(arrived.state.sides[1].lanes[0][1].hp).toBe(1);
  });

  it('先揭曉的人流放，對手同一回合的揭曉階段也不會把它放回去', () => {
    const s = emptyBoard({ initiative: 0 });
    const tank = putUnit(s, 1, 2, 'knight');
    const banish = giveCard(s, 0, 'banish');
    const { events, state } = resolveRound(s, [{ plays: [{ uid: banish, lane: 2 }] }, NO_PLAN], { advance: false });
    expect(events.some((e) => e.t === 'arrive')).toBe(false);
    expect(findUnit(state, tank.uid)).toBeUndefined();
  });

  it('沒有敵人可以流放時什麼都不會發生', () => {
    const s = emptyBoard();
    const banish = giveCard(s, 0, 'banish');
    const { state, events } = resolveRound(s, [{ plays: [{ uid: banish, lane: 0 }] }, NO_PLAN], { advance: false });
    expect(events.some((e) => e.t === 'exile')).toBe(false);
    expect(state.sides[1].pending).toHaveLength(0);
  });

  it('回來的時候那一路滿了，單位進棄牌堆；衍生物則直接消失', () => {
    const s = emptyBoard({ initiative: 0 });
    const militia = putUnit(s, 1, 0, 'militia');
    const banish = giveCard(s, 0, 'banish');
    const r1 = resolveRound(s, [{ plays: [{ uid: banish, lane: 0 }] }, NO_PLAN]);
    for (let i = 0; i < RULES.laneCapacity; i++) putUnit(r1.state, 1, 0, 'knight');

    const r2 = resolveRound(r1.state, [NO_PLAN, NO_PLAN]);
    expect(r2.events).toContainEqual(expect.objectContaining({ t: 'laneFull', seat: 1, defId: 'militia' }));
    expect(findUnit(r2.state, militia.uid)).toBeUndefined();
    expect(r2.state.sides[1].discard.some((c) => c.uid === militia.uid)).toBe(false);
  });
});

describe('星軌學會：逆轉星軌', () => {
  it('這回合後揭曉的人，下回合繼續後揭曉', () => {
    // 座位 0 這回合後揭曉；正常下回合座位 0 會變先揭曉
    const s = emptyBoard({ initiative: 1 });
    const reverse = giveCard(s, 0, 'reverse');
    const { state } = resolveRound(s, [{ plays: [{ uid: reverse }] }, NO_PLAN]);
    expect(state.initiative).toBe(1);
    expect(state.nextInitiative).toBeNull();
    // 再下一回合恢復輪流
    const next = resolveRound(state, [NO_PLAN, NO_PLAN]).state;
    expect(next.initiative).toBe(0);
  });

  it('這回合本來就會在下回合後揭曉時，打出去沒有任何改變', () => {
    const s = emptyBoard({ initiative: 0 });
    const reverse = giveCard(s, 0, 'reverse');
    const { state } = resolveRound(s, [{ plays: [{ uid: reverse }] }, NO_PLAN]);
    expect(state.initiative).toBe(1);
  });

  it('雙方都打出的話，後揭曉的那一個算數', () => {
    const s = emptyBoard({ initiative: 0 });
    const a = giveCard(s, 0, 'reverse');
    const b = giveCard(s, 1, 'reverse');
    // 座位 1 後揭曉，所以它的效果最後生效：下回合座位 1 後揭曉
    const { state } = resolveRound(s, [{ plays: [{ uid: a }] }, { plays: [{ uid: b }] }]);
    expect(state.initiative).toBe(0);
  });
});
