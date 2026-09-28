# 晨昏戰線 Duskline

一局 10～15 分鐘的網頁卡牌對戰。白晝與黑夜每回合交替，每張卡都有白天和夜晚兩種攻擊力。
雙方同時把牌蓋在三條戰線上，揭曉後自動交戰，先摧毀對手兩座塔的一方獲勝。
可以對戰電腦，也可以和朋友連線對戰。

**線上試玩：<https://wkai2573.github.io/duskline/>**

## 和朋友連線

1. 在首頁「和朋友連線」選一個陣營，按下去就會建立房間，畫面上會出現 6 碼的房間代碼。
2. 按「複製邀請連結」傳給朋友；朋友打開連結就會直接加入。也可以只傳代碼，讓朋友在首頁輸入。
3. 雙方各自出牌後按「送出」，兩邊都送出才會一起揭曉。

不需要註冊，也不需要架伺服器：瀏覽器之間用 WebRTC 直接連線，
只有「找到對方」這一步借用 [PeerJS](https://peerjs.com/) 的免費公用伺服器。
少數網路環境（例如部分公司網路）可能擋住直接連線，這時換個網路試試。

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

推送到 `main` 時，GitHub Actions 會自動跑測試、建置，並部署到 GitHub Pages（見 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)）。

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
├── net/             連線對戰
│   ├── protocol.ts  訊息格式、雜湊、房間代碼
│   ├── match.ts     鎖步協定與 commit–reveal（不碰網路，可以單獨測試）
│   ├── peer.ts      用 PeerJS 建立 / 加入房間
│   └── loopback.ts  記憶體裡的假連線，給測試用
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
- **連線對戰用鎖步（lockstep）**。因為引擎可重現，雙方不必同步整個盤面：
  房主決定種子，之後每回合只交換出牌，兩邊各自呼叫同一個 `resolveRound`。
  結算完互相比對盤面的 SHA-256，萬一不同步會立刻發現。
- **commit–reveal 防偷看**。送出時先傳出牌內容加上隨機 salt 的雜湊，雙方都送出後才公開內容，
  收到的一方重算雜湊比對。所以誰都不能先看到對手出什麼再改自己的決定，事後偷改也會被抓到。

### 連線對戰目前的限制

- 兩邊的瀏覽器都有完整的遊戲狀態，會寫程式的人可以從開發者工具看到對手的手牌。
  和朋友玩沒問題；要徹底防作弊，得改成由伺服器保管狀態、只把各自看得到的資訊傳給玩家。
- 斷線後不能重新連回同一局。

## 可以繼續做的事

- 牌組編輯器（引擎已經有 `validateDeck`）
- 第三、第四個陣營：奧術學院（操控晝夜和主動權）、翠林精靈（單位跨回合成長）
- 更聰明的 AI：考慮對手可能的出牌，或往後多看一回合
- 連線對戰的斷線重連：雙方都有種子和每回合的出牌紀錄，重播一次就能回到斷線前的盤面
