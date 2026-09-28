import { getDef } from './cards.ts';
import { LANE_NAMES, RULES, type CardDef, type GameState, type Plan, type Seat } from './types.ts';

/** 第 N 回合有 N 點魔力 */
export function manaFor(s: GameState): number {
  return s.round;
}

export function needsLane(def: CardDef): boolean {
  return def.type === 'unit' || def.target === 'lane';
}

export function planCost(s: GameState, seat: Seat, plan: Plan): number {
  const hand = s.sides[seat].hand;
  let cost = 0;
  for (const play of plan.plays) {
    const card = hand.find((c) => c.uid === play.uid);
    if (card) cost += getDef(card.defId).cost;
  }
  return cost;
}

/** 佈署是否合法；合法回傳 null，否則回傳給玩家看的原因 */
export function validatePlan(s: GameState, seat: Seat, plan: Plan): string | null {
  if (s.winner !== null) return '對局已經結束';
  const side = s.sides[seat];
  const inHand = new Map(side.hand.map((c) => [c.uid, c]));
  const used = new Set<number>();

  if (plan.burn !== undefined) {
    if (!inHand.has(plan.burn)) return '要焚卷的卡不在手牌中';
    used.add(plan.burn);
  }

  const laneCount = side.lanes.map((row) => row.length);
  let cost = 0;
  for (const play of plan.plays) {
    const card = inHand.get(play.uid);
    if (!card) return '這張卡不在手牌中';
    if (used.has(play.uid)) return '同一張卡不能用兩次';
    used.add(play.uid);

    const def = getDef(card.defId);
    cost += def.cost;
    if (needsLane(def)) {
      if (play.lane === undefined) return `「${def.name}」需要指定一路`;
      if (def.type === 'unit' && ++laneCount[play.lane] > RULES.laneCapacity) {
        return `${LANE_NAMES[play.lane]}已經滿了（最多 ${RULES.laneCapacity} 個單位）`;
      }
    }
  }

  const mana = manaFor(s) + (plan.burn !== undefined ? 1 : 0);
  if (cost > mana) return `魔力不足（需要 ${cost}，只有 ${mana}）`;
  return null;
}
