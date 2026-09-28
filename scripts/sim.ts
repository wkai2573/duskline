// 平衡報告：node scripts/sim.ts [局數]
import { runSeries } from '../src/ai/selfplay.ts';

const games = Number(process.argv[2] ?? 1000);
const start = performance.now();
const r = runSeries(games);
const seconds = ((performance.now() - start) / 1000).toFixed(1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const decided = r.games - r.draws;

console.log(`\n晨昏戰線 平衡報告（${r.games} 局，${seconds} 秒）`);
console.log('─'.repeat(40));
console.log(`晨曦騎士團勝率   ${pct(r.wins.dawn / decided)}  (${r.wins.dawn} 勝)`);
console.log(`暮影盟約勝率     ${pct(r.wins.dusk / decided)}  (${r.wins.dusk} 勝)`);
console.log(`平手             ${r.draws} 局`);
console.log(`平均回合數       ${r.avgRounds.toFixed(2)}`);
console.log(`提前摧毀兩塔     ${pct(r.earlyRate)}`);
console.log(`首回合主動權勝率 ${pct(r.firstInitiativeWinRate)}`);
console.log(`座位 0 勝率      ${pct(r.seat0WinRate)}`);
