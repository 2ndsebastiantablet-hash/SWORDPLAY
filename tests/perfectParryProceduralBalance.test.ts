import { describe, expect, it } from "vitest";
import {
  applyBalanceRecovery,
  balanceRecoveryRate,
  perfectParryBalanceLoss,
  perfectParryStaggerSeconds,
  resolveSwordClash,
} from "../src/game/combat";
import { createInitialState, stepDuel } from "../src/game/simulation";
import { computeBalanceTilt } from "../src/render/DuelRenderer";
import { length, sub, vec2 } from "../src/game/math";

const neutralInput = {
  move: vec2(0, 0),
  swordAim: vec2(0, 0.2),
  swordVelocity: vec2(0, 0),
  swordRoll: 0,
  pointerLocked: false,
  restart: false,
};

function frame(state: ReturnType<typeof createInitialState>, dt = 1 / 60) {
  stepDuel(state, neutralInput, dt);
  return state;
}

describe("perfect parry, balance recovery, and procedural knockback", () => {
  it("detects a perfect parry when defending blade crosses an incoming strike near 90 degrees", () => {
    const parry = resolveSwordClash({
      attackerVelocity: vec2(10, 0),
      defenderVelocity: vec2(0.8, 0),
      attackerBladeDirection: vec2(1, 0),
      defenderBladeDirection: vec2(0, 1),
      contactNormal: vec2(1, 0),
      defenderBalance: 100,
    });

    const normalBounce = resolveSwordClash({
      attackerVelocity: vec2(10, 0),
      defenderVelocity: vec2(0.8, 0),
      attackerBladeDirection: vec2(1, 0),
      defenderBladeDirection: vec2(1, 0.12),
      contactNormal: vec2(1, 0),
      defenderBalance: 100,
    });

    expect(parry.kind).toBe("perfectParry");
    expect(parry.attackerBalanceLoss).toBe(perfectParryBalanceLoss);
    expect(parry.attackerStaggerSeconds).toBe(perfectParryStaggerSeconds);
    expect(parry.defenderBalanceLoss).toBe(0);
    expect(normalBounce.kind).toBe("bounce");
  });

  it("applies perfect parry balance loss and stagger to the incoming attacker only", () => {
    const state = createInitialState();
    state.player.position = vec2(0, -0.25);
    state.npc.position = vec2(0, 0.25);
    state.player.velocity = vec2(0, 0);
    state.npc.velocity = vec2(0, 0);
    state.player.sword.hand = vec2(-0.3, 0);
    state.player.sword.tip = vec2(0.3, 0);
    state.player.sword.previousTip = vec2(-0.7, 0);
    state.player.sword.velocity = vec2(10, 0);
    state.player.sword.finalVelocity = vec2(10, 0);
    state.player.sword.bladeDirection = vec2(1, 0);
    state.player.sword.isSlashing = true;
    state.npc.sword.hand = vec2(0, -0.35);
    state.npc.sword.tip = vec2(0, 0.35);
    state.npc.sword.previousTip = vec2(0, -0.35);
    state.npc.sword.velocity = vec2(0.5, 0);
    state.npc.sword.finalVelocity = vec2(0.5, 0);
    state.npc.sword.bladeDirection = vec2(0, 1);
    state.npc.sword.isSlashing = false;

    frame(state, 0);

    expect(state.player.balance).toBe(100 - perfectParryBalanceLoss);
    expect(state.player.combatState).toBe("STAGGERED");
    expect(state.player.staggerSeconds).toBeCloseTo(perfectParryStaggerSeconds, 3);
    expect(state.player.inputLockSeconds).toBe(0);
    expect(state.npc.balance).toBe(100);
    expect(state.npc.inputLockSeconds).toBe(0);
  });

  it("slides only staggered or low-balance defenders when hit", () => {
    const firm = createInitialState();
    const vulnerable = createInitialState();
    for (const state of [firm, vulnerable]) {
      state.player.velocity = vec2(0, 0);
      state.npc.velocity = vec2(0, 0);
      state.player.sword.finalVelocity = vec2(12, 0);
      state.player.sword.velocity = vec2(12, 0);
      state.pendingHitEvents = [
        {
          id: 301,
          attackerId: "player",
          defenderId: "npc",
          damage: 0,
          balanceLoss: 8,
          knockbackDirection: vec2(1, 0),
          knockbackForce: 1,
          frameCreated: state.frame,
          hitType: "CLEAN_HIT",
          hitLocation: "body",
          staggerSeconds: 0,
          collisionPoint: state.npc.position,
        },
      ];
    }
    vulnerable.npc.balance = 45;

    frame(firm, 0);
    frame(vulnerable, 0);
    const firmStart = firm.npc.position;
    const vulnerableStart = vulnerable.npc.position;

    frame(firm);
    frame(vulnerable);

    expect(length(sub(firm.npc.position, firmStart))).toBeLessThan(0.01);
    expect(length(sub(vulnerable.npc.position, vulnerableStart))).toBeGreaterThan(0.05);
    expect(vulnerable.npc.knockbackTarget).toBeDefined();
  });

  it("recovers balance at 15 points per second only after the 1.5 second recovery delay", () => {
    expect(balanceRecoveryRate).toBe(15);
    expect(applyBalanceRecovery(70, 1)).toBe(85);

    const state = createInitialState();
    state.player.balance = 60;
    state.player.balanceRecoveryCooldown = 1.5;

    for (let i = 0; i < 89; i += 1) {
      frame(state);
    }
    expect(state.player.balance).toBeCloseTo(60, 1);

    frame(state);
    frame(state);
    expect(state.player.balance).toBeGreaterThan(60);
  });

  it("computes procedural balance lean and stagger wobble from fighter state", () => {
    const state = createInitialState();
    state.player.balance = 80;
    state.player.lastKnockbackDirection = vec2(1, 0);
    const stableLean = computeBalanceTilt(state.player, 0);
    expect(stableLean.z).toBeCloseTo(0.1, 3);

    state.player.staggerSeconds = perfectParryStaggerSeconds;
    const wobbleA = computeBalanceTilt(state.player, 0.03);
    const wobbleB = computeBalanceTilt(state.player, 0.08);
    expect(Math.abs(wobbleA.z - wobbleB.z)).toBeGreaterThan(0.04);
  });
});
