import {
  PRESET_DECKS,
  RULES,
  destroyedTowers,
  newGame,
  resolveRound,
  type PlayableFaction,
  type Seat,
} from '../engine/index.ts';
import { choosePlan } from './greedy.ts';

export interface MatchResult {
  winner: Seat | 'draw';
  rounds: number;
  /** 有人提前被摧毀兩座塔（而不是打滿回合數比總生命） */
  early: boolean;
  firstInitiative: Seat;
}

/** AI 對 AI 打完一局 */
export function playMatch(seed: number, factions: readonly [PlayableFaction, PlayableFaction]): MatchResult {
  let s = newGame({ seed, decks: [PRESET_DECKS[factions[0]], PRESET_DECKS[factions[1]]] });
  const firstInitiative = s.initiative;
  while (s.winner === null) {
    s = resolveRound(s, [choosePlan(s, 0), choosePlan(s, 1)], { validate: false }).state;
    if (s.round > RULES.maxRounds) throw new Error(`種子 ${seed}：超過 ${RULES.maxRounds} 回合還沒結束`);
  }
  const early = destroyedTowers(s, 0) >= RULES.towersToWin || destroyedTowers(s, 1) >= RULES.towersToWin;
  return { winner: s.winner, rounds: s.round, early, firstInitiative };
}

export interface SeriesReport {
  games: number;
  wins: Record<PlayableFaction, number>;
  draws: number;
  avgRounds: number;
  earlyRate: number;
  /** 第一回合拿到主動權的一方的勝率 */
  firstInitiativeWinRate: number;
  /** 座位 0 的勝率，檢查座位本身有沒有偏差 */
  seat0WinRate: number;
}

/**
 * 晨曦 vs 暮影打 games 局，一半的局交換座位，
 * 避免把「座位 0 先算」之類的實作偏差誤判成陣營強弱。
 */
export function runSeries(games: number, seedBase = 1): SeriesReport {
  const wins: Record<PlayableFaction, number> = { dawn: 0, dusk: 0 };
  let draws = 0, rounds = 0, early = 0, firstWins = 0, seat0Wins = 0;

  for (let i = 0; i < games; i++) {
    const factions: [PlayableFaction, PlayableFaction] = i % 2 === 0 ? ['dawn', 'dusk'] : ['dusk', 'dawn'];
    const r = playMatch(seedBase + i, factions);
    rounds += r.rounds;
    if (r.early) early++;
    if (r.winner === 'draw') {
      draws++;
      continue;
    }
    wins[factions[r.winner]]++;
    if (r.winner === r.firstInitiative) firstWins++;
    if (r.winner === 0) seat0Wins++;
  }

  const decided = games - draws || 1;
  return {
    games,
    wins,
    draws,
    avgRounds: rounds / games,
    earlyRate: early / games,
    firstInitiativeWinRate: firstWins / decided,
    seat0WinRate: seat0Wins / decided,
  };
}
