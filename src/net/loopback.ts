import type { Channel, NetMessage } from './protocol.ts';

export interface LoopbackOptions {
  /** 攔截從某一端送出的訊息：可以改寫（模擬作弊）或回傳 null 丟掉 */
  intercept?: (msg: NetMessage, from: 0 | 1) => NetMessage | null;
}

/**
 * 記憶體裡的一對連線，給測試用。
 * 訊息會經過 JSON 序列化並非同步送達，行為和真的網路一樣。
 */
export function createLoopback(opts: LoopbackOptions = {}): [Channel, Channel] {
  const ends = [0, 1].map(() => ({
    handler: null as ((msg: NetMessage) => void) | null,
    queue: [] as NetMessage[],
    closeHandlers: [] as (() => void)[],
  }));
  let closed = false;

  function deliver(to: 0 | 1, msg: NetMessage): void {
    const end = ends[to];
    if (end.handler) end.handler(msg);
    else end.queue.push(msg);
  }

  function closeBoth(): void {
    if (closed) return;
    closed = true;
    setTimeout(() => ends.forEach((e) => e.closeHandlers.forEach((cb) => cb())), 0);
  }

  const make = (me: 0 | 1): Channel => ({
    send(msg) {
      if (closed) return;
      const out = opts.intercept ? opts.intercept(msg, me) : msg;
      if (!out) return;
      const copy = JSON.parse(JSON.stringify(out)) as NetMessage;
      setTimeout(() => !closed && deliver(me === 0 ? 1 : 0, copy), 0);
    },
    onMessage(cb) {
      ends[me].handler = cb;
      ends[me].queue.splice(0).forEach(cb);
    },
    onClose(cb) {
      ends[me].closeHandlers.push(cb);
    },
    close: closeBoth,
  });

  return [make(0), make(1)];
}
