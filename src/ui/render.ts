import {
  FACTIONS,
  LANES,
  LANE_NAMES,
  RULES,
  attackOf,
  cardsOf,
  getDef,
  manaFor,
  phaseOfRound,
  planCost,
  towerTotal,
  type CardDef,
  type GameEvent,
  type GameState,
  type Lane,
  type Phase,
  type PlayableFaction,
  type Seat,
  type Unit,
} from '../engine/index.ts';
import { phaseName, type LogLine } from './describe.ts';
import { manaLeft, type Draft } from './input.ts';

export interface ViewModel {
  screen: 'start' | 'game';
  state: GameState | null;
  me: Seat;
  /** 雙方的陣營，依座位排列 */
  factions: [PlayableFaction, PlayableFaction];
  draft: Draft;
  /** 目前選中的手牌 uid */
  selected: number | null;
  /** 正在播放結算動畫 */
  busy: boolean;
  message: { text: string; error: boolean } | null;
  log: LogLine[];
  /** 正在播放的事件，用來決定哪個元素要閃一下 */
  fx: GameEvent | null;
  caption: string | null;
}

export function render(vm: ViewModel): string {
  if (vm.screen === 'start' || !vm.state) return startScreen();
  const s = vm.state;
  return `
    <div class="table">
      ${topbar(vm, s)}
      <main class="field">
        ${opponentStrip(vm, s)}
        ${board(vm, s)}
        ${controls(vm, s)}
        ${hand(vm, s)}
      </main>
      ${logPanel(vm)}
      ${s.winner !== null && !vm.busy ? gameOver(vm, s) : ''}
    </div>`;
}

// ── 開始畫面 ──

function startScreen(): string {
  const factions = (['dawn', 'dusk'] as const)
    .map((f) => {
      const info = FACTIONS[f];
      const icons = cardsOf(f)
        .filter((d) => d.type === 'unit')
        .map((d) => `<span>${d.icon}</span>`)
        .join('');
      return `
        <button class="faction-card ${f}" data-action="start" data-faction="${f}">
          <span class="crest">${info.icon}</span>
          <span class="f-name">${info.name}</span>
          <span class="f-blurb">${info.blurb}</span>
          <span class="f-icons">${icons}</span>
          <span class="f-cta">扮演這個陣營 →</span>
        </button>`;
    })
    .join('');
  return `
    <div class="start">
      <div class="start-inner">
        <p class="eyebrow">一局 10～15 分鐘的奇幻卡牌對戰</p>
        <h1 class="title">晨昏戰線<span>Duskline</span></h1>
        <p class="lede">白晝與黑夜每回合交替。雙方同時把牌蓋在三條戰線上，揭曉後自動交戰。先摧毀對手兩座塔的一方獲勝。</p>
        <div class="factions">${factions}</div>
        <button class="btn link" data-action="rules">先看規則</button>
      </div>
    </div>`;
}

// ── 頂列：回合與晝夜進度 ──

function topbar(vm: ViewModel, s: GameState): string {
  const pips: string[] = [];
  for (let r = 1; r <= RULES.maxRounds; r++) {
    let phase: Phase = phaseOfRound(s, r);
    let locked = false;
    if (r === s.round) phase = s.phase;
    if (r === s.round + 1 && s.nextPhase) {
      phase = s.nextPhase;
      locked = true;
    }
    const when = r < s.round ? 'past' : r === s.round ? 'now' : '';
    const title = `第 ${r} 回合：${phaseName(phase)}${locked ? '（已鎖定）' : ''}`;
    pips.push(`<span class="pip ${phase} ${when} ${locked ? 'locked' : ''}" title="${title}">${phase === 'day' ? '☀' : '☾'}</span>`);
  }
  const first = s.initiative === vm.me;
  return `
    <header class="topbar">
      <div class="brand"><span class="brand-zh">晨昏戰線</span><span class="brand-en">Duskline</span></div>
      <div class="round-label">第 ${s.round} / ${RULES.maxRounds} 回合</div>
      <div class="track" aria-label="晝夜進度">${pips.join('')}</div>
      <div class="initiative ${first ? 'mine' : 'theirs'}"
           title="${first ? '你先揭曉：對手的晝夜法術會蓋掉你的' : '對手先揭曉：你的晝夜法術會蓋掉對手的'}">
        ${first ? '你先揭曉' : '對手先揭曉'}
      </div>
      <div class="top-actions">
        <button class="btn" data-action="rules">規則</button>
        <button class="btn" data-action="restart">新對局</button>
      </div>
    </header>`;
}

