import { choosePlan } from '../ai/greedy.ts';
import {
  PRESET_DECKS,
  newGame,
  resolveRound,
  validatePlan,
  type GameEvent,
  type Lane,
  type PlayableFaction,
  type Seat,
} from '../engine/index.ts';
import { describe } from './describe.ts';
import { addPlay, emptyDraft, removePlay, toggleBurn, type DraftResult } from './input.ts';
import { render, type ViewModel } from './render.ts';

const ME: Seat = 0;
const AI: Seat = 1;

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

export function createApp(root: HTMLElement, rulesDialog: HTMLDialogElement): void {
  const vm: ViewModel = {
    screen: 'start',
    state: null,
    me: ME,
    factions: ['dawn', 'dusk'],
    draft: emptyDraft(),
    selected: null,
    busy: false,
    message: null,
    log: [],
    fx: null,
    caption: null,
  };
  let skip = false;
  let wake: (() => void) | null = null;
  // 播放途中開新局時，讓舊的播放迴圈自己停下來
  let generation = 0;

  function paint(): void {
    root.innerHTML = render(vm);
    document.body.dataset.phase = vm.state?.phase ?? 'day';
    const list = root.querySelector('.log-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  function start(faction: PlayableFaction): void {
    generation++;
    const rival: PlayableFaction = faction === 'dawn' ? 'dusk' : 'dawn';
    const seed = Math.floor(Math.random() * 2 ** 31);
    const state = newGame({ seed, decks: [PRESET_DECKS[faction], PRESET_DECKS[rival]] });
    Object.assign(vm, {
      screen: 'game',
      state,
      factions: [faction, rival],
      draft: emptyDraft(),
      selected: null,
      busy: false,
      message: null,
      fx: null,
      caption: null,
      log: [
        { kind: 'combat', text: `對局種子 ${seed}` },
        describe({ t: 'roundStart', round: 1, phase: state.phase, initiative: state.initiative }, ME)!,
      ],
    } satisfies Partial<ViewModel>);
    paint();
  }

  function apply(result: DraftResult): void {
    if (result.error !== undefined) {
      vm.message = { text: result.error, error: true };
      return;
    }
    vm.draft = result.draft;
    vm.selected = null;
    vm.message = null;
  }

  function openRules(): void {
    if (!rulesDialog.open) rulesDialog.showModal();
  }

  async function confirm(): Promise<void> {
    const s = vm.state;
    if (!s || vm.busy || s.winner !== null) return;
    const error = validatePlan(s, ME, vm.draft);
    if (error) {
      vm.message = { text: error, error: true };
      paint();
      return;
    }

    // AI 在看不到玩家佈署的情況下決定，所以「同時出牌」是公平的
    const aiPlan = choosePlan(s, AI);
    const { state: next, frames } = resolveRound(s, [vm.draft, aiPlan], { record: true });
    const game = generation;
    Object.assign(vm, { busy: true, draft: emptyDraft(), selected: null, message: null });
    skip = false;

    for (const frame of frames) {
      if (game !== generation) return;
      const line = describe(frame.event, ME);
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

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const uid = el.dataset.uid !== undefined ? Number(el.dataset.uid) : null;

    switch (el.dataset.action) {
      case 'start':
        start(el.dataset.faction as PlayableFaction);
        return;
      case 'rematch':
        start(vm.factions[ME]);
        return;
      case 'restart':
        generation++;
        Object.assign(vm, { screen: 'start', state: null, busy: false });
        paint();
        return;
      case 'rules':
        openRules();
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
    if (!s || vm.busy || s.winner !== null) return;
    switch (el.dataset.action) {
      case 'select':
        vm.selected = vm.selected === uid ? null : uid;
        vm.message = null;
        break;
      case 'lane':
        if (vm.selected === null) vm.message = { text: '先選一張手牌', error: false };
        else apply(addPlay(s, ME, vm.draft, vm.selected, Number(el.dataset.lane) as Lane));
        break;
      case 'unplay':
        if (uid !== null) vm.draft = removePlay(vm.draft, uid);
        vm.message = null;
        break;
      case 'burn': {
        const target = vm.selected ?? vm.draft.burn;
        if (target === null || target === undefined) vm.message = { text: '先選一張要焚掉的手牌', error: false };
        else apply(toggleBurn(s, ME, vm.draft, target));
        break;
      }
      case 'clear':
        Object.assign(vm, { draft: emptyDraft(), selected: null, message: null });
        break;
    }
    paint();
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

  paint();
  try {
    if (!localStorage.getItem(SEEN_RULES_KEY)) {
      localStorage.setItem(SEEN_RULES_KEY, '1');
      openRules();
    }
  } catch {
    // 無痕模式等情況下 localStorage 可能不能用，那就不自動打開規則
  }
}
