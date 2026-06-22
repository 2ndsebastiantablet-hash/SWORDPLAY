import { describe, expect, it } from "vitest";
import { createInitialState, stepDuel } from "../src/game/simulation";
import { length, vec2 } from "../src/game/math";

const neutralInput = {
  move: vec2(0, 0),
  swordAim: vec2(0, 0.2),
  swordVelocity: vec2(0, 0),
  swordRoll: 0,
  pointerLocked: false,
  restart: false,
};

function frame(state: ReturnType<typeof createInitialState>, input = neutralInput) {
  stepDuel(state, input, 1 / 60);
  state.hitPause = 0;
  return state;
}

function readyCloseDuel() {
  const state = createInitialState();
  state.player.position = vec2(0, -0.95);
  state.npc.position = vec2(0, -0.16);
  state.player.velocity = vec2(0, 0);
  state.npc.velocity = vec2(0, 0);
  state.npcAim = vec2(0, 0.2);
  state.clashCooldown = 0;
  state.playerHitCooldown = 0;
  state.npcHitCooldown = 0;
  state.hitPause = 0;
  state.npc.sword.hand = vec2(2, 2);
  state.npc.sword.tip = vec2(2.8, 2.8);
  return state;
}

describe("phase 2 combat matrix integration", () => {
  it("perfect blade contact bounces weapons without sliding the defender backward", () => {
    const state = readyCloseDuel();
    state.npc.inputLockSeconds = 0.3;
    state.npc.combatState = "BLOCKING";
    state.npc.sword.aim = vec2(0, 1);
    state.npc.sword.hand = vec2(0, -0.3);
    state.npc.sword.tip = vec2(0, 0.45);
    state.npc.sword.bladeDirection = vec2(0, 1);
    const defenderBefore = state.npc.position;

    let sawClash = false;
    for (let i = 0; i < 5 && !sawClash; i += 1) {
      frame(state, { ...neutralInput, swordAim: vec2(0, 1) });
      sawClash = state.effects.some((effect) => effect.kind === "clash");
    }
    expect(sawClash).toBe(true);
    expect(state.player.combatState).not.toBe("PARRIED");
    expect(state.player.inputLockSeconds).toBe(0);
    expect(state.npc.health).toBe(100);
    expect(length(vec2(state.npc.position.x - defenderBefore.x, state.npc.position.y - defenderBefore.y))).toBeLessThan(0.04);
  });

  it("poor blade angle allows a clean hit with balance loss and no combat knockback", () => {
    const state = readyCloseDuel();
    const startHealth = state.npc.health;
    const startBalance = state.npc.balance;

    frame(state, { ...neutralInput, swordAim: vec2(1, 0.75) });
    frame(state);
    frame(state);
    frame(state);

    expect(state.npc.health).toBe(startHealth);
    expect(state.npc.balance).toBeLessThan(startBalance);
  });

  it("consecutive clean hits stack balance pressure without adding knockback", () => {
    const state = readyCloseDuel();

    frame(state, { ...neutralInput, swordAim: vec2(1, 0.78) });
    frame(state);
    frame(state);
    frame(state);
    const firstBalance = state.npc.balance;
    state.playerHitCooldown = 0;
    state.hitPause = 0;
    state.player.sword.tip = vec2(-0.45, -0.15);
    state.player.sword.previousTip = vec2(-1.2, -0.15);
    state.player.sword.finalVelocity = vec2(12, 0);
    state.player.sword.velocity = vec2(12, 0);
    state.player.sword.isSlashing = true;

    frame(state, { ...neutralInput, swordAim: vec2(1, 0.78) });
    frame(state);

    expect(state.npc.balance).toBeLessThan(firstBalance);
  });

  it("opposing hits inside the two-frame buffer cancel damage and trigger a clash", () => {
    const state = createInitialState();
    state.player.position = vec2(0, -0.6);
    state.npc.position = vec2(0, 0.6);
    state.pendingHitEvents = [
      {
        id: 900,
        attackerId: "player",
        defenderId: "npc",
        damage: 18,
        balanceLoss: 0.2,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 3,
        frameCreated: state.frame,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0.2,
        collisionPoint: vec2(0, 0.1),
      },
      {
        id: 901,
        attackerId: "npc",
        defenderId: "player",
        damage: 18,
        balanceLoss: 0.2,
        knockbackDirection: vec2(0, -1),
        knockbackForce: 3,
        frameCreated: state.frame + 2,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0.2,
        collisionPoint: vec2(0, -0.1),
      },
    ];
    const playerHealth = state.player.health;
    const npcHealth = state.npc.health;

    frame(state);

    expect(state.player.health).toBe(playerHealth);
    expect(state.npc.health).toBe(npcHealth);
    expect(state.effects.some((effect) => effect.kind === "clash")).toBe(true);
    expect(state.player.combatState).not.toBe("RECOVERING");
    expect(state.npc.combatState).not.toBe("RECOVERING");
    expect(state.player.inputLockSeconds).toBe(0);
    expect(state.npc.inputLockSeconds).toBe(0);
    expect(length(state.player.sword.bounceOffset ?? vec2(0, 0))).toBeGreaterThan(0);
    expect(length(state.npc.sword.bounceOffset ?? vec2(0, 0))).toBeGreaterThan(0);
  });
});
