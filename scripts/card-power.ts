// 逐張牌的強度分析：node scripts/card-power.ts [陣營] [每個對手的局數]
// 做法：把陣營牌組裡某一種卡（兩張）換成「同費用的白板單位」，看陣營勝率變多少。
// 白板：☀☾ 都是費用，生命 = 費用 + 1（平均攻擊＋生命 = 2N+1，也就是規則書的數值基準）。
// 變化是正的，代表那張牌比白板還弱；負的代表比白板強。同一組種子配對比較，雜訊比單純跑兩次小。
import { choosePlan } from '../src/ai/greedy.ts';
import {
  CARDS,
  FACTIONS,
  PLAYABLE_FACTIONS,
  PRESET_DECKS,
  cardsOf,
  newGame,
  resolveRound,
  type CardDef,
  type PlayableFaction,
} from '../src/engine/index.ts';

const faction = (process.argv[2] ?? 'orbit') as PlayableFaction;
const games = Number(process.argv[3] ?? 1000);
if (!FACTIONS[faction]) throw new Error(`未知的陣營：${faction}`);
const opponents = PLAYABLE_FACTIONS.filter((f) => f !== faction);

// 白板單位寫進卡表（只在這支腳本的行程裡）
for (let n = 0; n <= 6; n++) {
  (CARDS as Record<string, CardDef>)[`ref${n}`] = {
    id: `ref${n}`, name: `白板${n}`, faction: 'token', type: 'unit', cost: n,
    dayAtk: n, nightAtk: n, hp: n + 1, icon: '▫️', text: '',
  };
}

/** replace：{卡片 id → 換成的 id}；回傳 faction 的勝率（平手不算） */
function winRate(replace: Record<string, string>): number {
  let wins = 0, decided = 0;
  for (const opp of opponents) {
    for (let i = 0; i < games; i++) {
      const seat = i % 2;
      const decks = seat === 0 ? [PRESET_DECKS[faction], PRESET_DECKS[opp]] : [PRESET_DECKS[opp], PRESET_DECKS[faction]];
      let s = newGame({ seed: 1 + i, decks: decks as [string[], string[]] });
      const side = s.sides[seat];
      for (const card of [...side.deck, ...side.hand]) card.defId = replace[card.defId] ?? card.defId;
      while (s.winner === null) s = resolveRound(s, [choosePlan(s, 0), choosePlan(s, 1)], { validate: false }).state;
      if (s.winner === 'draw') continue;
      decided++;
      if (s.winner === seat) wins++;
    }
  }
  return wins / decided;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const base = winRate({});
console.log(`\n${FACTIONS[faction].name}對${opponents.map((o) => FACTIONS[o].name).join('、')}，每個對手 ${games} 局`);
console.log(`原本的勝率 ${pct(base)}\n`);
console.log('換成同費用白板後的勝率變化（負的＝那張牌比白板強）');
console.log('─'.repeat(50));
const rows: { name: string; delta: number }[] = [];
for (const def of cardsOf(faction)) {
  const delta = winRate({ [def.id]: `ref${def.cost}` }) - base;
  rows.push({ name: `${def.name}（${def.cost} 費）`, delta });
}
for (const r of rows.sort((a, b) => a.delta - b.delta)) {
  const bar = '█'.repeat(Math.round(Math.abs(r.delta) * 100));
  console.log(`${r.name.padEnd(14, '　')} ${(r.delta >= 0 ? '+' : '') + (r.delta * 100).toFixed(1).padStart(5)}%  ${r.delta < 0 ? '強 ' : '弱 '}${bar}`);
}
