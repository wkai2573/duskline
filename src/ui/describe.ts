import { LANE_NAMES, getDef, type GameEvent, type Phase, type Seat } from '../engine/index.ts';

export type LogKind = 'round' | 'mine' | 'theirs' | 'combat' | 'big';

export interface LogLine {
  text: string;
  kind: LogKind;
}

const PHASE_NAMES: Record<Phase, string> = { day: '☀ 白晝', night: '☾ 黑夜' };

export function phaseName(phase: Phase): string {
  return PHASE_NAMES[phase];
}

/** 把引擎事件翻成戰況文字；不該讓玩家看到的（對手抽到什麼）回傳 null */
export function describe(e: GameEvent, me: Seat): LogLine | null {
  const who = (seat: Seat) => (seat === me ? '你' : '對手');
  const whose = (seat: Seat) => (seat === me ? '你的' : '對手的');
  const side = (seat: Seat): LogKind => (seat === me ? 'mine' : 'theirs');
  const name = (defId: string) => `「${getDef(defId).name}」`;

  switch (e.t) {
    case 'roundStart':
      return { kind: 'round', text: `第 ${e.round} 回合 · ${phaseName(e.phase)} · ${who(e.initiative)}先揭曉` };
    case 'draw':
      return e.seat === me ? { kind: 'mine', text: `你抽到${name(e.defId)}` } : null;
    case 'overdraw':
      return { kind: side(e.seat), text: `${who(e.seat)}的手牌滿了，${name(e.defId)}被捨棄` };
    case 'burn':
      return { kind: side(e.seat), text: `${who(e.seat)}焚卷了${name(e.defId)}，魔力 +1` };
    case 'play': {
      const def = getDef(e.defId);
      if (def.type === 'unit') return { kind: side(e.seat), text: `${who(e.seat)}在${LANE_NAMES[e.lane ?? 0]}佈署${name(e.defId)}` };
      const where = e.lane !== undefined ? `於${LANE_NAMES[e.lane]}` : '';
      return { kind: side(e.seat), text: `${who(e.seat)}${where}施放${name(e.defId)}` };
    }
    case 'laneFull':
      return { kind: side(e.seat), text: `${LANE_NAMES[e.lane]}已滿，${whose(e.seat)}${name(e.defId)}無法進場` };
    case 'summon':
      return { kind: side(e.seat), text: `${who(e.seat)}在${LANE_NAMES[e.lane]}召喚${name(e.defId)}` };
    case 'phase':
      return { kind: 'big', text: `${who(e.seat)}讓天色轉為${phaseName(e.phase)}` };
    case 'lockPhase':
      return { kind: 'big', text: `下回合將維持${phaseName(e.phase)}` };
    case 'combat':
      return { kind: 'combat', text: '⚔ 交戰' };
    case 'unitDamage':
      return { kind: side(e.seat), text: `${whose(e.seat)}${name(e.defId)}受到 ${e.amount} 點傷害` };
    case 'unitHeal':
      return { kind: side(e.seat), text: `${whose(e.seat)}${name(e.defId)}回復 ${e.amount} 點生命` };
    case 'death':
      return { kind: side(e.seat), text: `${whose(e.seat)}${name(e.defId)}陣亡` };
    case 'returnToHand':
      return { kind: side(e.seat), text: `${whose(e.seat)}${name(e.defId)}回到手牌` };
    case 'repair':
      return { kind: side(e.seat), text: `${whose(e.seat)}${LANE_NAMES[e.lane]}塔修復 ${e.amount} 點` };
    case 'towerDamage': {
      const blocked = e.blocked > 0 ? `（守護擋下 ${e.blocked}）` : '';
      return { kind: side(e.seat), text: `${whose(e.seat)}${LANE_NAMES[e.lane]}塔受到 ${e.amount} 點傷害${blocked}` };
    }
    case 'towerDestroyed':
      return { kind: 'big', text: `${whose(e.seat)}${LANE_NAMES[e.lane]}塔被摧毀！` };
    case 'gameOver':
      if (e.winner === 'draw') return { kind: 'big', text: '雙方平手' };
      return { kind: 'big', text: e.winner === me ? '你獲勝了！' : '你落敗了' };
  }
}
