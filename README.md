# 晨昏戰線 Duskline

一局 10～15 分鐘的網頁卡牌對戰。白晝與黑夜每回合交替，每張卡都有白天和夜晚兩種攻擊力。
雙方同時把牌蓋在三條戰線上，揭曉後自動交戰，先摧毀對手兩座塔的一方獲勝。

完整規則見 [docs/RULES.md](docs/RULES.md)。

## 執行

需要 Node.js 22.18 以上（`npm run sim` 直接用 Node 執行 TypeScript）。

```bash
npm install
npm run dev      # 開發伺服器，打開終端機顯示的網址
npm test         # 單元測試 + AI 對 AI 模擬
npm run sim      # 平衡報告，預設 1000 局：npm run sim -- 3000
npm run build    # 輸出到 dist/，可以直接放上任何靜態網站
```

## 專案結構

```
src/
├── engine/          規則引擎：純 TypeScript，不碰 DOM
│   ├── types.ts     型別與規則常數（塔的生命、回合上限…）
│   ├── rng.ts       可重現的亂數產生器
│   ├── cards.ts     卡表（純資料）與構築驗證
│   ├── board.ts     底層盤面操作：抽牌、傷害、召喚
│   ├── effects.ts   效果處理表、陣亡與亡語
│   ├── actions.ts   佈署驗證
│   ├── reveal.ts    揭曉
│   ├── combat.ts    交戰
│   ├── game.ts      回合流程、勝負判定
│   └── setup.ts     開局
├── ai/
│   ├── greedy.ts    貪婪 AI
│   └── selfplay.ts  AI 對 AI 對戰與統計
└── ui/              網頁介面（原生 DOM，沒有框架）
    ├── app.ts       控制器：點擊處理、逐格播放結算
    ├── render.ts    依遊戲狀態產生 HTML
    ├── input.ts     玩家還沒送出的佈署
    ├── describe.ts  把引擎事件翻成戰況文字
    └── styles.css
tests/               Vitest 測試
scripts/sim.ts       平衡報告
```

## 設計重點

這個專案是程式練習，下面幾個做法值得留意：

- **引擎是純函式**。`resolveRound(state, plans)` 不會修改傳進去的 state，而是回傳新的 state。
  內部先 `structuredClone` 一份草稿，再在草稿上就地修改。所以測試、重播、AI 預覽都能放心重複呼叫。
- **同時出牌不作弊**。AI 只拿得到 `state`，玩家的佈署是在 AI 決定之後才一起交給 `resolveRound`。
  AI 模擬時一律假設對手不出牌，也不讀對手的手牌（有測試確保這一點）。
- **事件驅動的動畫**。引擎在結算過程中發出事件（`unitDamage`、`towerDestroyed`…），
  開啟 `record` 時每個事件都附上當下的盤面快照。UI 只要照順序播放這些快照，不需要自己重算規則。
- **資料驅動的卡表**。卡片效果寫成 `{ on: 'reveal', do: 'damageFront', amount: 3 }` 這樣的資料，
  由 `effects.ts` 的處理表執行。新增卡片通常只要改 `cards.ts`。
- **可重現**。所有隨機都經過 `rng.ts`，同一個種子一定得到同樣的對局。
  遊戲開局時會在戰況欄顯示種子，方便重現問題。
- **用模擬調平衡**。`npm run sim` 讓兩個 AI 打上千局，報告陣營勝率、平均回合數、先手偏差。
  調整紀錄見規則書的「平衡紀錄」。

## 可以繼續做的事

- 牌組編輯器（引擎已經有 `validateDeck`）
- 第三、第四個陣營：奧術學院（操控晝夜和主動權）、翠林精靈（單位跨回合成長）
- 更聰明的 AI：考慮對手可能的出牌，或往後多看一回合
- 雙人連線：引擎是純函式又可重現，雙方只要交換種子和每回合的佈署