function opponentStrip(vm: ViewModel, s: GameState): string {
  const opp = other(vm.me);
  const side = s.sides[opp];
  const info = FACTIONS[vm.factions[opp]];
  const backs = side.hand.map(() => '<i class="back"></i>').join('');
  return `
    <section class="strip">
      <div class="who"><span class="crest ${vm.factions[opp]}">${info.icon}</span>${info.name}<small>對手</small></div>
      <div class="counts">
        <span class="backs" title="對手手牌 ${side.hand.length} 張">${backs}</span>
        <span>手牌 ${side.hand.length}</span><span>牌庫 ${side.deck.length}</span>
      </div>
    </section>`;
}

// ── 戰場 ──

function board(vm: ViewModel, s: GameState): string {
  const combat = vm.fx?.t === 'combat' ? 'fx-combat' : '';
  const caption = vm.caption ? `<div class="caption" role="status">${vm.caption}</div>` : '';
  return `<section class="board ${combat}">${LANES.map((lane) => laneColumn(vm, s, lane)).join('')}${caption}</section>`;
}

function laneColumn(vm: ViewModel, s: GameState, lane: Lane): string {
  const opp = other(vm.me);
  const mine = s.sides[vm.me].lanes[lane];
  const theirs = s.sides[opp].lanes[lane];

  const ghosts = vm.draft.plays
    .map((play, i) => ({ play, i, def: defOfHand(s, vm.me, play.uid) }))
    .filter(({ play }) => play.lane === lane);
  const unitGhosts = ghosts.filter(({ def }) => def.type === 'unit');
  const spellGhosts = ghosts.filter(({ def }) => def.type === 'spell');

  const droppable = vm.selected !== null && !vm.busy ? 'droppable' : '';
  const free = RULES.laneCapacity - mine.length - unitGhosts.length;

  return `
    <div class="lane">
      ${tower(vm, s, opp, lane)}
      <div class="units theirs">
        ${theirs.map((u) => unitTile(vm, s, opp, u)).join('')}
        ${slots(RULES.laneCapacity - theirs.length)}
      </div>
      <div class="lane-divider"><span>${LANE_NAMES[lane]}</span></div>
      ${spellGhosts.length ? `<div class="lane-spells">${spellGhosts.map(({ play, i, def }) => ghostChip(play.uid, i, def)).join('')}</div>` : ''}
      <div class="units mine ${droppable}" data-action="lane" data-lane="${lane}">
        ${mine.map((u) => unitTile(vm, s, vm.me, u)).join('')}
        ${unitGhosts.map(({ play, i, def }) => ghostTile(play.uid, i, def)).join('')}
        ${slots(free)}
      </div>
      ${tower(vm, s, vm.me, lane)}
    </div>`;
}

function slots(n: number): string {
  return '<div class="slot"></div>'.repeat(Math.max(0, n));
}

function unitTile(vm: ViewModel, s: GameState, seat: Seat, unit: Unit): string {
  const def = getDef(unit.defId);
  const fx = unitFx(vm.fx, unit.uid);
  const hurt = unit.hp < unit.maxHp ? 'hurt' : '';
  return `
    <div class="unit ${vm.factions[seat]} ${fx.cls}" title="${tooltip(def)}">
      <span class="u-icon">${def.icon}</span>
      <span class="u-name">${def.name}</span>
      ${tags(def)}
      <span class="u-atk">${atkPair(def, s.phase)}</span>
      <span class="u-hp ${hurt}">❤${unit.hp}</span>
      ${fx.float}
    </div>`;
}

function ghostTile(uid: number, order: number, def: CardDef): string {
  return `
    <button class="unit ghost" data-action="unplay" data-uid="${uid}" title="點一下收回「${def.name}」">
      <span class="order">${order + 1}</span>
      <span class="u-icon">${def.icon}</span>
      <span class="u-name">${def.name}</span>
      <span class="x">✕</span>
    </button>`;
}

function ghostChip(uid: number, order: number, def: CardDef): string {
  return `
    <button class="chip" data-action="unplay" data-uid="${uid}" title="點一下收回「${def.name}」">
      <span class="order">${order + 1}</span>${def.icon} ${def.name}<span class="x">✕</span>
    </button>`;
}

function tower(vm: ViewModel, s: GameState, seat: Seat, lane: Lane): string {
  const hp = s.sides[seat].towers[lane];
  const fx = towerFx(vm.fx, seat, lane);
  const pct = (hp / RULES.towerHp) * 100;
  const owner = seat === vm.me ? 'mine' : 'theirs';
  return `
    <div class="tower ${owner} ${hp <= 0 ? 'destroyed' : ''} ${fx.cls}" title="${seat === vm.me ? '你的' : '對手的'}${LANE_NAMES[lane]}塔">
      <span class="t-icon">${hp <= 0 ? '💥' : '🏰'}</span>
      <span class="t-bar"><i style="width:${pct}%"></i></span>
      <span class="t-hp">${hp}</span>
      ${fx.float}
    </div>`;
}

