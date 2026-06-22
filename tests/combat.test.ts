import { describe, expect, it } from "vitest";
import {
  applyBalanceRecovery,
  isRingOut,
  maxBalance,
  resolveBodyHit,
  resolveCombatMatrix,
  resolveSwordClash,
} from "../src/game/combat";
import { vec2 } from "../src/game/math";

describe("sword combat", () => {
  it("uses blade angle to distinguish perfect blocks, glancing blocks, guard breaks, and clean hits", () => {
    const base = {
      attackerVelocity: vec2(8, 0),
      defenderVelocity: vec2(0.5, 0),
      attackerBladeDirection: vec2(0, 1),
      attackerSlashDirection: vec2(1, 0),
      contactNormal: vec2(1, 0),
      defenderBalance: 90,
      defenderCombatState: "IDLE_GUARD" as const,
    };

    expect(resolveCombatMatrix({ ...base, defenderBladeDirection: vec2(0.04, 1) }).kind).toBe("PERFECT_BLOCK");
    expect(resolveCombatMatrix({ ...base, defenderBladeDirection: vec2(0.72, 0.69) }).kind).toBe("GLANCING_BLOCK");
    expect(resolveCombatMatrix({ ...base, attackerVelocity: vec2(13, 0), defenderBladeDirection: vec2(0.86, 0.5) }).kind).toBe("GUARD_BREAK");
    expect(resolveCombatMatrix({ ...base, defenderBladeDirection: vec2(1, 0) }).kind).toBe("CLEAN_HIT");
  });

  it("turns blade alignment and swing speed into stronger body impact pressure", () => {
    const edgeHit = resolveBodyHit({
      attackerVelocity: vec2(8, 0),
      bladeDirection: vec2(0, 1),
      contactNormal: vec2(1, 0),
      defenderBalance: 82,
      defenderMovingBackward: false,
      defenderBlocking: false,
    });

    const flatHit = resolveBodyHit({
      attackerVelocity: vec2(8, 0),
      bladeDirection: vec2(1, 0),
      contactNormal: vec2(1, 0),
      defenderBalance: 82,
      defenderMovingBackward: false,
      defenderBlocking: false,
    });

    expect(edgeHit.knockback).toBeGreaterThan(flatHit.knockback * 1.75);
    expect(edgeHit.balanceLoss).toBeGreaterThan(flatHit.balanceLoss);
    expect(edgeHit.staggerSeconds).toBeGreaterThan(0);
  });

  it("turns a strong sword clash into weapon bounce without character push", () => {
    const clash = resolveSwordClash({
      attackerVelocity: vec2(7, 0.5),
      defenderVelocity: vec2(-1, 0),
      attackerBladeDirection: vec2(0.1, 1),
      defenderBladeDirection: vec2(0, 1),
      contactNormal: vec2(1, 0),
      defenderBalance: 70,
    });

    expect(clash.kind).toBe("bounce");
    expect(clash.attackerPush).toBe(0);
    expect(clash.defenderPush).toBe(0);
    expect(clash.defenderBounce).toBeGreaterThan(clash.attackerBounce);
    expect(clash.attackerBalanceLoss).toBe(10);
    expect(clash.defenderBalanceLoss).toBe(10);
  });

  it("bounces a weak swing away from a stable non-perpendicular block", () => {
    const clash = resolveSwordClash({
      attackerVelocity: vec2(1.5, 0),
      defenderVelocity: vec2(-2.2, 0),
      attackerBladeDirection: vec2(1, 0),
      defenderBladeDirection: vec2(1, 0.12),
      contactNormal: vec2(1, 0),
      defenderBalance: 100,
    });

    expect(clash.kind).toBe("bounce");
    expect(clash.attackerPush).toBe(0);
    expect(clash.defenderPush).toBe(0);
    expect(clash.attackerBounce).toBeGreaterThan(clash.defenderBounce);
    expect(clash.attackerBalanceLoss).toBe(10);
    expect(clash.defenderBalanceLoss).toBe(10);
  });
});

describe("balance and arena bounds", () => {
  it("recovers 0-100 balance gradually without exceeding full stability", () => {
    expect(applyBalanceRecovery(42, 0.5)).toBeCloseTo(49.5, 3);
    expect(applyBalanceRecovery(98, 1)).toBe(maxBalance);
  });

  it("ends the round after crossing the dangerous platform radius", () => {
    expect(isRingOut(vec2(4.61, 0), 4.5)).toBe(true);
    expect(isRingOut(vec2(3.5, 2.2), 4.5)).toBe(false);
  });
});
