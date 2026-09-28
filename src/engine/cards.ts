import { RULES, type CardDef, type Faction, type Phase } from './types.ts';

/**
 * 卡表。新增卡片只要在這裡加一筆資料；
 * 只有用到新的效果類型時，才需要在 effects.ts 加處理函式。
 *
 * 數值基準：N 費單位的「平均攻擊（☀☾ 取平均）+ 生命」大約是 2N+1，能力另外折算。
 */
const DEFS: CardDef[] = [
  // ── 晨曦騎士團：白天強勢，擅長守護和修復塔 ──
  {
    id: 'squire', name: '見習侍從', faction: 'dawn', type: 'unit', cost: 1,
    dayAtk: 2, nightAtk: 1, hp: 2, icon: '🗡️', text: '',
  },
  {
    id: 'shieldbearer', name: '盾衛', faction: 'dawn', type: 'unit', cost: 2,
    dayAtk: 1, nightAtk: 1, hp: 5, keywords: { guard: 1 }, icon: '🛡️',
    text: '守護 1：此路我方塔受到的傷害 −1。',
  },
  {
    id: 'archer', name: '晨曦弓手', faction: 'dawn', type: 'unit', cost: 2,
    dayAtk: 3, nightAtk: 1, hp: 2, icon: '🏹',
    effects: [{ on: 'reveal', do: 'damageFront', amount: 1 }],
    text: '揭曉：對此路最前方的敵人造成 1 點傷害。',
  },
  {
    id: 'sister', name: '聖光修女', faction: 'dawn', type: 'unit', cost: 3,
    dayAtk: 1, nightAtk: 1, hp: 3, icon: '✨',
    effects: [{ on: 'reveal', do: 'repairTower', amount: 4 }],
    text: '揭曉：修復此路我方塔 4 點。',
  },
  {
    id: 'griffon', name: '獅鷲騎兵', faction: 'dawn', type: 'unit', cost: 3,
    dayAtk: 3, nightAtk: 2, hp: 3, keywords: { ambush: true }, icon: '🦅',
    text: '突襲：攻擊直接打塔。',
  },
  {
    id: 'knight', name: '王國騎士', faction: 'dawn', type: 'unit', cost: 4,
    dayAtk: 4, nightAtk: 3, hp: 5, icon: '⚔️', text: '',
  },
  {
    id: 'paladin', name: '破曉聖騎', faction: 'dawn', type: 'unit', cost: 5,
    dayAtk: 6, nightAtk: 2, hp: 6, icon: '🌞',
    effects: [{ on: 'reveal', if: 'day', do: 'damageFront', amount: 3 }],
    text: '揭曉（白晝）：對此路最前方的敵人造成 3 點傷害。',
  },
  {
    id: 'daybreak', name: '破曉', faction: 'dawn', type: 'spell', cost: 2, target: 'global', icon: '🌅',
    effects: [
      { on: 'reveal', do: 'setPhase', phase: 'day' },
      { on: 'reveal', do: 'draw', amount: 1 },
    ],
    text: '本回合變為白晝，抽 1 張牌。',
  },
  {
    id: 'judgment', name: '聖光審判', faction: 'dawn', type: 'spell', cost: 2, target: 'lane', icon: '⚖️',
    effects: [{ on: 'reveal', do: 'damageLane', amount: 2 }],
    text: '指定一路：對該路所有敵方單位造成 2 點傷害。',
  },
  {
    id: 'rally', name: '集結號角', faction: 'dawn', type: 'spell', cost: 2, target: 'lane', icon: '📯',
    effects: [{ on: 'reveal', do: 'summon', token: 'militia', amount: 2 }],
    text: '指定一路：召喚 2 個民兵（☀1 ☾1 生命 1）。',
  },

  // ── 暮影盟約：夜晚強勢，會吸血、會復生 ──
  {
    id: 'skeleton', name: '骷髏兵', faction: 'dusk', type: 'unit', cost: 1,
    dayAtk: 1, nightAtk: 2, hp: 1, icon: '💀',
    effects: [{ on: 'death', if: 'night', do: 'returnToHand' }],
    text: '亡語（黑夜）：回到手牌。',
  },
  {
    id: 'bats', name: '蝙蝠群', faction: 'dusk', type: 'unit', cost: 2,
    dayAtk: 1, nightAtk: 3, hp: 2, keywords: { ambush: true }, icon: '🦇',
    text: '突襲：攻擊直接打塔。',
  },
  {
    id: 'werewolf', name: '狼人村民', faction: 'dusk', type: 'unit', cost: 2,
    dayAtk: 1, nightAtk: 3, hp: 3, icon: '🐺', text: '',
  },
  {
    id: 'ghoul', name: '食屍鬼', faction: 'dusk', type: 'unit', cost: 3,
    dayAtk: 2, nightAtk: 3, hp: 3, icon: '🧟',
    effects: [{ on: 'death', do: 'damageFront', amount: 2 }],
    text: '亡語：對此路最前方的敵人造成 2 點傷害。',
  },
  {
    id: 'necromancer', name: '死靈法師', faction: 'dusk', type: 'unit', cost: 3,
    dayAtk: 1, nightAtk: 2, hp: 3, icon: '🔮',
    effects: [{ on: 'reveal', do: 'summon', token: 'corpse', amount: 1 }],
    text: '揭曉：在此路召喚 1 個亡骸（☀1 ☾1 生命 2）。',
  },
  {
    id: 'assassin', name: '暗影刺客', faction: 'dusk', type: 'unit', cost: 3,
    dayAtk: 1, nightAtk: 3, hp: 2, icon: '🔪',
    effects: [{ on: 'reveal', if: 'night', do: 'damageFront', amount: 3 }],
    text: '揭曉（黑夜）：對此路最前方的敵人造成 3 點傷害。',
  },
  {
    id: 'count', name: '吸血伯爵', faction: 'dusk', type: 'unit', cost: 4,
    dayAtk: 2, nightAtk: 5, hp: 4, keywords: { lifesteal: true }, icon: '🧛',
    text: '吸血：交戰結束時若仍存活，回復等同目前攻擊力的生命。',
  },
  {
    id: 'alpha', name: '月下狼王', faction: 'dusk', type: 'unit', cost: 5,
    dayAtk: 3, nightAtk: 6, hp: 6, icon: '🌕', text: '',
  },
  {
    id: 'nightfall', name: '夜幕降臨', faction: 'dusk', type: 'spell', cost: 2, target: 'global', icon: '🌙',
    effects: [
      { on: 'reveal', do: 'setPhase', phase: 'night' },
      { on: 'reveal', do: 'draw', amount: 1 },
    ],
    text: '本回合變為黑夜，抽 1 張牌。',
  },
  {
    id: 'eternal', name: '永夜', faction: 'dusk', type: 'spell', cost: 3, target: 'global', icon: '🌑',
    effects: [
      { on: 'reveal', do: 'setPhase', phase: 'night' },
      { on: 'reveal', do: 'lockNextPhase', phase: 'night' },
    ],
    text: '本回合與下回合都是黑夜。',
  },

  // ── 衍生物：只會被召喚，不能放進牌組 ──
  {
    id: 'militia', name: '民兵', faction: 'token', type: 'unit', cost: 0,
    dayAtk: 1, nightAtk: 1, hp: 1, icon: '🔱', text: '衍生物。',
  },
  {
    id: 'corpse', name: '亡骸', faction: 'token', type: 'unit', cost: 0,
    dayAtk: 1, nightAtk: 1, hp: 2, icon: '⚰️', text: '衍生物。',
  },
];

