import type { GameState, Plan, PlayableFaction, Seat } from '../engine/index.ts';
import { PROTOCOL_VERSION, commitText, parsePlan, randomHex, sha256, type Channel } from './protocol.ts';

export interface GameInfo {
  seed: number;
  factions: [PlayableFaction, PlayableFaction];
  mySeat: Seat;
}

export interface MatchEvents {
  /** 開局（包含再戰一局） */
  start(game: GameInfo): void;
  /** 對手已經送出這回合的出牌（內容還看不到） */
  opponentCommitted(round: number): void;
  rematchRequested(): void;
  /** 協定出錯，連線會被關閉 */
  error(message: string): void;
  /** 對手斷線或離開 */
  closed(): void;
}

export interface OnlineMatch {
  readonly mySeat: Seat;
  /** 送出這回合的出牌，等雙方都公開後回傳對手的出牌 */
  submit(round: number, plan: Plan): Promise<Plan>;
  /** 結算完送出盤面雜湊，和對手比對 */
  sync(round: number, state: GameState): Promise<void>;
  requestRematch(): void;
  close(): void;
}

export interface MatchOptions {
  /** 房主扮演的陣營，加入者自動拿另一個 */
  hostFaction?: PlayableFaction;
  /** 測試時可以固定種子 */
  randomSeed?: () => number;
}

/**
 * 連線對戰的「鎖步」協定：雙方用同一個種子各自跑引擎，每回合只交換出牌。
 *
 * 出牌用 commit–reveal：先送雜湊，等雙方都送出後才公開內容，
 * 對方收到內容時重新算雜湊比對。這樣誰都不能先看到對手出什麼再改自己的決定。
 */
export function createMatch(
  channel: Channel,
  role: 'host' | 'guest',
  events: MatchEvents,
  opts: MatchOptions = {},
): OnlineMatch {
  const mySeat: Seat = role === 'host' ? 0 : 1;
  const hostFaction = opts.hostFaction ?? 'dawn';
  const randomSeed = opts.randomSeed ?? (() => Math.floor(Math.random() * 2 ** 31));

  let theirCommits = new Map<number, string>();
  let mine = new Map<number, { salt: string; plan: string }>();
  let revealed = new Set<number>();
  let pending = new Map<number, { resolve: (plan: Plan) => void; reject: (err: Error) => void }>();
  let mySync = new Map<number, string>();
  let theirSync = new Map<number, string>();
  let rematchMine = false;
  let rematchTheirs = false;
  let finished = false;

  function reset(): void {
    theirCommits = new Map();
    mine = new Map();
    revealed = new Set();
    pending = new Map();
    mySync = new Map();
    theirSync = new Map();
    rematchMine = rematchTheirs = false;
  }

  function end(): void {
    finished = true;
    for (const p of pending.values()) p.reject(new Error('連線已結束'));
    pending.clear();
  }

  function fail(message: string): void {
    if (finished) return;
    end();
    events.error(message);
    channel.close();
  }

  function startGame(): void {
    reset();
    const game: GameInfo = {
      seed: randomSeed(),
      factions: [hostFaction, hostFaction === 'dawn' ? 'dusk' : 'dawn'],
      mySeat,
    };
    channel.send({ t: 'start', seed: game.seed, factions: game.factions });
    events.start(game);
  }

  function maybeReveal(round: number): void {
    const m = mine.get(round);
    if (!m || !theirCommits.has(round) || revealed.has(round)) return;
    revealed.add(round);
    channel.send({ t: 'reveal', round, salt: m.salt, plan: m.plan });
  }

  function compareSync(round: number): void {
    const a = mySync.get(round);
    const b = theirSync.get(round);
    if (!a || !b) return;
    mySync.delete(round);
    theirSync.delete(round);
    if (a !== b) fail('雙方的遊戲狀態不一致，連線已中止');
  }

  function maybeRematch(): void {
    if (!rematchMine || !rematchTheirs) return;
    rematchMine = rematchTheirs = false;
    if (role === 'host') startGame();
  }

  channel.onMessage(async (msg) => {
    if (finished) return;
    switch (msg.t) {
      case 'hello':
        if (role !== 'host') return;
        if (msg.version !== PROTOCOL_VERSION) {
          const message = '雙方的遊戲版本不同，請兩邊都重新整理頁面';
          channel.send({ t: 'error', message });
          fail(message);
          return;
        }
        startGame();
        return;
      case 'start':
        if (role !== 'guest') return;
        reset();
        events.start({ seed: msg.seed, factions: msg.factions, mySeat });
        return;
      case 'commit':
        theirCommits.set(msg.round, msg.hash);
        events.opponentCommitted(msg.round);
        maybeReveal(msg.round);
        return;
      case 'reveal': {
        const expected = theirCommits.get(msg.round);
        const actual = await sha256(commitText(msg.round, msg.salt, msg.plan));
        if (!expected || actual !== expected) return fail('對手公開的出牌和先前送出的不符');
        const plan = parsePlan(msg.plan);
        if (!plan) return fail('收到格式錯誤的出牌');
        pending.get(msg.round)?.resolve(plan);
        pending.delete(msg.round);
        return;
      }
      case 'sync':
        theirSync.set(msg.round, msg.hash);
        compareSync(msg.round);
        return;
      case 'rematch':
        rematchTheirs = true;
        events.rematchRequested();
        maybeRematch();
        return;
      case 'error':
        fail(msg.message);
        return;
    }
  });

  channel.onClose(() => {
    if (finished) return;
    end();
    events.closed();
  });

  if (role === 'guest') channel.send({ t: 'hello', version: PROTOCOL_VERSION });

  return {
    mySeat,

    async submit(round, plan) {
      if (finished) throw new Error('連線已結束');
      const salt = randomHex();
      const planJson = JSON.stringify(plan);
      const hash = await sha256(commitText(round, salt, planJson));
      const result = new Promise<Plan>((resolve, reject) => pending.set(round, { resolve, reject }));
      mine.set(round, { salt, plan: planJson });
      channel.send({ t: 'commit', round, hash });
      maybeReveal(round);
      return result;
    },

    async sync(round, state) {
      const hash = await sha256(JSON.stringify(state));
      if (finished) return;
      mySync.set(round, hash);
      channel.send({ t: 'sync', round, hash });
      compareSync(round);
    },

    requestRematch() {
      if (finished || rematchMine) return;
      rematchMine = true;
      channel.send({ t: 'rematch' });
      maybeRematch();
    },

    close() {
      if (finished) return;
      end();
      channel.close();
    },
  };
}
