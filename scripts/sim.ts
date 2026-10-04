// 平衡報告：node scripts/sim.ts [局數] [陣營A 陣營B]
// 不指定陣營時，三個陣營兩兩對打
import { runSeries } from '../src/ai/selfplay.ts';
import { FACTIONS, type PlayableFaction } from '../src/engine/index.ts';

const games = Number(process.argv[2] ?? 1000);
const pairs: [PlayableFaction, PlayableFaction][] =
  process.argv[3] && process.argv[4]
    ? [[process.argv[3] as PlayableFaction, process.argv[4] as PlayableFaction]]
    : [
        ['dawn', 'dusk'],
        ['dawn', 'orbit'],
        ['dusk', 'orbit'],
      ];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

for (const pair of pairs) {
  for (const f of pair) if (!FACTIONS[f]) throw new Error(`未知的陣營：${f}（可用：${Object.keys(FACTIONS).join('、')}）`);
  const start = performance.now();
  const r = runSeries(games, 1, pair);
  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  const decided = r.games - r.draws;

  console.log(`\n${FACTIONS[pair[0]].name} vs ${FACTIONS[pair[1]].name}（${r.games} 局，${seconds} 秒）`);
  console.log('─'.repeat(40));
  for (const f of pair) console.log(`${FACTIONS[f].name}勝率  ${pct(r.wins[f] / decided)}  (${r.wins[f]} 勝)`);
  console.log(`平手             ${r.draws} 局`);
  console.log(`平均回合數       ${r.avgRounds.toFixed(2)}`);
  console.log(`提前摧毀兩塔     ${pct(r.earlyRate)}`);
  console.log(`首回合主動權勝率 ${pct(r.firstInitiativeWinRate)}`);
  console.log(`座位 0 勝率      ${pct(r.seat0WinRate)}`);
}
