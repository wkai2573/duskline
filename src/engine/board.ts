import { getDef } from './cards.ts';
import { RULES, type CardDef, type Emit, type GameState, type Lane, type Seat, type SideState, type Unit } from './types.ts';

// 底層盤面操作。這一層的函式都「就地修改」傳進來的 state，
// 只能在 game.ts 複製過的草稿上呼叫，不要直接改呼叫端手上的 state。

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function makeUnit(uid: number, def: CardDef): Unit {
  const hp = def.hp ?? 1;
  return { uid, defId: def.id, hp, maxHp: hp };
}

export function drawCard(s: GameState, seat: Seat, emit: Emit): void {
  const side = s.sides[seat];
  const card = side.deck.shift();
  if (!card) return;
  if (side.hand.length >= RULES.handLimit) {
    side.discard.push(card);
    emit({ t: 'overdraw', seat, defId: card.defId });
    return;
  }
  side.hand.push(card);
  emit({ t: 'draw', seat, defId: card.defId });
}

export function takeFromHand(side: SideState, uid: number) {
  const i = side.hand.findIndex((c) => c.uid === uid);
  if (i < 0) throw new Error(`手牌中找不到 uid ${uid}`);
  return side.hand.splice(i, 1)[0];
}

/** 造成傷害，回傳實際扣掉的生命（不會超過目前生命） */
export function damageUnit(s: GameState, seat: Seat, lane: Lane, unit: Unit, amount: number, emit: Emit): number {
  const dealt = Math.min(amount, unit.hp);
  if (dealt <= 0) return 0;
  unit.hp -= dealt;
  emit({ t: 'unitDamage', seat, lane, uid: unit.uid, defId: unit.defId, amount: dealt });
  return dealt;
}

/** 最前方還活著的單位 */
export function frontUnit(s: GameState, seat: Seat, lane: Lane): Unit | undefined {
  return s.sides[seat].lanes[lane].find((u) => u.hp > 0);
}

export function summonToken(s: GameState, seat: Seat, lane: Lane, tokenId: string, emit: Emit): void {
  const row = s.sides[seat].lanes[lane];
  if (row.length >= RULES.laneCapacity) {
    emit({ t: 'laneFull', seat, defId: tokenId, lane });
    return;
  }
  const unit = makeUnit(s.nextUid++, getDef(tokenId));
  row.push(unit);
  emit({ t: 'summon', seat, uid: unit.uid, defId: tokenId, lane });
}
