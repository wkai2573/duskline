import { damageUnit, other } from './board.ts';
import { attackOf, getDef } from './cards.ts';
import { cleanupDeaths } from './effects.ts';
import { LANES, SEATS, type Emit, type GameState, type Lane, type Phase, type Seat, type Unit } from './types.ts';

/** 一方在某一路的攻擊快照 */
export interface LaneStrike {
  /** 一般攻擊：先打最前方的單位，溢出的打塔 */
  pool: number;
  /** 突襲攻擊：直接打塔 */
  ambush: number;
  /** 守護：這一方的塔在此路受到的傷害減少多少 */
  guard: number;
}

export function laneStrike(units: readonly Unit[], phase: Phase): LaneStrike {
  const strike: LaneStrike = { pool: 0, ambush: 0, guard: 0 };
  for (const unit of units) {
    const def = getDef(unit.defId);
    const atk = attackOf(def, phase);
    if (def.keywords?.ambush) strike.ambush += atk;
    else strike.pool += atk;
    strike.guard += def.keywords?.guard ?? 0;
  }
  return strike;
}

/**
 * 三路同時交戰。
 * 先記下雙方所有攻擊的快照再套用傷害，所以雙方的單位就算同時陣亡也都能出手。
 */
export function resolveCombat(s: GameState, emit: Emit): void {
  emit({ t: 'combat' });
  const phase = s.phase;
  const strikes = SEATS.map((seat) => LANES.map((lane) => laneStrike(s.sides[seat].lanes[lane], phase)));

  for (const lane of LANES) {
    for (const attacker of [s.initiative, other(s.initiative)]) {
      const defender = other(attacker);
      const { pool, ambush } = strikes[attacker][lane];
      let remaining = pool;
      for (const unit of s.sides[defender].lanes[lane]) {
        if (remaining <= 0) break;
        remaining -= damageUnit(s, defender, lane, unit, remaining, emit);
      }
      hitTower(s, defender, lane, remaining + ambush, strikes[defender][lane].guard, emit);
    }
  }

  for (const seat of SEATS) {
    for (const lane of LANES) {
      for (const unit of s.sides[seat].lanes[lane]) {
        const def = getDef(unit.defId);
        if (!def.keywords?.lifesteal || unit.hp <= 0) continue;
        const amount = Math.min(attackOf(def, phase), unit.maxHp - unit.hp);
        if (amount <= 0) continue;
        unit.hp += amount;
        emit({ t: 'unitHeal', seat, lane, uid: unit.uid, defId: unit.defId, amount });
      }
    }
  }

  cleanupDeaths(s, emit);
}

function hitTower(s: GameState, seat: Seat, lane: Lane, raw: number, guard: number, emit: Emit): void {
  const towers = s.sides[seat].towers;
  // 塔已經倒了，打過來的傷害就浪費掉：攻擊方應該轉攻其他路
  if (raw <= 0 || towers[lane] <= 0) return;
  const amount = Math.min(Math.max(0, raw - guard), towers[lane]);
  const blocked = Math.min(raw, guard);
  towers[lane] -= amount;
  emit({ t: 'towerDamage', seat, lane, amount, blocked });
  if (towers[lane] === 0) emit({ t: 'towerDestroyed', seat, lane });
}
