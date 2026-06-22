import {
  clamp,
  clamp01,
  dot,
  length,
  normalize,
  perpendicularLeft,
  scale,
  type Vec2,
} from "./math";
import type { CombatState } from "./types";

export type BodyHitInput = {
  attackerVelocity: Vec2;
  bladeDirection: Vec2;
  contactNormal: Vec2;
  defenderBalance: number;
  defenderMovingBackward: boolean;
  defenderBlocking: boolean;
};

export type BodyHitResult = {
  knockback: number;
  balanceLoss: number;
  staggerSeconds: number;
  alignment: number;
};

export type SwordClashInput = {
  attackerVelocity: Vec2;
  defenderVelocity: Vec2;
  attackerBladeDirection: Vec2;
  defenderBladeDirection: Vec2;
  contactNormal: Vec2;
  defenderBalance: number;
};

export type SwordClashResult = {
  kind: "bounce" | "perfectParry";
  attackerPush: number;
  defenderPush: number;
  attackerBounce: number;
  defenderBounce: number;
  attackerBalanceLoss: number;
  defenderBalanceLoss: number;
  attackerStaggerSeconds: number;
  force: number;
};

export type CombatMatrixInput = {
  attackerVelocity: Vec2;
  defenderVelocity: Vec2;
  attackerBladeDirection: Vec2;
  defenderBladeDirection: Vec2;
  attackerSlashDirection: Vec2;
  contactNormal: Vec2;
  defenderBalance: number;
  defenderCombatState: CombatState;
};

export type CombatMatrixResult = {
  kind: "PERFECT_BLOCK" | "SUCCESSFUL_BLOCK" | "GLANCING_BLOCK" | "GUARD_BREAK" | "CLEAN_HIT";
  angleDifference: number;
  bladeDot: number;
  perpendicularAmount: number;
  attackerStunSeconds: number;
  attackerPush: number;
  defenderPush: number;
  attackerBalanceLoss: number;
  defenderBalanceLoss: number;
  damageMultiplier: number;
  inputLockSeconds: number;
};

export const perfectBlockAngleTolerance = Math.PI / 12;
export const normalBlockAngleTolerance = (Math.PI * 35) / 180;
export const glancingBlockAngleTolerance = (Math.PI * 55) / 180;
export const maxBalance = 100;
export const defaultBalance = 100;
export const lowBalanceThreshold = 60;
export const staggerBalanceThreshold = 35;
export const offBalanceThreshold = 30;
export const criticalBalanceThreshold = 15;
export const balanceRecoveryRate = 15.0;
export const blockInputLockDuration = 0.25;
export const perfectBlockInputLockDuration = 0.4;
export const blockRecoilForce = 2.5;
export const perfectBlockRecoilForce = 4.0;
export const swordBounceDistance = 0.64;
export const perfectParryAngle = Math.PI / 2;
export const perfectParryAngleTolerance = Math.PI / 6;
export const perfectParryBalanceLoss = 45;
export const perfectParryStaggerSeconds = 0.6;

export function bladeEdgeAlignment(bladeDirection: Vec2, contactNormal: Vec2): number {
  const edgeNormal = perpendicularLeft(normalize(bladeDirection, { x: 1, y: 0 }));
  return Math.abs(dot(edgeNormal, normalize(contactNormal, { x: 1, y: 0 })));
}

function angleBetweenBlades(a: Vec2, b: Vec2): { angle: number; dotValue: number } {
  const bladeDot = Math.abs(dot(normalize(a, { x: 0, y: 1 }), normalize(b, { x: 0, y: 1 })));
  return {
    angle: Math.acos(clamp(bladeDot, -1, 1)),
    dotValue: bladeDot,
  };
}

export function isPerfectParryAngle(attackerBladeDirection: Vec2, defenderBladeDirection: Vec2): boolean {
  const { angle } = angleBetweenBlades(attackerBladeDirection, defenderBladeDirection);
  return Math.abs(angle - perfectParryAngle) <= perfectParryAngleTolerance;
}

