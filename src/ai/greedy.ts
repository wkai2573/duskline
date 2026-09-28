import {
  LANES,
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
  return v;
}

function boardValue(s: GameState, seat: Seat, lane: Lane): number {
  let v = 0;
  for (const unit of s.sides[seat].lanes[lane]) {
    const def = getDef(unit.defId);
    v += unit.hp + (attackOf(def, 'day') + attackOf(def, 'night')) / 2;
  }
  return v;
}
