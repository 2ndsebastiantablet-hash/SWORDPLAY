import { describe, expect, it } from "vitest";
import { resolveSwordClash } from "../src/game/combat";
import { createInitialState, stepDuel } from "../src/game/simulation";
import { length, sub, vec2 } from "../src/game/math";

const neutralInput = {
  move: vec2(0, 0),
  swordAim: vec2(0, 0.2),
  swordVelocity: vec2(0, 0),
  swordRoll: 0,
  pointerLocked: false,
  restart: false,
};

function frame(state: ReturnType<typeof createInitialState>, input = neutralInput, dt = 1 / 60) {
  stepDuel(state, input, dt);
  return state;
}

describe("simplified combat loop", () => {
  it("keeps sword motion weighted so the blade chases rather than snaps to the mouse target", () => {
    const state = createInitialState();
    state.npc.position = vec2(3.4, 3.4);
    const startingTip = state.player.sword.tip;

    frame(state, { ...neutralInput, swordAim: vec2(1, 1), swordRoll: 1 });

    const targetTravel = length(sub(state.player.sword.targetTip!, startingTip));
    const actualTravel = length(sub(state.player.sword.tip, startingTip));
    expect(actualTravel).toBeGreaterThan(0);
    expect(actualTravel).toBeLessThan(targetTravel * 0.35);
  });

  it("turns sword clashes into target bounce without freezing input or moving characters", () => {
    const clash = resolveSwordClash({
      attackerVelocity: vec2(9, 0),
      defenderVelocity: vec2(-7, 0),
      attackerBladeDirection: vec2(0, 1),
      defenderBladeDirection: vec2(0, 1),
      contactNormal: vec2(1, 0),
      defenderBalance: 80,
    });

    expect(clash.kind).toBe("bounce");
    expect(clash.attackerPush).toBe(0);
    expect(clash.defenderPush).toBe(0);
    expect(clash.attackerBounce).toBeGreaterThan(0);
    expect(clash.defenderBounce).toBeGreaterThan(0);

    const state = createInitialState();
    state.player.position = vec2(0, -0.25);
    state.npc.position = vec2(0, 0.25);
    state.player.velocity = vec2(0, 0);
    state.npc.velocity = vec2(0, 0);
    state.pendingHitEvents = [
      {
        id: 201,
        attackerId: "player",
        defenderId: "npc",
        damage: 0,
        balanceLoss: 12,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 4,
        frameCreated: state.frame,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0.2,
        collisionPoint: vec2(0, 0.1),
      },
      {
        id: 202,
        attackerId: "npc",
        defenderId: "player",
        damage: 0,
        balanceLoss: 12,
        knockbackDirection: vec2(0, -1),
        knockbackForce: 4,
        frameCreated: state.frame + 1,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0.2,
        collisionPoint: vec2(0, -0.1),
      },
    ];

    const playerPosition = state.player.position;
    const npcPosition = state.npc.position;
    frame(state, neutralInput, 0);

    expect(state.hitPause).toBe(0);
    expect(state.player.inputLockSeconds).toBe(0);
    expect(state.npc.inputLockSeconds).toBe(0);
    expect(length(state.player.sword.bounceOffset ?? vec2(0, 0))).toBeGreaterThan(0);
    expect(length(state.npc.sword.bounceOffset ?? vec2(0, 0))).toBeGreaterThan(0);
    expect(length(sub(state.player.position, playerPosition))).toBeLessThan(0.35);
    expect(length(sub(state.npc.position, npcPosition))).toBeLessThan(0.35);
    expect(length(sub(state.player.position, state.npc.position))).toBeGreaterThanOrEqual(
      state.player.collisionRadius + state.npc.collisionRadius - 0.01,
    );
    expect(state.player.movementLocked).toBe(false);
    expect(state.npc.movementLocked).toBe(false);
  });

  it("does not punish whiffs with lunges, fatigue, recovery locks, or input freezes", () => {
    const state = createInitialState();
    state.npc.position = vec2(3.8, 0);
    const beforePosition = state.player.position;

    for (let i = 0; i < 24; i += 1) {
      frame(state, { ...neutralInput, swordAim: vec2(1, 1), swordRoll: 1 });
      state.playerHitCooldown = 0;
      state.clashCooldown = 0;
    }

    expect(state.player.inputLockSeconds).toBe(0);
    expect(state.player.fatigue).toBe(0);
    expect(state.player.combatState).not.toBe("RECOVERING");
    expect(length(sub(state.player.position, beforePosition))).toBeLessThan(0.01);
  });

  it("resolves pending hits without character knockback, sliding, or micro-steps", () => {
    const state = createInitialState();
    const playerPosition = state.player.position;
    const npcPosition = state.npc.position;
    state.player.velocity = vec2(0, 0);
    state.npc.velocity = vec2(0, 0);
    state.pendingHitEvents = [
      {
        id: 101,
        attackerId: "player",
        defenderId: "npc",
        damage: 0,
        balanceLoss: 50,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 5,
        frameCreated: state.frame,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0.2,
        collisionPoint: state.npc.position,
      },
    ];

    frame(state, neutralInput, 0);

    expect(state.npc.balance).toBeLessThan(100);
    expect(state.pendingHitEvents).toHaveLength(0);
    expect(state.player.position).toEqual(playerPosition);
    expect(state.npc.position).toEqual(npcPosition);
    expect(length(state.player.velocity)).toBe(0);
    expect(length(state.npc.velocity)).toBe(0);
  });
});