export function resolveCombatMatrix(input: CombatMatrixInput): CombatMatrixResult {
  const speed = length(input.attackerVelocity);
  const { angle, dotValue } = angleBetweenBlades(input.attackerBladeDirection, input.defenderBladeDirection);
  const perpendicularAmount = Math.abs(dot(normalize(input.attackerSlashDirection, normalize(input.attackerVelocity)), normalize(input.defenderBladeDirection)));
  const defenderWeak = input.defenderBalance < lowBalanceThreshold || input.defenderCombatState === "STAGGERED" || input.defenderCombatState === "OFF_BALANCE" || input.defenderCombatState === "CRITICAL_STUMBLE";
  const heavyGuardBreak = speed >= 12 && angle > normalBlockAngleTolerance && angle < Math.PI * 0.46;
  const strongWeakGuardBreak = speed >= 8 && defenderWeak && angle > normalBlockAngleTolerance;

  if (heavyGuardBreak || strongWeakGuardBreak) {
    return {
      kind: "GUARD_BREAK",
      angleDifference: angle,
      bladeDot: dotValue,
      perpendicularAmount,
      attackerStunSeconds: 0,
      attackerPush: 0,
      defenderPush: 0,
      attackerBalanceLoss: 0,
      defenderBalanceLoss: clamp(30 + speed * 1.1, 30, 45),
      damageMultiplier: speed >= 12 ? 0.8 : 0.48,
      inputLockSeconds: 0.36,
    };
  }

  if (angle <= perfectBlockAngleTolerance) {
    return {
      kind: "PERFECT_BLOCK",
      angleDifference: angle,
      bladeDot: dotValue,
      perpendicularAmount,
      attackerStunSeconds: 0.46,
      attackerPush: 0,
      defenderPush: 0,
      attackerBalanceLoss: speed >= 12 ? 22 : 14,
      defenderBalanceLoss: speed >= 12 ? 8 : 3,
      damageMultiplier: 0,
      inputLockSeconds: perfectBlockInputLockDuration,
    };
  }

  if (angle <= normalBlockAngleTolerance) {
    return {
      kind: "SUCCESSFUL_BLOCK",
      angleDifference: angle,
      bladeDot: dotValue,
      perpendicularAmount,
      attackerStunSeconds: 0.28,
      attackerPush: 0,
      defenderPush: 0,
      attackerBalanceLoss: speed >= 12 ? 18 : 10,
      defenderBalanceLoss: speed >= 12 ? 12 : 5,
      damageMultiplier: 0,
      inputLockSeconds: blockInputLockDuration,
    };
  }

  if (angle <= glancingBlockAngleTolerance) {
    return {
      kind: "GLANCING_BLOCK",
      angleDifference: angle,
      bladeDot: dotValue,
      perpendicularAmount,
      attackerStunSeconds: 0.08,
      attackerPush: 0,
      defenderPush: 0,
      attackerBalanceLoss: 5,
      defenderBalanceLoss: clamp(8 + speed * 0.7, 8, 22),
      damageMultiplier: 0.35,
      inputLockSeconds: 0.08,
    };
  }

  return {
    kind: "CLEAN_HIT",
    angleDifference: angle,
    bladeDot: dotValue,
    perpendicularAmount,
    attackerStunSeconds: 0,
    attackerPush: 0,
    defenderPush: 0,
    attackerBalanceLoss: 0,
    defenderBalanceLoss: clamp(speed >= 12 ? 25 + speed * 1.2 : speed >= 8 ? 15 + speed : 8 + speed * 0.7, 8, 40),
    damageMultiplier: 1,
    inputLockSeconds: 0,
  };
}

export function applyBalanceRecovery(balance: number, dt: number, edgeRatio = 0, fatigueFactor = 0): number {
  const edgePenalty = clamp(1 - Math.max(0, edgeRatio - 0.45) * 0.85, 0.35, 1);
  const fatiguePenalty = clamp(1 - fatigueFactor * 0.5, 0.5, 1);
  return clamp(balance + balanceRecoveryRate * edgePenalty * fatiguePenalty * dt, 0, maxBalance);
}

export function isRingOut(position: Vec2, arenaRadius: number): boolean {
  return length(position) > arenaRadius;
}

export function resolveBodyHit(input: BodyHitInput): BodyHitResult {
  const speed = length(input.attackerVelocity);
  const alignment = bladeEdgeAlignment(input.bladeDirection, input.contactNormal);
  const bladeQuality = 0.35 + alignment * 0.85;
  const blockFactor = input.defenderBlocking ? 0.58 : 1;
  const backwardFactor = input.defenderMovingBackward ? 1.3 : 1;
  const balanceRatio = clamp01(input.defenderBalance / maxBalance);
  const vulnerability = 1 + (1 - balanceRatio) * 0.9;
  const force = (0.35 + speed * 0.22) * bladeQuality * blockFactor * backwardFactor * vulnerability;
  const balanceLoss = clamp((6 + speed * 2.2) * bladeQuality * blockFactor * backwardFactor, 8, speed >= 12 ? 40 : speed >= 8 ? 25 : 12);
  const staggerSeconds =
    speed > 3.7 && alignment > 0.5
      ? clamp(0.1 + speed * 0.028 + (1 - balanceRatio) * 0.22, 0.12, 0.58)
      : 0;

  return {
    knockback: force,
    balanceLoss,
    staggerSeconds,
    alignment,
  };
}

export function resolveSwordClash(input: SwordClashInput): SwordClashResult {
  const normal = normalize(input.contactNormal, { x: 1, y: 0 });
  const attackerSpeed = length(input.attackerVelocity);
  const defenderSpeed = length(input.defenderVelocity);
  const attackerEdge = bladeEdgeAlignment(input.attackerBladeDirection, normal);
  const defenderEdge = bladeEdgeAlignment(input.defenderBladeDirection, scale(normal, -1));
  const attackerPower = attackerSpeed * (0.45 + attackerEdge);
  const defenderPower = defenderSpeed * (0.45 + defenderEdge) + (input.defenderBalance / maxBalance) * 1.3;
  const totalForce = Math.max(attackerPower, defenderPower);

  if (isPerfectParryAngle(input.attackerBladeDirection, input.defenderBladeDirection)) {
    return {
      kind: "perfectParry",
      attackerPush: 0,
      defenderPush: 0,
      attackerBounce: clamp(swordBounceDistance + defenderPower * 0.036, 0.6, 1.16),
      defenderBounce: clamp(swordBounceDistance + attackerPower * 0.012, 0.4, 0.76),
      attackerBalanceLoss: perfectParryBalanceLoss,
      defenderBalanceLoss: 0,
      attackerStaggerSeconds: perfectParryStaggerSeconds,
      force: totalForce,
    };
  }

  return {
    kind: "bounce",
    attackerPush: 0,
    defenderPush: 0,
    attackerBounce: clamp(swordBounceDistance + defenderPower * 0.024, 0.48, 0.96),
    defenderBounce: clamp(swordBounceDistance + attackerPower * 0.024, 0.48, 0.96),
    attackerBalanceLoss: 10,
    defenderBalanceLoss: 10,
    attackerStaggerSeconds: 0,
    force: totalForce,
  };
}
