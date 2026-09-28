import { PRESET_DECKS, getDef, newGame, type GameState, type Lane, type Phase, type Plan, type Seat, type Unit } from '../src/engine/index.ts';

export const NO_PLAN: Plan = { plays: [] };

/** 乾淨的測試盤面：手牌和戰場都清空，其他照一般開局 */
export function emptyBoard(opts: { round?: number; phase?: Phase; initiative?: Seat } = {}): GameState {
  const s = newGame({ seed: 42, decks: [PRESET_DECKS.dawn, PRESET_DECKS.dusk] });
  s.round = opts.round ?? 5;
  s.phase = opts.phase ?? 'day';
  s.firstPhase = s.round % 2 === 1 ? s.phase : s.phase === 'day' ? 'night' : 'day';
  s.initiative = opts.initiative ?? 0;
  for (const side of s.sides) {
    side.hand = [];
    side.lanes = [[], [], []];
  }
  return s;
}

export function putUnit(s: GameState, seat: Seat, lane: Lane, defId: string): Unit {
  const hp = getDef(defId).hp ?? 1;
  const unit: Unit = { uid: s.nextUid++, defId, hp, maxHp: hp };
  s.sides[seat].lanes[lane].push(unit);
  return unit;
}

/** 把一張卡放進手牌，回傳它的 uid */
export function giveCard(s: GameState, seat: Seat, defId: string): number {
  const uid = s.nextUid++;
  s.sides[seat].hand.push({ uid, defId });
  return uid;
}

export function findUnit(s: GameState, uid: number): Unit | undefined {
  for (const side of s.sides) {
    for (const row of side.lanes) {
      const unit = row.find((u) => u.uid === uid);
      if (unit) return unit;
    }
  }
  return undefined;
}