// ── 控制列與手牌 ──

function controls(vm: ViewModel, s: GameState): string {
  const total = manaFor(s) + (vm.draft.burn !== undefined ? 1 : 0);
  const spent = planCost(s, vm.me, vm.draft);
  const gems = Array.from({ length: total }, (_, i) => {
    const burnGem = vm.draft.burn !== undefined && i === total - 1;
    return `<i class="gem ${i < spent ? 'spent' : ''} ${burnGem ? 'burn' : ''}"></i>`;
  }).join('');

  const globals = vm.draft.plays
    .map((play, i) => ({ play, i, def: defOfHand(s, vm.me, play.uid) }))
    .filter(({ def }) => def.type === 'spell' && def.target === 'global')
    .map(({ play, i, def }) => ghostChip(play.uid, i, def))
    .join('');

  const burnDef = vm.draft.burn !== undefined ? defOfHand(s, vm.me, vm.draft.burn) : null;
  const burnArmed = vm.selected !== null && !burnDef ? 'armed' : '';
  const burn = `
    <button class="btn burn ${burnDef ? 'set' : ''} ${burnArmed}" data-action="burn" ${vm.busy ? 'disabled' : ''}
            title="每回合可以把一張手牌移出遊戲，換這回合 +1 魔力">
      🔥 ${burnDef ? `焚卷：${burnDef.name} ✕` : '焚卷'}
    </button>`;

  const msg = vm.message ?? { text: hint(vm, s), error: false };
  const empty = vm.draft.plays.length === 0 && vm.draft.burn === undefined;
  const buttons = vm.busy
    ? '<button class="btn" data-action="skip">⏩ 快轉</button>'
    : `<button class="btn" data-action="clear" ${empty ? 'disabled' : ''}>全部收回</button>
       <button class="btn primary" data-action="confirm" ${s.winner !== null ? 'disabled' : ''}>揭曉 ▶</button>`;

  return `
    <section class="controls">
      <div class="mana" title="第 N 回合有 N 點魔力">
        <span class="label">魔力</span><span class="gems">${gems}</span>
        <span class="num">${total - spent} / ${total}</span>
      </div>
      ${globals ? `<div class="tray">${globals}</div>` : ''}
      ${burn}
      <div class="hint ${msg.error ? 'error' : ''}" role="status">${msg.text}</div>
      <div class="deck-count">牌庫 ${s.sides[vm.me].deck.length}</div>
      <div class="buttons">${buttons}</div>
    </section>`;
}

function hint(vm: ViewModel, s: GameState): string {
  if (vm.busy) return '結算中……';
  if (s.winner !== null) return '對局結束';
  if (vm.selected !== null) {
    const def = defOfHand(s, vm.me, vm.selected);
    if (def.type === 'spell' && def.target === 'global') return `點任一條我方戰線施放「${def.name}」（作用於全場），或按焚卷`;
    return `點一條我方戰線放下「${def.name}」，或按焚卷換 1 點魔力`;
  }
  if (vm.draft.plays.length > 0) return '準備好就按「揭曉」。點虛線的牌可以收回';
  return '選一張手牌，再點要放的戰線';
}

function hand(vm: ViewModel, s: GameState): string {
  const used = new Set(vm.draft.plays.map((p) => p.uid));
  if (vm.draft.burn !== undefined) used.add(vm.draft.burn);
  const left = manaLeft(s, vm.me, vm.draft);
  const available = s.sides[vm.me].hand.filter((c) => !used.has(c.uid));
  // 焚卷要犧牲「另一張」牌，所以手上至少要有兩張
  const canBurn = vm.draft.burn === undefined && available.length >= 2 ? 1 : 0;

  const cards = available
    .map((c) => {
      const def = getDef(c.defId);
      const needsBurn = def.cost > left && def.cost <= left + canBurn;
      const cls = [
        'card',
        vm.factions[vm.me],
        vm.selected === c.uid ? 'selected' : '',
        def.cost > left + canBurn ? 'unaffordable' : '',
        needsBurn ? 'needs-burn' : '',
      ].join(' ');
      const stats =
        def.type === 'unit'
          ? `<span class="c-stats">${atkPair(def, s.phase)}<b class="hp">❤${def.hp}</b></span>`
          : '<span class="c-stats spell">法術</span>';
      return `
        <button class="${cls}" data-action="select" data-uid="${c.uid}" ${vm.busy ? 'disabled' : ''} title="${tooltip(def)}">
          <span class="c-cost">${def.cost}</span>
          ${needsBurn ? '<span class="c-burn" title="要先焚卷一張牌才出得起">🔥</span>' : ''}
          <span class="c-icon">${def.icon}</span>
          <span class="c-name">${def.name}</span>
          ${stats}
          <span class="c-text">${def.text}</span>
        </button>`;
    })
    .join('');
  return `<section class="hand" aria-label="你的手牌">${cards || '<p class="empty-hand">手牌都排進佈署了</p>'}</section>`;
}

