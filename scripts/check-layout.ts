// 版面穩定檢查：node scripts/check-layout.ts
// 放法術、焚卷之後，戰場、控制列和手牌的位置不應該跳動（不然點下一張牌時，滑鼠底下的東西已經不是原本那張了）。
// 需要本機有 Chrome / Chromium；找不到時可以用環境變數 CHROME_PATH 指定。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const VIEWPORTS = [
  { name: '桌面', width: 1280, height: 900 },
  { name: '窄螢幕（控制列預留高度）', width: 800, height: 900 },
  { name: '手機', width: 390, height: 844 },
];

// 位置不能變的東西。「送出」按鈕在窄螢幕會在預留的控制列裡換位置，這是設計內的，所以不檢查。
const STABLE_KEYS = ['board_h', 'lane_h', 'controls_top', 'controls_h', 'hand_top'] as const;
type Layout = Record<(typeof STABLE_KEYS)[number], number | number[] | null>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('找不到 Chrome：請安裝，或用環境變數 CHROME_PATH 指定執行檔路徑');
  return found;
}

// 最小的 CDP 用戶端：只做這支腳本需要的事
async function connect(port: number) {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 50 && !targets.some((t) => t.type === 'page'); i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      /* Chrome 還沒準備好 */
    }
    if (!targets.some((t) => t.type === 'page')) await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('連不上 Chrome 的分頁');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('CDP 連線失敗'));
  });
  let nextId = 0;
  const pending = new Map<number, (msg: { result?: unknown; error?: unknown }) => void>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value as T;
  };
  return { send, evaluate, close: () => ws.close() };
}
type Cdp = Awaited<ReturnType<typeof connect>>;

const CLICK_BY_TEXT = (text: string) =>
  `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)})); if (b) b.click(); })()`;

const MEASURE = `(() => {
  const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
  return {
    board_h: Math.round(rect('.board')?.height ?? -1),
    lane_h: [...document.querySelectorAll('.lane')].map((l) => Math.round(l.getBoundingClientRect().height)),
    controls_top: Math.round(rect('.controls')?.top ?? -1),
    controls_h: Math.round(rect('.controls')?.height ?? -1),
    hand_top: Math.round(rect('.hand')?.top ?? -1),
  };
})()`;

async function startGame(cdp: Cdp) {
  await cdp.evaluate(CLICK_BY_TEXT('開始吧')); // 第一次進來的規則視窗
  await sleep(200);
  await cdp.evaluate(`document.querySelector('[data-action="start"][data-faction="dawn"]').click()`);
  await sleep(400);
  await cdp.evaluate(CLICK_BY_TEXT('開始吧')); // 開局的說明
  await sleep(200);
}

// 回傳「焚卷、放法術」三個時間點的版面。起手沒有 2 費法術的話就重開一局
async function runScenario(cdp: Cdp, width: number, height: number, url: string) {
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  await sleep(1200);
  await startGame(cdp);

  const hasSpell = `!![...document.querySelectorAll('.card')].find(c => c.querySelector('.c-stats.spell') && /2/.test(c.querySelector('.c-cost').textContent))`;
  let found = false;
  for (let i = 0; i < 40 && !(found = await cdp.evaluate<boolean>(hasSpell)); i++) {
    await cdp.evaluate(`document.querySelector('[data-action="restart"]').click()`);
    await sleep(250);
    await cdp.evaluate(`document.querySelector('[data-action="start"][data-faction="dawn"]').click()`);
    await sleep(400);
    await cdp.evaluate(CLICK_BY_TEXT('開始吧'));
    await sleep(200);
  }
  if (!found) throw new Error('重開了 40 局都沒有抽到 2 費法術');

  const before = await cdp.evaluate<Layout>(MEASURE);

  // 第 1 回合只有 1 點魔力：先挑一張別的牌焚卷，湊到 2 點魔力
  const spellName = await cdp.evaluate<string>(`(() => {
    const cards = [...document.querySelectorAll('.card')];
    const spell = cards.find(c => c.querySelector('.c-stats.spell') && /2/.test(c.querySelector('.c-cost').textContent));
    cards.find(c => c !== spell).click();
    document.querySelector('[data-action="burn"]').click();
    return spell.querySelector('.c-name').textContent;
  })()`);
  await sleep(250);
  const afterBurn = await cdp.evaluate<Layout>(MEASURE);

  await cdp.evaluate(`[...document.querySelectorAll('.card')].find(c => c.querySelector('.c-name').textContent === ${JSON.stringify(spellName)}).click()`);
  await sleep(150);
  const selecting = await cdp.evaluate<Layout>(MEASURE);
  await cdp.evaluate(`document.querySelector('.units.mine[data-lane="1"]').click()`);
  await sleep(250);
  const after = await cdp.evaluate<Layout>(MEASURE);

  // 防止「根本沒放成功」造成的假通過
  const placed = await cdp.evaluate<number>(`document.querySelectorAll('.chip').length`);
  if (placed < 1) throw new Error(`法術「${spellName}」沒有真的放進戰場，這次量測無效`);

  return { before, afterBurn, selecting, after };
}

function diff(a: Layout, b: Layout): string[] {
  return STABLE_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(
    (k) => `${k}：${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`,
  );
}

const server = await createServer({ logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
const profile = mkdtempSync(join(tmpdir(), 'duskline-layout-'));
let chrome: ReturnType<typeof spawn> | undefined;
let cdp: Cdp | undefined;
let failures = 0;

try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('開發伺服器沒有回報網址');

  chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      ...(process.env.CI ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // 通訊埠由 Chrome 自己挑，寫在這個檔案的第一行
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome 沒有在時限內啟動');
  cdp = await connect(Number(readFileSync(portFile, 'utf8').split('\n')[0]));

  for (const vp of VIEWPORTS) {
    const r = await runScenario(cdp, vp.width, vp.height, url);
    const problems = [
      ...diff(r.before, r.afterBurn).map((d) => `焚卷後 ${d}`),
      ...diff(r.afterBurn, r.selecting).map((d) => `選牌後 ${d}`),
      ...diff(r.selecting, r.after).map((d) => `放法術後 ${d}`),
    ];
    if (problems.length) {
      failures++;
      console.log(`✗ ${vp.name} ${vp.width}×${vp.height}`);
      for (const p of problems) console.log(`    ${p}`);
    } else {
      console.log(`✓ ${vp.name} ${vp.width}×${vp.height}  戰場 ${r.after.board_h}px，沒有位移`);
    }
  }
} catch (e) {
  failures++;
  console.error(e instanceof Error ? e.message : e);
} finally {
  cdp?.close();
  chrome?.kill();
  await server.close();
  await sleep(300); // 等 Chrome 放掉設定檔
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(failures ? `\n版面檢查失敗` : `\n版面穩定`);
process.exit(failures ? 1 : 0);
