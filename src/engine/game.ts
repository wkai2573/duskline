import { validatePlan } from './actions.ts';
import { drawCard, other } from './board.ts';
import { resolveCombat } from './combat.ts';
import { revealPlans } from './reveal.ts';
import {
  RULES,
  SEATS,
  type Emit,
  type Frame,
  type GameEvent,
  type GameState,
  type Phase,
  type Plan,
  type Seat,
} from './types.ts';

export interface ResolveOptions {
  /** 記錄每個事件當下的盤面，給 UI 逐步播放（AI 模擬時關掉以節省時間） */
  record?: boolean;
  /** 結算完是否直接進入下一回合；AI 預覽結果時不需要 */
  advance?: boolean;
  /** 呼叫端已經驗證過佈署時可以跳過 */
  validate?: boolean;
}

export interface RoundResult {
  state: GameState;
  events: GameEvent[];
  frames: Frame[];
}

/**
 * 結算一整個回合：揭曉 → 交戰 → 勝負判定 → 下一回合開始。
 * 這是純函式：不會修改傳進來的 state，而是回傳新的 state。
 */
export function resolveRound(state: GameState, plans: readonly [Plan, Plan], opts: ResolveOptions = {}): RoundResult {
  const { record = false, advance = true, validate = true } = opts;
  if (validate) {
    for (const seat of SEATS) {
      const error = validatePlan(state, seat, plans[seat]);
      if (error) throw new Error(`座位 ${seat} 的佈署不合法：${error}`);
    }
  }

  const s = structuredClone(state);
  const events: GameEvent[] = [];
  const frames: Frame[] = [];
  const emit: Emit = (event) => {
    events.push(event);
    if (record) frames.push({ event, state: structuredClone(s) });
  };

  revealPlans(s, plans, emit);
  resolveCombat(s, emit);

  const winner = checkWinner(s);
  if (winner !== null) {
    s.winner = winner;
    emit({ t: 'gameOver', winner });
  } else if (advance) {
    startRound(s, emit);
  }
  return { state: s, events, frames };
}

/** 就地修改：進入下一回合 */
export function startRound(s: GameState, emit: Emit): void {
  s.round += 1;
  if (s.round > 1) s.initiative = other(s.initiative);
  s.phase = s.nextPhase ?? phaseOfRound(s, s.round);
  s.nextPhase = null;
  emit({ t: 'roundStart', round: s.round, phase: s.phase, initiative: s.initiative });
  for (const seat of SEATS) drawCard(s, seat, emit);
}

/** 不考慮永夜等效果時，某回合原本的晝夜 */
export function phaseOfRound(s: GameState, round: number): Phase {
  if (round % 2 === 1) return s.firstPhase;
  return s.firstPhase === 'day' ? 'night' : 'day';
}

export function destroyedTowers(s: GameState, seat: Seat): number {
  return s.sides[seat].towers.filter((hp) => hp <= 0).length;
}

export function towerTotal(s: GameState, seat: Seat): number {
  return s.sides[seat].towers.reduce((sum, hp) => sum + hp, 0);
}

/** 摧毀兩座塔就獲勝；雙方同時達成或打滿回合數時，比塔的總生命 */
export function checkWinner(s: GameState): Seat | 'draw' | null {
  const lost = SEATS.map((seat) => destroyedTowers(s, seat) >= RULES.towersToWin);
  if (lost[0] !== lost[1]) return lost[0] ? 1 : 0;
  if (lost[0] || s.round >= RULES.maxRounds) {
    const total0 = towerTotal(s, 0);
    const total1 = towerTotal(s, 1);
    if (total0 === total1) return 'draw';
    return total0 > total1 ? 0 : 1;
  }
  return null;
}
