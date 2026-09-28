import { choosePlan } from '../ai/greedy.ts';
import {
  PRESET_DECKS,
  newGame,
  resolveRound,
  validatePlan,
  type GameEvent,
  type Lane,
  type Plan,
  type PlayableFaction,
  type Seat,
} from '../engine/index.ts';
import { createMatch, type OnlineMatch } from '../net/match.ts';
import { hostRoom, joinRoom, type HostHandle } from '../net/peer.ts';
import { isValidRoomCode, normalizeRoomCode, type Channel } from '../net/protocol.ts';
import { describe } from './describe.ts';
import { addPlay, emptyDraft, removePlay, toggleBurn, type DraftResult } from './input.ts';
import { inviteLink, render, type ViewModel } from './render.ts';

/** 每種事件播放後停多久（毫秒）；0 表示直接略過不重畫 */
const DELAY: Record<GameEvent['t'], number> = {
  roundStart: 700,
  draw: 0,
  overdraw: 400,
  burn: 450,
  play: 650,
  laneFull: 450,
  summon: 450,
  phase: 1000,
  lockPhase: 700,
  combat: 650,
  unitDamage: 380,
  unitHeal: 380,
  death: 320,
  returnToHand: 450,
  repair: 450,
  towerDamage: 480,
  towerDestroyed: 900,
  gameOver: 300,
};