// ── 戰況與結果 ──

function logPanel(vm: ViewModel): string {
  const items = vm.log
    .slice(-200)
    .map((l) => `<li class="${l.kind}">${l.text}</li>`)
    .join('');
  return `<aside class="log"><h2>戰況</h2><ol class="log-list">${items}</ol></aside>`;
}

function gameOver(vm: ViewModel, s: GameState): string {
  const opp = other(vm.me);
  const outcome = s.winner === 'draw' ? 'draw' : s.winner === vm.me ? 'win' : 'lose';
  const title = { win: '勝利', lose: '落敗', draw: '平手' }[outcome];
  const icon = { win: '🏆', lose: '🏳️', draw: '⚖️' }[outcome];
  return `
    <div class="overlay">
      <div class="panel result ${outcome}" role="dialog" aria-label="對局結果">
        <div class="result-icon">${icon}</div>
        <h2>${title}</h2>
        <p>第 ${s.round} 回合結束<br>塔的總生命：你 ${towerTotal(s, vm.me)}，對手 ${towerTotal(s, opp)}</p>
        <div class="row">
          <button class="btn primary" data-action="rematch">再戰一局</button>
          <button class="btn" data-action="restart">換陣營</button>
        </div>
      </div>
    </div>`;
}

// ── 小工具 ──

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function defOfHand(s: GameState, seat: Seat, uid: number): CardDef {
  const card = s.sides[seat].hand.find((c) => c.uid === uid);
  if (!card) throw new Error(`手牌中找不到 uid ${uid}`);
  return getDef(card.defId);
}

function atkPair(def: CardDef, phase: Phase): string {
  return `<b class="${phase === 'day' ? 'on' : ''}">☀${attackOf(def, 'day')}</b><b class="${phase === 'night' ? 'on' : ''}">☾${attackOf(def, 'night')}</b>`;
}

function tags(def: CardDef): string {
  const list: string[] = [];
  if (def.keywords?.guard) list.push(`守護${def.keywords.guard}`);
  if (def.keywords?.ambush) list.push('突襲');
  if (def.keywords?.lifesteal) list.push('吸血');
  if (def.effects?.some((e) => e.on === 'death')) list.push('亡語');
  return list.map((t) => `<span class="tag">${t}</span>`).join('');
}

function tooltip(def: CardDef): string {
  const stats = def.type === 'unit' ? ` ☀${def.dayAtk} ☾${def.nightAtk} ❤${def.hp}` : '';
  return `${def.name}（${def.cost} 費${stats}）${def.text ? `：${def.text}` : ''}`;
}

function unitFx(e: GameEvent | null, uid: number): { cls: string; float: string } {
  if (!e) return { cls: '', float: '' };
  if ((e.t === 'play' || e.t === 'summon') && e.uid === uid) return { cls: 'fx-reveal', float: '' };
  if (e.t === 'unitDamage' && e.uid === uid) return { cls: 'fx-hit', float: `<span class="float dmg">−${e.amount}</span>` };
  if (e.t === 'unitHeal' && e.uid === uid) return { cls: 'fx-heal', float: `<span class="float heal">+${e.amount}</span>` };
  return { cls: '', float: '' };
}

function towerFx(e: GameEvent | null, seat: Seat, lane: Lane): { cls: string; float: string } {
  if (!e || !('seat' in e) || e.seat !== seat || !('lane' in e) || e.lane !== lane) return { cls: '', float: '' };
  if (e.t === 'towerDamage') {
    const text = e.amount > 0 ? `−${e.amount}` : '🛡';
    return { cls: 'fx-hit', float: `<span class="float dmg">${text}</span>` };
  }
  if (e.t === 'repair') return { cls: 'fx-heal', float: `<span class="float heal">+${e.amount}</span>` };
  if (e.t === 'towerDestroyed') return { cls: 'fx-destroyed', float: '' };
  return { cls: '', float: '' };
}
