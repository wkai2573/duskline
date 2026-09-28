import { describe, expect, it } from 'vitest';
import { choosePlan } from '../src/ai/greedy.ts';
import { PRESET_DECKS, newGame, resolveRound, type GameState, type Plan } from '../src/engine/index.ts';
import { createLoopback, type LoopbackOptions } from '../src/net/loopback.ts';
import { createMatch, type GameInfo, type MatchEvents, type OnlineMatch } from '../src/net/match.ts';
import { PROTOCOL_VERSION, isValidRoomCode, makeRoomCode, normalizeRoomCode, parsePlan, type NetMessage } from '../src/net/protocol.ts';

/** 讓排隊中的非同步訊息都送達 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

interface Side {
  match: OnlineMatch;
  started: Promise<GameInfo>;
  errors: string[];
  closed: () => boolean;
  committedRounds: number[];
}

function makeSide(role: 'host' | 'guest', channel: ReturnType<typeof createLoopback>[number]): Side {
  const errors: string[] = [];
  const committedRounds: number[] = [];
  let closed = false;
  let onStart!: (g: GameInfo) => void;
  const started = new Promise<GameInfo>((resolve) => (onStart = resolve));
  const events: MatchEvents = {
    start: (g) => onStart(g),
    opponentCommitted: (round) => committedRounds.push(round),
    rematchRequested: () => {},
    error: (m) => errors.push(m),
    closed: () => (closed = true),
  };
  const match = createMatch(channel, role, events, { hostFaction: 'dusk', randomSeed: () => 20260929 });
  return { match, started, errors, closed: () => closed, committedRounds };
}

function pair(opts?: LoopbackOptions): [Side, Side] {
  const [a, b] = createLoopback(opts);
  return [makeSide('host', a), makeSide('guest', b)];
}

/** 一方的完整對局：自己用 AI 出牌，對手的出牌從網路來，本地結算 */
async function playOut(side: Side): Promise<GameState> {
  const g = await side.started;
  let s = newGame({ seed: g.seed, decks: [PRESET_DECKS[g.factions[0]], PRESET_DECKS[g.factions[1]]] });
  while (s.winner === null) {
    const mine = choosePlan(s, g.mySeat);
    const theirs = await side.match.submit(s.round, mine);
    const plans: [Plan, Plan] = g.mySeat === 0 ? [mine, theirs] : [theirs, mine];
    const next = resolveRound(s, plans).state;
    await side.match.sync(s.round, next);
    s = next;
  }
  return s;
}

describe('連線對戰協定', () => {
  it('房主決定種子和陣營，加入者拿另一個陣營、坐 1 號位', async () => {
    const [host, guest] = pair();
    const [h, g] = await Promise.all([host.started, guest.started]);
    expect(h).toEqual({ seed: 20260929, factions: ['dusk', 'dawn'], mySeat: 0 });
    expect(g).toEqual({ seed: 20260929, factions: ['dusk', 'dawn'], mySeat: 1 });
  });

  it('雙方各自結算，整局打完盤面完全相同', async () => {
    const [host, guest] = pair();
    const [a, b] = await Promise.all([playOut(host), playOut(guest)]);
    await flush();
    expect(a).toEqual(b);
    expect(a.winner).not.toBeNull();
    expect([...host.errors, ...guest.errors]).toEqual([]);
  });

  it('自己還沒送出前，收不到對手的出牌內容', async () => {
    const seen: NetMessage[] = [];
    const [host, guest] = pair({
      intercept: (msg, from) => {
        if (from === 1) seen.push(msg);
        return msg;
      },
    });
    await Promise.all([host.started, guest.started]);

    void guest.match.submit(1, { plays: [] });
    await flush();
    expect(seen.map((m) => m.t)).toEqual(['hello', 'commit']);
    expect(host.committedRounds).toEqual([1]);

    const theirs = host.match.submit(1, { plays: [] });
    await expect(theirs).resolves.toEqual({ plays: [] });
    expect(seen.map((m) => m.t)).toContain('reveal');
  });

  it('公開的出牌和雜湊不符時中止連線', async () => {
    const [host, guest] = pair({
      // 加入者送出雜湊後偷改出牌內容
      intercept: (msg, from) => (from === 1 && msg.t === 'reveal' ? { ...msg, plan: '{"plays":[],"burn":1}' } : msg),
    });
    await Promise.all([host.started, guest.started]);

    void guest.match.submit(1, { plays: [] }).catch(() => {});
    await expect(host.match.submit(1, { plays: [] })).rejects.toThrow();
    expect(host.errors).toEqual(['對手公開的出牌和先前送出的不符']);
    await flush();
    expect(guest.closed()).toBe(true);
  });

  it('盤面雜湊不同時回報不同步', async () => {
    const [host, guest] = pair();
    await Promise.all([host.started, guest.started]);
    const s = newGame({ seed: 1, decks: [PRESET_DECKS.dawn, PRESET_DECKS.dusk] });
    await host.match.sync(1, s);
    await guest.match.sync(1, { ...s, rng: s.rng + 1 });
    await flush();
    expect(host.errors.length + guest.errors.length).toBeGreaterThan(0);
  });

  it('雙方都同意才會再戰一局，而且拿到新的開局', async () => {
    const [a, b] = createLoopback();
    const starts: GameInfo[] = [];
    const events = (): MatchEvents => ({
      start: (g) => starts.push(g),
      opponentCommitted: () => {},
      rematchRequested: () => {},
      error: () => {},
      closed: () => {},
    });
    const host = createMatch(a, 'host', events());
    const guest = createMatch(b, 'guest', events());
    await flush();
    expect(starts).toHaveLength(2);

    host.requestRematch();
    await flush();
    expect(starts).toHaveLength(2);
    guest.requestRematch();
    await flush();
    expect(starts).toHaveLength(4);
  });

  it('版本不同時拒絕開局', async () => {
    const [a, b] = createLoopback();
    const errors: string[] = [];
    createMatch(a, 'host', {
      start: () => {},
      opponentCommitted: () => {},
      rematchRequested: () => {},
      error: (m) => errors.push(m),
      closed: () => {},
    });
    b.send({ t: 'hello', version: PROTOCOL_VERSION + 1 });
    await flush();
    expect(errors[0]).toMatch('版本不同');
  });

  it('對手離開時通知', async () => {
    const [host, guest] = pair();
    await Promise.all([host.started, guest.started]);
    guest.match.close();
    await flush();
    expect(host.closed()).toBe(true);
    expect(guest.closed()).toBe(false);
  });
});

describe('房間代碼與出牌格式', () => {
  it('產生的代碼都合法，輸入時容許小寫和空白', () => {
    for (let i = 0; i < 50; i++) expect(isValidRoomCode(makeRoomCode())).toBe(true);
    expect(normalizeRoomCode(' k7q-2xm ')).toBe('K7Q2XM');
    expect(isValidRoomCode('K7Q2X0')).toBe(false);
  });

  it('只接受形狀正確的出牌', () => {
    expect(parsePlan('{"plays":[{"uid":3,"lane":1},{"uid":4}],"burn":5}')).toEqual({
      plays: [{ uid: 3, lane: 1 }, { uid: 4 }],
      burn: 5,
    });
    expect(parsePlan('not json')).toBeNull();
    expect(parsePlan('{"plays":[{"uid":3,"lane":7}]}')).toBeNull();
    expect(parsePlan('{"plays":"x"}')).toBeNull();
  });
});
