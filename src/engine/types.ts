/** 晝夜 */
export type Phase = 'day' | 'night';
/** 座位：0 是玩家，1 是對手（模擬時兩邊都是 AI） */
export type Seat = 0 | 1;
/** 戰線：0 左路、1 中路、2 右路 */
export type Lane = 0 | 1 | 2;

export const LANES: readonly Lane[] = [0, 1, 2];
export const SEATS: readonly Seat[] = [0, 1];
export const LANE_NAMES = ['左路', '中路', '右路'] as const;

export const RULES = {
  towerHp: 8,
  /** 摧毀對手幾座塔就獲勝 */
  towersToWin: 2,
  deckSize: 20,
  maxCopies: 2,
  openingHand: 4,
  handLimit: 8,
  maxRounds: 8,
  /** 每路每方最多幾個單位 */
  laneCapacity: 3,
} as const;

export type Faction = 'dawn' | 'dusk' | 'token';
export type CardType = 'unit' | 'spell';

/** 效果的觸發時機：揭曉（進場或施放時）、亡語（陣亡時） */
export type Trigger = 'reveal' | 'death';

export type EffectKind =
  | 'repairTower'
  | 'damageFront'
  | 'damageLane'
  | 'setPhase'
  | 'lockNextPhase'
  | 'draw'
  | 'summon'
  | 'returnToHand';

/** 卡片效果是純資料，由 effects.ts 的處理表負責執行 */
export interface EffectSpec {
  on: Trigger;
  do: EffectKind;
  /** 只在這個晝夜才發動 */
  if?: Phase;
  amount?: number;
  phase?: Phase;
  /** summon 用：召喚哪一種衍生物 */
  token?: string;
}

export interface Keywords {
  /** 守護 N：此路我方塔受到的傷害 −N */
  guard?: number;
  /** 突襲：攻擊力不打單位，直接打塔 */
  ambush?: boolean;
  /** 吸血：交戰結束時若仍存活，回復等同目前攻擊力的生命 */
  lifesteal?: boolean;
}

export interface CardDef {
  id: string;
  name: string;
  faction: Faction;
  type: CardType;
  cost: number;
  dayAtk?: number;
  nightAtk?: number;
  hp?: number;
  keywords?: Keywords;
  effects?: EffectSpec[];
  /** 法術要指定一路，還是作用於全場 */
  target?: 'lane' | 'global';
  icon: string;
  text: string;
}

/** 牌庫、手牌、棄牌堆裡的一張卡 */
export interface CardInst {
  uid: number;
  defId: string;
}

/** 戰場上的單位；生命值不隨晝夜改變，受到的傷害會保留到下回合 */
export interface Unit {
  uid: number;
  defId: string;
  hp: number;
  maxHp: number;
}

export type Towers = [number, number, number];
/** 每一路的單位，陣列第 0 個是最前方 */
export type LaneRow = [Unit[], Unit[], Unit[]];

export interface SideState {
  deck: CardInst[];
  hand: CardInst[];
  discard: CardInst[];
  /** 焚卷移出遊戲的卡 */
  exiled: CardInst[];
  lanes: LaneRow;
  towers: Towers;
}

export interface GameState {
  /** 亂數產生器的內部狀態 */
  rng: number;
  round: number;
  /** 第 1 回合的晝夜（開局擲硬幣），之後每回合交替 */
  firstPhase: Phase;
  phase: Phase;
  /** 永夜之類的效果會鎖定下回合的晝夜 */
  nextPhase: Phase | null;
  /** 本回合先揭曉的一方 */
  initiative: Seat;
  sides: [SideState, SideState];
  nextUid: number;
  winner: Seat | 'draw' | null;
}

/** 一次出牌：單位與指定路線的法術要有 lane，全場法術不用 */
export interface Play {
  uid: number;
  lane?: Lane;
}

/** 一方在佈署階段做的全部決定 */
export interface Plan {
  plays: Play[];
  /** 要焚卷的手牌 */
  burn?: number;
}

export type GameEvent =
  | { t: 'roundStart'; round: number; phase: Phase; initiative: Seat }
  | { t: 'draw'; seat: Seat; defId: string }
  | { t: 'overdraw'; seat: Seat; defId: string }
  | { t: 'burn'; seat: Seat; defId: string }
  | { t: 'play'; seat: Seat; uid: number; defId: string; lane?: Lane }
  | { t: 'laneFull'; seat: Seat; defId: string; lane: Lane }
  | { t: 'summon'; seat: Seat; uid: number; defId: string; lane: Lane }
  | { t: 'phase'; seat: Seat; phase: Phase }
  | { t: 'lockPhase'; seat: Seat; phase: Phase }
  | { t: 'combat' }
  | { t: 'unitDamage'; seat: Seat; lane: Lane; uid: number; defId: string; amount: number }
  | { t: 'unitHeal'; seat: Seat; lane: Lane; uid: number; defId: string; amount: number }
  | { t: 'death'; seat: Seat; lane: Lane; uid: number; defId: string }
  | { t: 'returnToHand'; seat: Seat; defId: string }
  | { t: 'repair'; seat: Seat; lane: Lane; amount: number }
  | { t: 'towerDamage'; seat: Seat; lane: Lane; amount: number; blocked: number }
  | { t: 'towerDestroyed'; seat: Seat; lane: Lane }
  | { t: 'gameOver'; winner: Seat | 'draw' };

export type Emit = (event: GameEvent) => void;

/** 結算過程的一格：事件本身加上事件發生當下的盤面，讓 UI 可以逐步播放 */
export interface Frame {
  event: GameEvent;
  state: GameState;
}
