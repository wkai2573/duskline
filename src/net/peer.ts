import type { DataConnection, Peer as PeerType } from 'peerjs';
import { makeRoomCode, type Channel, type NetMessage } from './protocol.ts';

// PeerJS 的雲端配對伺服器是所有人共用的，加前綴避免和別的網站撞 ID
const ID_PREFIX = 'duskline-room-';
const CONNECT_TIMEOUT_MS = 15_000;

// 只有連線對戰才載入 PeerJS，對戰電腦的玩家不用下載
async function loadPeer(): Promise<typeof PeerType> {
  const { Peer } = await import('peerjs');
  return Peer;
}

function describeError(type: string | undefined): string {
  switch (type) {
    case 'peer-unavailable':
      return '找不到這個房間，請確認代碼是否正確，或房主是否還開著頁面';
    case 'unavailable-id':
      return '房間代碼剛好重複了，請再試一次';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return '連不上配對伺服器，請檢查網路後再試一次';
    case 'browser-incompatible':
      return '這個瀏覽器不支援連線對戰，請改用最新版的 Chrome、Edge、Firefox 或 Safari';
    default:
      return `連線失敗（${type ?? '未知錯誤'}）`;
  }
}

function wrap(conn: DataConnection, cleanup: () => void): Channel {
  let handler: ((msg: NetMessage) => void) | null = null;
  const queue: NetMessage[] = [];
  const closeHandlers: (() => void)[] = [];
  let closed = false;

  const onClosed = () => {
    if (closed) return;
    closed = true;
    cleanup();
    closeHandlers.forEach((cb) => cb());
  };

  conn.on('data', (data) => {
    const msg = data as NetMessage;
    if (handler) handler(msg);
    else queue.push(msg);
  });
  conn.on('close', onClosed);
  conn.on('error', onClosed);
  conn.on('open', () => {
    // 對方直接關掉分頁時 PeerJS 不一定會觸發 close，所以也盯著底層 WebRTC 的狀態
    const pc = conn.peerConnection;
    pc?.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') onClosed();
    });
  });

  return {
    send(msg) {
      if (!closed) conn.send(msg);
    },
    onMessage(cb) {
      handler = cb;
      queue.splice(0).forEach(cb);
    },
    onClose(cb) {
      closeHandlers.push(cb);
    },
    close() {
      conn.close();
      onClosed();
    },
  };
}

export interface HostHandle {
  code: string;
  close(): void;
}

/**
 * 建立房間：向配對伺服器註冊一個由房間代碼組成的 ID，等朋友連進來。
 * 第一個連線成功的人成為對手，之後再連進來的會被拒絕。
 */
export async function hostRoom(onGuest: (channel: Channel) => void, onError: (message: string) => void): Promise<HostHandle> {
  const Peer = await loadPeer();

  for (let attempt = 0; ; attempt++) {
    const code = makeRoomCode();
    try {
      return await new Promise<HostHandle>((resolve, reject) => {
        const peer = new Peer(ID_PREFIX + code);
        let opened = false;
        let taken = false;
        peer.on('open', () => {
          opened = true;
          resolve({ code, close: () => peer.destroy() });
        });
        peer.on('connection', (conn) => {
          if (taken) {
            conn.on('open', () => conn.close());
            return;
          }
          taken = true;
          const channel = wrap(conn, () => peer.destroy());
          conn.on('open', () => onGuest(channel));
        });
        peer.on('error', (err) => {
          if (!opened) {
            peer.destroy();
            reject(Object.assign(new Error(describeError(err.type)), { type: err.type }));
          } else if (!taken) {
            // 已經有對手之後，配對伺服器斷線不影響直接連線，就不打擾玩家
            onError(describeError(err.type));
          }
        });
      });
    } catch (err) {
      if ((err as { type?: string }).type === 'unavailable-id' && attempt < 3) continue;
      throw err;
    }
  }
}

/** 加入房間 */
export async function joinRoom(code: string): Promise<Channel> {
  const Peer = await loadPeer();
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('連線逾時，請確認代碼，或稍後再試一次'), CONNECT_TIMEOUT_MS);

    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
      const channel = wrap(conn, () => peer.destroy());
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(channel);
      });
    });
    peer.on('error', (err) => fail(describeError(err.type)));
  });
}
