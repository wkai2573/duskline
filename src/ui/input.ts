import { getDef, manaFor, needsLane, planCost, validatePlan, type GameState, type Lane, type Plan, type Seat } from '../engine/index.ts';

/** 玩家還沒送出的佈署；型別和引擎的 Plan 相同，送出時直接交給引擎 */
export type Draft = Plan;

export type DraftResult = { draft: Draft; error?: undefined } | { draft?: undefined; error: string };

export function emptyDraft(): Draft {
  return { plays: [] };
}

/** 加一張牌進佈署；先交給引擎驗證，不合法就回傳原因 */
export function addPlay(s: GameState, seat: Seat, draft: Draft, uid: number, lane: Lane | undefined): DraftResult {
  const card = s.sides[seat].hand.find((c) => c.uid === uid);
  if (!card) return { error: '這張卡不在手牌中' };
  if (draft.burn === uid) return { error: '這張卡已經要焚卷了' };
  const def = getDef(card.defId);
  const result = checked(s, seat, { ...draft, plays: [...draft.plays, { uid, lane: needsLane(def) ? lane : undefined }] });
  if (result.error?.startsWith('魔力不足') && draft.burn === undefined && def.cost <= manaLeft(s, seat, draft) + 1) {
    return { error: `${result.error}。先選另一張牌按「🔥 焚卷」就多 1 點` };
  }
  return result;
}

export function removePlay(draft: Draft, uid: number): Draft {
  return { ...draft, plays: draft.plays.filter((p) => p.uid !== uid) };
}

/** 焚卷；對已經選為焚卷的卡再按一次就取消 */
export function toggleBurn(s: GameState, seat: Seat, draft: Draft, uid: number): DraftResult {
  if (draft.burn === uid) {
    const next = { ...draft, burn: undefined };
    return validatePlan(s, seat, next) ? { error: '取消焚卷後魔力不夠，請先收回一些牌' } : { draft: next };
  }
  if (draft.plays.some((p) => p.uid === uid)) return { error: '這張卡已經要打出了，不能焚卷' };
  return checked(s, seat, { ...draft, burn: uid });
}

export function manaLeft(s: GameState, seat: Seat, draft: Draft): number {
  return manaFor(s) + (draft.burn !== undefined ? 1 : 0) - planCost(s, seat, draft);
}

function checked(s: GameState, seat: Seat, next: Draft): DraftResult {
  const error = validatePlan(s, seat, next);
  return error ? { error } : { draft: next };
}
