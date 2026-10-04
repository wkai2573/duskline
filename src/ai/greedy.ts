import {
  LANES,
  RULES,
  attackOf,
  getDef,
  manaFor,
  needsLane,
  planCost,
  resolveRound,
  validatePlan,
  type CardInst,
  type GameState,
  type Lane,
  type Plan,
  type Seat,
} from '../engine/index.ts';

const EMPTY: Plan = { plays: [] };

/** 評分權重：單位與手牌的價值，相對於塔的 1 點生命 */
const W = {
  tower: 1,
  destroyedTower: 10,
  unit: 0.6,
  hand: 0.8,
  /** 預約中的單位，相對於已經在場上的價值（晚一回合才會出手） */
  pending: 0.85,
  /** 預約中的法術大約值多少分 */
  pendingSpell: 3,
  /** 下回合可以後揭曉 */
  secondNext: 1,
  win: 10_000,
};

/**
 * 貪婪 AI：從空的佈署開始，每一步試遍「再多出一張牌」的所有選擇，
 * 模擬這回合的結果並評分，挑分數最高的一個加進去，直到沒有更好的選擇。
 *
 * 公平性：AI 看不到對手這回合要出什麼，模擬時一律假設對手不出牌；
 * 它也不讀對手的手牌，只看盤面上公開的資訊。
 */
export function choosePlan(s: GameState, seat: Seat): Plan {
  let plan: Plan = EMPTY;
  let best = evaluate(s, seat, plan);

  for (;;) {
    let next: Plan | null = null;
    for (const candidate of candidates(s, seat, plan)) {
      if (validatePlan(s, seat, candidate)) continue;
      const score = evaluate(s, seat, candidate);
      if (score > best + 1e-9) {
        best = score;
        next = candidate;
      }
    }
    if (!next) return plan;
    plan = next;
  }
}

/** 在目前的佈署上多出一張牌的所有可能；魔力差 1 點時，順便考慮焚掉最便宜的一張 */
function candidates(s: GameState, seat: Seat, plan: Plan): Plan[] {
  const hand = s.sides[seat].hand;
  const used = new Set(plan.plays.map((p) => p.uid));
  if (plan.burn !== undefined) used.add(plan.burn);
  const unused = hand.filter((c) => !used.has(c.uid));
  const mana = manaFor(s) + (plan.burn !== undefined ? 1 : 0);
  const spent = planCost(s, seat, plan);

  const out: Plan[] = [];
  for (const card of unused) {
    const def = getDef(card.defId);
    const lanes: (Lane | undefined)[] = needsLane(def) ? [...LANES] : [undefined];
    for (const lane of lanes) {
      const plays = [...plan.plays, { uid: card.uid, lane }];
      if (spent + def.cost <= mana) {
        out.push({ plays, burn: plan.burn });
      } else if (plan.burn === undefined && spent + def.cost <= mana + 1) {
        const fodder = cheapest(unused.filter((c) => c.uid !== card.uid));
        if (fodder) out.push({ plays, burn: fodder.uid });
      }
    }
  }
  return out;
}

function cheapest(cards: CardInst[]): CardInst | undefined {
  let best: CardInst | undefined;
  for (const card of cards) {
    if (!best || getDef(card.defId).cost < getDef(best.defId).cost) best = card;
  }
  return best;
}

function evaluate(s: GameState, seat: Seat, plan: Plan): number {
  const plans: [Plan, Plan] = seat === 0 ? [plan, EMPTY] : [EMPTY, plan];
  const { state } = resolveRound(s, plans, { advance: false, validate: false });
  return score(state, seat);
}

/** 從 seat 的角度評估盤面 */
export function score(s: GameState, seat: Seat): number {
  if (s.winner === seat) return W.win;
  if (s.winner !== null && s.winner !== 'draw') return -W.win;

  const opp: Seat = seat === 0 ? 1 : 0;
  let v = 0;
  for (const lane of LANES) {
    const mine = s.sides[seat].towers[lane];
    const theirs = s.sides[opp].towers[lane];
    v += W.tower * (mine - theirs);
    if (theirs <= 0) v += W.destroyedTower;
    if (mine <= 0) v -= W.destroyedTower;
    v += W.unit * (boardValue(s, seat, lane) - boardValue(s, opp, lane));
  }
  v += W.hand * s.sides[seat].hand.length;
  v += pendingValue(s, seat) - pendingValue(s, opp);
  // 預約、流放的單位這回合不在場上，下回合才回來；後揭曉的優勢也要算進去
  const nextFirst = s.nextInitiative ?? (seat === s.initiative ? opp : seat);
  if (nextFirst !== seat) v += W.secondNext;
  return v;
}

function pendingValue(s: GameState, seat: Seat): number {
  let v = 0;
  for (const p of s.sides[seat].pending) {
    const def = getDef(p.card.defId);
    if (def.type === 'spell') {
      v += W.pendingSpell;
    } else {
      const hp = p.hp ?? def.hp ?? 0;
      v += W.unit * W.pending * (hp + (attackOf(def, 'day') + attackOf(def, 'night')) / 2) * laneWeight(s, seat, p.lane);
    }
  }
  return v;
}

/**
 * 預約的單位要先決定去哪一路。對手的塔已經倒了，去那一路就打不到塔，價值打折；
 * 其他情況下，偏好對手塔血量較低（接近拆掉）或是我方塔血量較低（需要防守）的一路。
 */
function laneWeight(s: GameState, seat: Seat, lane: Lane | undefined): number {
  if (lane === undefined) return 1;
  const opp: Seat = seat === 0 ? 1 : 0;
  const theirTower = s.sides[opp].towers[lane];
  const myTower = s.sides[seat].towers[lane];
  if (theirTower <= 0) return 0.5;
  return 1 + 0.03 * (RULES.towerHp - theirTower) + 0.02 * (RULES.towerHp - Math.max(0, myTower));
}

function boardValue(s: GameState, seat: Seat, lane: Lane): number {
  let v = 0;
  for (const unit of s.sides[seat].lanes[lane]) {
    const def = getDef(unit.defId);
    v += unit.hp + (attackOf(def, 'day') + attackOf(def, 'night')) / 2;
  }
  return v;
}