export const CARDS: Readonly<Record<string, CardDef>> = Object.fromEntries(DEFS.map((d) => [d.id, d]));

export function getDef(id: string): CardDef {
  const def = CARDS[id];
  if (!def) throw new Error(`未知的卡片：${id}`);
  return def;
}

export function attackOf(def: CardDef, phase: Phase): number {
  return (phase === 'day' ? def.dayAtk : def.nightAtk) ?? 0;
}

export type PlayableFaction = Exclude<Faction, 'token'>;

export const FACTIONS: Record<PlayableFaction, { name: string; icon: string; blurb: string }> = {
  dawn: { name: '晨曦騎士團', icon: '☀', blurb: '白天強勢，擅長守護和修復塔。' },
  dusk: { name: '暮影盟約', icon: '☾', blurb: '夜晚強勢，會吸血、會復生。' },
};

export function cardsOf(faction: PlayableFaction): CardDef[] {
  return DEFS.filter((d) => d.faction === faction);
}

/** 預設牌組：陣營裡每種卡各 2 張，剛好 20 張 */
export const PRESET_DECKS: Record<PlayableFaction, string[]> = {
  dawn: cardsOf('dawn').flatMap((d) => [d.id, d.id]),
  dusk: cardsOf('dusk').flatMap((d) => [d.id, d.id]),
};

/** 構築規則驗證；合法時回傳 null，否則回傳原因 */
export function validateDeck(ids: string[]): string | null {
  if (ids.length !== RULES.deckSize) return `牌組必須剛好 ${RULES.deckSize} 張（目前 ${ids.length} 張）`;
  const counts = new Map<string, number>();
  for (const id of ids) {
    const def = CARDS[id];
    if (!def) return `未知的卡片：${id}`;
    if (def.faction === 'token') return `「${def.name}」是衍生物，不能放進牌組`;
    const n = (counts.get(id) ?? 0) + 1;
    if (n > RULES.maxCopies) return `「${def.name}」超過 ${RULES.maxCopies} 張`;
    counts.set(id, n);
  }
  return null;
}
