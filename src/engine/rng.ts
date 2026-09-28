/**
 * mulberry32：只有 32 位元狀態的小型亂數產生器。
 * 狀態存在 GameState.rng，所以同一個種子一定得到完全相同的對局。
 */
export function nextFloat(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 0 到 n−1 的整數 */
export function randInt(s: { rng: number }, n: number): number {
  return Math.floor(nextFloat(s) * n);
}

/** Fisher–Yates 洗牌，就地修改 */
export function shuffle<T>(s: { rng: number }, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
