import type { Plan, PlayableFaction } from '../engine/index.ts';

/** 協定版本：雙方不同就拒絕開局，避免規則不一致造成不同步 */
export const PROTOCOL_VERSION = 1;

export type NetMessage =
  /** 加入者連上後的第一句話 */
  | { t: 'hello'; version: number }
  /** 房主決定種子和陣營，雙方各自用它開局 */
  | { t: 'start'; seed: number; factions: [PlayableFaction, PlayableFaction] }
  /** 先送出牌內容的雜湊（封好的信封），對方看不到內容 */
  | { t: 'commit'; round: number; hash: string }
  /** 雙方都 commit 之後才公開出牌 */
  | { t: 'reveal'; round: number; salt: string; plan: string }
  /** 結算後互相比對盤面雜湊，確認雙方沒有不同步 */
  | { t: 'sync'; round: number; hash: string }
  | { t: 'rematch' }
  | { t: 'error'; message: string };

/** 雙向訊息通道；實際是 PeerJS 連線，測試時用記憶體模擬 */
export interface Channel {
  send(msg: NetMessage): void;
  /** 設定訊息處理函式；設定前收到的訊息會先排隊 */
  onMessage(cb: (msg: NetMessage) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 承諾的內容。加上隨機 salt，對方才無法把所有可能的出牌算一遍雜湊來反推 */
export function commitText(round: number, salt: string, plan: string): string {
  return `${round}|${salt}|${plan}`;
}

// 去掉容易看錯的 0/O、1/I/L
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function makeRoomCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))]
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join('');
}

/** 使用者輸入的代碼：轉大寫、去掉空白和連字號 */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** 對手送來的出牌只檢查形狀；規則上合不合法交給引擎的 validatePlan */
export function parsePlan(json: string): Plan | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { plays, burn } = data as { plays?: unknown; burn?: unknown };
  if (!Array.isArray(plays)) return null;
  if (burn !== undefined && !Number.isInteger(burn)) return null;
  const ok = plays.every(
    (p) =>
      typeof p === 'object' &&
      p !== null &&
      Number.isInteger((p as { uid?: unknown }).uid) &&
      [undefined, 0, 1, 2].includes((p as { lane?: unknown }).lane as number | undefined),
  );
  return ok ? (data as Plan) : null;
}