const SEEN_RULES_KEY = 'duskline:seen-rules';

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function createApp(root: HTMLElement, rulesDialog: HTMLDialogElement): void {
  const vm: ViewModel = {
    screen: 'start',
    mode: 'ai',
    state: null,
    me: 0,
    factions: ['dawn', 'dusk'],
    draft: emptyDraft(),
    selected: null,
    busy: false,
    waiting: false,
    message: null,
    log: [],
    fx: null,
    caption: null,
    lobby: null,
    online: null,
  };
  let skip = false;
  let wake: (() => void) | null = null;
  // 換畫面時遞增，讓還在跑的非同步流程（播放、連線）發現自己過期了就停下來
  let generation = 0;
  let match: OnlineMatch | null = null;
  let host: HostHandle | null = null;

  function paint(): void {
    // 整個畫面會重畫，已經顯示中的結果視窗不要再播一次淡入動畫
    const overlayShown = root.querySelector('.overlay') !== null;
    root.innerHTML = render(vm);
    if (overlayShown) root.querySelector('.overlay')?.classList.add('shown');
    document.body.dataset.phase = vm.screen === 'game' ? (vm.state?.phase ?? 'day') : 'day';
    const list = root.querySelector('.log-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  // ── 開局 ──

  function beginGame(seed: number, factions: [PlayableFaction, PlayableFaction], me: Seat, mode: 'ai' | 'online'): void {
    generation++;
    const state = newGame({ seed, decks: [PRESET_DECKS[factions[0]], PRESET_DECKS[factions[1]]] });
    const intro = mode === 'online' ? `連線對戰 · 種子 ${seed}` : `對局種子 ${seed}`;
    Object.assign(vm, {
      screen: 'game',
      mode,
      me,
      state,
      factions,
      draft: emptyDraft(),
      selected: null,
      busy: false,
      waiting: false,
      message: null,
      fx: null,
      caption: null,
      lobby: null,
      online: mode === 'online' ? { opponentCommittedRound: null, rematch: 'none', disconnected: null } : null,
      log: [
        { kind: 'combat', text: intro },
        describe({ t: 'roundStart', round: 1, phase: state.phase, initiative: state.initiative }, me)!,
      ],
    } satisfies Partial<ViewModel>);
    paint();
  }

  function startVsAi(faction: PlayableFaction): void {
    const rival: PlayableFaction = faction === 'dawn' ? 'dusk' : 'dawn';
    beginGame(Math.floor(Math.random() * 2 ** 31), [faction, rival], 0, 'ai');
  }

  // ── 連線 ──

  function attachMatch(channel: Channel, role: 'host' | 'guest', hostFaction?: PlayableFaction): void {
    match = createMatch(
      channel,
      role,
      {
        start: ({ seed, factions, mySeat }) => beginGame(seed, factions, mySeat, 'online'),
        opponentCommitted: (round) => {
          if (!vm.online) return;
          vm.online.opponentCommittedRound = round;
          paint();
        },
        rematchRequested: () => {
          if (!vm.online) return;
          if (vm.online.rematch === 'none') vm.online.rematch = 'theirs';
          paint();
        },
        error: (message) => disconnected(message),
        closed: () => disconnected('朋友離開了這場對戰，或網路中斷了'),
      },
      { hostFaction },
    );
  }

  function disconnected(reason: string): void {
    vm.waiting = false;
    if (vm.screen === 'lobby' && vm.lobby) {
      vm.lobby = { ...vm.lobby, status: reason, error: true };
    } else if (vm.online) {
      vm.online.disconnected = reason;
    }
    paint();
  }

  async function createRoom(faction: PlayableFaction): Promise<void> {
    const gen = ++generation;
    Object.assign(vm, {
      screen: 'lobby',
      message: null,
      lobby: { role: 'host', code: '', status: '正在建立房間…', error: false, copied: false },
    } satisfies Partial<ViewModel>);
    paint();
    try {
      const handle = await hostRoom(
        (channel) => {
          if (gen !== generation) return channel.close();
          attachMatch(channel, 'host', faction);
        },
        (message) => gen === generation && disconnected(message),
      );
      if (gen !== generation) return handle.close();
      host = handle;
      vm.lobby = { role: 'host', code: handle.code, status: '等待朋友加入…', error: false, copied: false };
    } catch (err) {
      if (gen !== generation) return;
      vm.lobby = { role: 'host', code: '', status: (err as Error).message, error: true, copied: false };
    }
    paint();
  }

  async function joinByCode(code: string): Promise<void> {
    const gen = ++generation;
    Object.assign(vm, {
      screen: 'lobby',
      message: null,
      lobby: { role: 'guest', code, status: '正在連線…', error: false, copied: false },
    } satisfies Partial<ViewModel>);
    paint();
    try {
      const channel = await joinRoom(code);
      if (gen !== generation) return channel.close();
      attachMatch(channel, 'guest');
      // 開局訊息通常馬上就到，beginGame 會切到對戰畫面
      if (vm.screen === 'lobby') vm.lobby = { role: 'guest', code, status: '已連線，等待房主開局…', error: false, copied: false };
    } catch (err) {
      if (gen !== generation) return;
      vm.lobby = { role: 'guest', code, status: (err as Error).message, error: true, copied: false };
    }
    paint();
  }

  /** 關掉連線並回到首頁 */
  function leave(): void {
    generation++;
    match?.close();
    host?.close();
    match = null;
    host = null;
    Object.assign(vm, {
      screen: 'start',
      mode: 'ai',
      state: null,
      busy: false,
      waiting: false,
      message: null,
      lobby: null,
      online: null,
    } satisfies Partial<ViewModel>);
    paint();
  }

  // ── 出牌與結算 ──

  function apply(result: DraftResult): void {
    if (result.error !== undefined) {
      vm.message = { text: result.error, error: true };
      return;
    }
    vm.draft = result.draft;
    vm.selected = null;
    vm.message = null;
  }

  /** 取得對手這回合的出牌：電腦馬上算，朋友要等網路 */
  async function opponentPlan(mine: Plan): Promise<Plan | null> {
    const s = vm.state!;
    const opp = other(vm.me);
    if (vm.mode === 'ai') return choosePlan(s, opp);

    Object.assign(vm, { waiting: true, selected: null, message: null });
    paint();
    let theirs: Plan;
    try {
      theirs = await match!.submit(s.round, mine);
    } catch {
      return null; // 斷線的處理已經在 match 的事件裡做了
    }
    vm.waiting = false;
    const error = validatePlan(s, opp, theirs);
    if (error) {
      match?.close();
      disconnected(`對手送來不合規則的出牌（${error}），連線已中止`);
      return null;
    }
    return theirs;
  }

  async function confirm(): Promise<void> {
    const s = vm.state;
    if (!s || vm.busy || vm.waiting || s.winner !== null) return;
    const error = validatePlan(s, vm.me, vm.draft);
    if (error) {
      vm.message = { text: error, error: true };
      paint();
      return;
    }

    const game = generation;
    const mine = vm.draft;
    // 電腦在看不到玩家佈署的情況下決定；朋友則透過 commit–reveal 保證誰都不能偷看
    const theirs = await opponentPlan(mine);
    if (!theirs || game !== generation) return;

    const plans: [Plan, Plan] = vm.me === 0 ? [mine, theirs] : [theirs, mine];
    const { state: next, frames } = resolveRound(s, plans, { record: true });
    if (vm.mode === 'online') void match?.sync(s.round, next);
    Object.assign(vm, { busy: true, draft: emptyDraft(), selected: null, message: null });
    skip = false;

    for (const frame of frames) {
      if (game !== generation) return;
      const line = describe(frame.event, vm.me);
      if (line) vm.log.push(line);
      const delay = DELAY[frame.event.t];
      if (skip || delay === 0) continue;
      vm.state = frame.state;
      vm.fx = frame.event;
      vm.caption = line?.text ?? null;
      paint();
      await sleep(delay);
    }
    if (game !== generation) return;
    Object.assign(vm, { state: next, fx: null, caption: null, busy: false });
    paint();
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wake = done;
    });
  }

  function rematch(): void {
    if (vm.mode === 'ai') return startVsAi(vm.factions[vm.me]);
    const before = vm.online;
    if (!before || !match) return;
    match.requestRematch();
    // 對方已經先要求的話，房主這邊會在上一行裡直接開新局，vm.online 會換成新的
    if (vm.online === before) before.rematch = 'mine';
    paint();
  }

  async function copyInvite(): Promise<void> {
    if (!vm.lobby?.code) return;
    try {
      await navigator.clipboard.writeText(inviteLink(vm.lobby.code));
      vm.lobby.copied = true;
    } catch {
      vm.lobby.status = '瀏覽器不讓網頁寫入剪貼簿，請手動複製上面的連結';
    }
    paint();
  }

  // ── 事件 ──

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const uid = el.dataset.uid !== undefined ? Number(el.dataset.uid) : null;

    switch (el.dataset.action) {
      case 'start':
        startVsAi(el.dataset.faction as PlayableFaction);
        return;
      case 'host':
        void createRoom(el.dataset.faction as PlayableFaction);
        return;
      case 'copy-link':
        void copyInvite();
        return;
      case 'leave':
        if (vm.screen === 'game' && vm.state?.winner === null && !vm.online?.disconnected) {
          if (!window.confirm('確定要離開這場連線對戰嗎？朋友那邊會顯示你已離開。')) return;
        }
        leave();
        return;
      case 'rematch':
        rematch();
        return;
      case 'restart':
        generation++;
        Object.assign(vm, { screen: 'start', state: null, busy: false, message: null });
        paint();
        return;
      case 'rules':
        if (!rulesDialog.open) rulesDialog.showModal();
        return;
      case 'skip':
        skip = true;
        wake?.();
        return;
      case 'confirm':
        void confirm();
        return;
    }

    const s = vm.state;
    if (!s || vm.busy || vm.waiting || s.winner !== null) return;
    switch (el.dataset.action) {
      case 'select':
        vm.selected = vm.selected === uid ? null : uid;
        vm.message = null;
        break;
      case 'lane':
        if (vm.selected === null) vm.message = { text: '先選一張手牌', error: false };
        else apply(addPlay(s, vm.me, vm.draft, vm.selected, Number(el.dataset.lane) as Lane));
        break;
      case 'unplay':
        if (uid !== null) vm.draft = removePlay(vm.draft, uid);
        vm.message = null;
        break;
      case 'burn': {
        const target = vm.selected ?? vm.draft.burn;
        if (target === null || target === undefined) vm.message = { text: '先選一張要焚掉的手牌', error: false };
        else apply(toggleBurn(s, vm.me, vm.draft, target));
        break;
      }
      case 'clear':
        Object.assign(vm, { draft: emptyDraft(), selected: null, message: null });
        break;
    }
    paint();
  });

  root.addEventListener('submit', (ev) => {
    const form = ev.target as HTMLFormElement;
    if (form.dataset.form !== 'join') return;
    ev.preventDefault();
    const code = normalizeRoomCode(String(new FormData(form).get('code') ?? ''));
    if (!isValidRoomCode(code)) {
      vm.message = { text: '房間代碼是 6 個英文字母或數字', error: true };
      paint();
      return;
    }
    void joinByCode(code);
  });

  document.addEventListener('keydown', (ev) => {
    if (rulesDialog.open || vm.screen !== 'game') return;
    if (ev.key === 'Enter' && !vm.busy) void confirm();
    else if (ev.key === ' ' && vm.busy) {
      ev.preventDefault();
      skip = true;
      wake?.();
    } else if (ev.key === 'Escape' && vm.selected !== null) {
      vm.selected = null;
      paint();
    }
  });

  // 關掉分頁時主動斷線，朋友那邊可以馬上知道
  window.addEventListener('pagehide', () => {
    match?.close();
    host?.close();
  });

  paint();

  // 從邀請連結進來就直接加入房間
  const invited = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
  if (invited) {
    history.replaceState(null, '', location.pathname);
    if (isValidRoomCode(invited)) void joinByCode(invited);
  }

  try {
    if (!localStorage.getItem(SEEN_RULES_KEY)) {
      localStorage.setItem(SEEN_RULES_KEY, '1');
      rulesDialog.showModal();
    }
  } catch {
    // 無痕模式等情況下 localStorage 可能不能用，那就不自動打開規則
  }
}
