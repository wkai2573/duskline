import { damageUnit, drawCard, frontUnit, other, summonToken } from './board.ts';
import { getDef } from './cards.ts';
import {
  LANES,
  RULES,
  type CardDef,
  type EffectKind,
  type EffectSpec,
  type Emit,
  type GameState,
  type Lane,
  type Seat,
  type Trigger,
  type Unit,
} from './types.ts';

export interface EffectCtx {
  s: GameState;
  seat: Seat;
  /** 全場法術沒有 lane */
  lane?: Lane;
  /** 觸發效果的那張卡；亡語發動時它已經離場 */
  uid: number;
  emit: Emit;
}

type Handler = (ctx: EffectCtx, spec: EffectSpec) => void;

const handlers: Record<EffectKind, Handler> = {
  repairTower({ s, seat, lane, emit }, spec) {
    if (lane === undefined) return;
    const towers = s.sides[seat].towers;
    // 已經被摧毀的塔修不回來
    if (towers[lane] <= 0) return;
    const amount = Math.min(spec.amount ?? 0, RULES.towerHp - towers[lane]);
    if (amount <= 0) return;
    towers[lane] += amount;
    emit({ t: 'repair', seat, lane, amount });
  },

  damageFront({ s, seat, lane, emit }, spec) {
    if (lane === undefined) return;
    const enemy = other(seat);
    const target = frontUnit(s, enemy, lane);
    if (target) damageUnit(s, enemy, lane, target, spec.amount ?? 0, emit);
  },

  damageLane({ s, seat, lane, emit }, spec) {
    if (lane === undefined) return;
    const enemy = other(seat);
    for (const unit of s.sides[enemy].lanes[lane]) {
      if (unit.hp > 0) damageUnit(s, enemy, lane, unit, spec.amount ?? 0, emit);
    }
  },

  setPhase({ s, seat, emit }, spec) {
    if (!spec.phase) return;
    s.phase = spec.phase;
    emit({ t: 'phase', seat, phase: spec.phase });
  },

  lockNextPhase({ s, seat, emit }, spec) {
    if (!spec.phase) return;
    s.nextPhase = spec.phase;
    emit({ t: 'lockPhase', seat, phase: spec.phase });
  },

  draw({ s, seat, emit }, spec) {
    for (let i = 0; i < (spec.amount ?? 1); i++) drawCard(s, seat, emit);
  },

  summon({ s, seat, lane, emit }, spec) {
    if (lane === undefined || !spec.token) return;
    for (let i = 0; i < (spec.amount ?? 1); i++) summonToken(s, seat, lane, spec.token, emit);
  },

  returnToHand({ s, seat, uid, emit }) {
    const side = s.sides[seat];
    const i = side.discard.findIndex((c) => c.uid === uid);
    if (i < 0 || side.hand.length >= RULES.handLimit) return;
    const [card] = side.discard.splice(i, 1);
    side.hand.push(card);
    emit({ t: 'returnToHand', seat, defId: card.defId });
  },
};

export function runEffects(ctx: EffectCtx, trigger: Trigger, def: CardDef): void {
  for (const spec of def.effects ?? []) {
    if (spec.on !== trigger) continue;
    // 晝夜條件在發動當下判斷，所以同一回合先施放破曉會影響後面的效果
    if (spec.if && spec.if !== ctx.s.phase) continue;
    handlers[spec.do](ctx, spec);
  }
}

/**
 * 移除生命歸零的單位並觸發亡語。
 * 亡語可能再打死別的單位，所以重複檢查到盤面穩定為止。
 */
export function cleanupDeaths(s: GameState, emit: Emit): void {
  for (let pass = 0; pass < 50; pass++) {
    const dead: { seat: Seat; lane: Lane; unit: Unit }[] = [];
    for (const seat of [s.initiative, other(s.initiative)]) {
      for (const lane of LANES) {
        for (const unit of s.sides[seat].lanes[lane]) {
          if (unit.hp <= 0) dead.push({ seat, lane, unit });
        }
      }
    }
    if (dead.length === 0) return;

    for (const { seat, lane, unit } of dead) {
      const side = s.sides[seat];
      side.lanes[lane] = side.lanes[lane].filter((u) => u.uid !== unit.uid);
      if (getDef(unit.defId).faction !== 'token') side.discard.push({ uid: unit.uid, defId: unit.defId });
      emit({ t: 'death', seat, lane, uid: unit.uid, defId: unit.defId });
    }
    for (const { seat, lane, unit } of dead) {
      runEffects({ s, seat, lane, uid: unit.uid, emit }, 'death', getDef(unit.defId));
    }
  }
  throw new Error('亡語連鎖超過 50 層，可能有無限迴圈');
}
