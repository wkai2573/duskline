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

  if (plan.burn !== undefined) {
    const card = takeFromHand(side, plan.burn);
    side.exiled.push(card);
    emit({ t: 'burn', seat, defId: card.defId });
  }

  for (const play of plan.plays) {
    const card = takeFromHand(side, play.uid);
    const def = getDef(card.defId);
    const lane = play.lane;

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
