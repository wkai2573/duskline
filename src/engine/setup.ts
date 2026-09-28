import { drawCard } from './board.ts';
import { validateDeck } from './cards.ts';
import { startRound } from './game.ts';
import { randInt, shuffle } from './rng.ts';
import { RULES, SEATS, type Emit, type GameEvent, type GameState, type SideState } from './types.ts';

export interface NewGameOptions {
  seed: number;
  /** 雙方牌組的卡片 id 清單 */
  decks: readonly [string[], string[]];
}

export function newGame({ seed, decks }: NewGameOptions): GameState {
  for (const deck of decks) {
    const error = validateDeck(deck);
    if (error) throw new Error(error);
  }

  let nextUid = 1;
  const makeSide = (deck: string[]): SideState => ({
    deck: deck.map((defId) => ({ uid: nextUid++, defId })),
    hand: [],
    discard: [],
    exiled: [],
    lanes: [[], [], []],
    towers: [RULES.towerHp, RULES.towerHp, RULES.towerHp],
  });

  const s: GameState = {
    rng: seed | 0,
    round: 0,
    firstPhase: 'day',
    phase: 'day',
    nextPhase: null,
    initiative: 0,
    sides: [makeSide(decks[0]), makeSide(decks[1])],
    nextUid: 0,
    winner: null,
  };
  s.nextUid = nextUid;
  s.initiative = randInt(s, 2) === 0 ? 0 : 1;
  // 最後一回合的晝夜影響很大，固定的話會讓某個陣營永遠佔便宜
  s.firstPhase = randInt(s, 2) === 0 ? 'day' : 'night';

  // 開局的抽牌不需要動畫，事件直接丟掉
  const events: GameEvent[] = [];
  const emit: Emit = (e) => events.push(e);
  for (const seat of SEATS) {
    shuffle(s, s.sides[seat].deck);
    for (let i = 0; i < RULES.openingHand; i++) drawCard(s, seat, emit);
  }
  startRound(s, emit);
  return s;
}
