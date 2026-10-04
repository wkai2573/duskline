import { needsLane } from './actions.ts';
import { makeUnit, other, takeFromHand } from './board.ts';
import { getDef } from './cards.ts';
import { cleanupDeaths, runEffects } from './effects.ts';
import { RULES, type Emit, type GameState, type Plan, type Seat } from './types.ts';

/**
 * 揭曉：主動權方先把整個佈署翻開，另一方再翻。
 * 因為效果依序結算，後揭曉的晝夜法術會蓋掉先揭曉的。
 */
export function revealPlans(s: GameState, plans: readonly [Plan, Plan], emit: Emit): void {
  for (const seat of [s.initiative, other(s.initiative)]) {
    revealSide(s, seat, plans[seat], emit);
  }
}

function revealSide(s: GameState, seat: Seat, plan: Plan, emit: Emit): void {
  const side = s.sides[seat];

  arrivePending(s, seat, emit);

  if (plan.burn !== undefined) {
    const card = takeFromHand(side, plan.burn);
    side.exiled.push(card);
    emit({ t: 'burn', seat, defId: card.defId });
  }

  for (const play of plan.plays) {
    const card = takeFromHand(side, play.uid);
    const def = getDef(card.defId);
    const lane = play.lane;

    // 預約的牌這回合只付費，下回合才會進場或發動
    if (def.delayed) {
      side.pending.push({ card, lane: needsLane(def) ? lane : undefined, due: s.round + 1 });
      emit({ t: 'schedule', seat, uid: card.uid, defId: def.id, lane: needsLane(def) ? lane : undefined });
      continue;
    }

    if (def.type === 'unit') {
      if (lane === undefined) throw new Error(`「${def.name}」沒有指定路線`);
      const row = side.lanes[lane];
      // 驗證時算過容量，但同一回合的召喚可能先把位置佔滿
      if (row.length >= RULES.laneCapacity) {
        side.discard.push(card);
        emit({ t: 'laneFull', seat, defId: def.id, lane });
        continue;
      }
      row.push(makeUnit(card.uid, def));
      emit({ t: 'play', seat, uid: card.uid, defId: def.id, lane });
    } else {
      emit({ t: 'play', seat, uid: card.uid, defId: def.id, lane: def.target === 'lane' ? lane : undefined });
      side.discard.push(card);
    }

    runEffects({ s, seat, lane: def.target === 'global' ? undefined : lane, uid: card.uid, emit }, 'reveal', def);
    cleanupDeaths(s, emit);
  }
}

/** 揭曉階段開始：預約的牌發動，被流放的單位回到原本那一路的最後方 */
function arrivePending(s: GameState, seat: Seat, emit: Emit): void {
  const side = s.sides[seat];
  const due = side.pending.filter((p) => p.due <= s.round);
  if (due.length === 0) return;
  side.pending = side.pending.filter((p) => p.due > s.round);

  for (const p of due) {
    const def = getDef(p.card.defId);
    const returning = p.hp !== undefined;

    if (def.type === 'unit') {
      const lane = p.lane;
      if (lane === undefined) throw new Error(`「${def.name}」沒有指定路線`);
      const row = side.lanes[lane];
      if (row.length >= RULES.laneCapacity) {
        if (def.faction !== 'token') side.discard.push(p.card);
        emit({ t: 'laneFull', seat, defId: def.id, lane });
        continue;
      }
      const unit = makeUnit(p.card.uid, def);
      if (p.hp !== undefined) unit.hp = p.hp;
      row.push(unit);
      emit({ t: 'arrive', seat, uid: p.card.uid, defId: def.id, lane, returning });
      // 流放回來的單位不是新翻開的牌，不會再發動一次揭曉效果
      if (!returning) runEffects({ s, seat, lane, uid: p.card.uid, emit }, 'reveal', def);
    } else {
      emit({ t: 'arrive', seat, uid: p.card.uid, defId: def.id, lane: p.lane, returning });
      side.discard.push(p.card);
      runEffects({ s, seat, lane: def.target === 'global' ? undefined : p.lane, uid: p.card.uid, emit }, 'reveal', def);
    }
    cleanupDeaths(s, emit);
  }
}
