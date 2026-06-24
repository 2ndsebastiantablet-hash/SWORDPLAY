import { describe, expect, it } from "vitest";
import {
  arenaFloorY,
  createInitialState,
  forceUnstickFighter,
  movementMultiplierForFighter,
  stepDuel,
} from "../src/game/simulation";
import { Hud } from "../src/ui/Hud";
import {
  criticalBalanceThreshold,
  defaultBalance,
  lowBalanceThreshold,
  maxBalance,
  offBalanceThreshold,
  staggerBalanceThreshold,
} from "../src/game/combat";
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
  state.hitPause = 0;
  return state;
}

describe("phase 3 balance, pacing, and ring-out", () => {
  it("starts fighters with 0-100 balance and hidden fatigue state", () => {
    const state = createInitialState();

    expect(maxBalance).toBe(100);
    expect(defaultBalance).toBe(100);
    expect(lowBalanceThreshold).toBe(60);
    expect(staggerBalanceThreshold).toBe(35);
    expect(offBalanceThreshold).toBe(30);
    expect(criticalBalanceThreshold).toBe(15);
    expect(state.player.balance).toBe(100);
    expect(state.player.maxBalance).toBe(100);
    expect(state.player.fatigue).toBe(0);
    expect(state.player.maxFatigue).toBe(100);
    expect(state.player.balanceRecoveryCooldown).toBe(0);
    expect(state.player.stumbleTimer).toBe(0);
  });

  it("does not end the round when internal health reaches zero", () => {
    const state = createInitialState();

    state.npc.health = 0;
    frame(state);

    expect(state.status).toBe("playing");
    expect(state.message).not.toContain("defeated");
  });

  it("uses ring-out as the only win condition", () => {
    const state = createInitialState();

    state.npc.position = vec2(state.arenaRadius + 0.35, 0);
    frame(state);

    expect(state.status).toBe("playerWon");
    expect(state.npc.falling).toBe(true);
    expect(state.message).toContain("knocked out");
  });

  it("applies off-balance state and cooldown without character knockback", () => {
    const state = createInitialState();
    state.npc.position = vec2(0, -0.4);
    state.npc.sword.hand = vec2(2, 2);
    state.npc.sword.tip = vec2(2.8, 2.8);

    state.pendingHitEvents = [
      {
        id: 700,
        attackerId: "player",
        defenderId: "npc",
        damage: 30,
        balanceLoss: 75,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 2,
        frameCreated: state.frame - 2,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0.2,
        collisionPoint: state.npc.position,
      },
    ];

    frame(state, neutralInput, 0);

    expect(state.npc.health).toBe(100);
    expect(state.npc.balance).toBeLessThan(offBalanceThreshold);
    expect(state.npc.isOffBalance).toBe(true);
    expect(state.npc.combatState).toBe("OFF_BALANCE");
    expect(state.npc.balanceRecoveryCooldown).toBeGreaterThan(1);
    expect(state.npc.stumbleTimer).toBeGreaterThan(0.6);
    expect(length(state.npc.velocity)).toBe(0);
  });

  it("recovers balance only after combat cooldown and slower near the edge", () => {
    const center = createInitialState();
    const edge = createInitialState();
    center.player.balance = 50;
    edge.player.balance = 50;
    center.player.balanceRecoveryCooldown = 0;
    edge.player.balanceRecoveryCooldown = 0;
    edge.player.position = vec2(edge.arenaRadius - 1.3, 0);

    frame(center);
    frame(edge);

    expect(center.player.balance).toBeGreaterThan(50);
    expect(edge.player.balance).toBeGreaterThan(50);
    expect(center.player.balance).toBeGreaterThan(edge.player.balance);
  });

  it("keeps off-balance movement controllable and only fully stops at zero-balance stun", () => {
    const normal = createInitialState();
    const offBalance = createInitialState();
    const stunned = createInitialState();

    offBalance.player.balance = 20;
    offBalance.player.isOffBalance = true;
    offBalance.player.stumbleTimer = 0.5;
    offBalance.player.combatState = "OFF_BALANCE";

    stunned.player.balance = 0;
    stunned.player.body.stunSeconds = 0.4;
    stunned.player.combatState = "CRITICAL_STUMBLE";

    expect(movementMultiplierForFighter(normal.player)).toBe(1);
    expect(movementMultiplierForFighter(offBalance.player)).toBeGreaterThan(0.5);
    expect(movementMultiplierForFighter(offBalance.player)).toBeLessThan(1);
    expect(movementMultiplierForFighter(stunned.player)).toBe(0);
  });

  it("repairs a corrupted in-arena root every frame and restores movement flags", () => {
    const state = createInitialState();
    state.player.rootHeight = arenaFloorY - 2;
    state.player.verticalVelocity = -30;
    state.player.isGrounded = false;
    state.player.isStuck = true;
    state.player.canMove = false;
    state.player.movementLocked = true;
    state.player.blockedByFloor = true;
    state.player.balance = 45;
    state.player.body.stunSeconds = 0;

    frame(state, { ...neutralInput, move: vec2(0, 1) });

    expect(state.player.rootHeight).toBe(arenaFloorY);
    expect(state.player.verticalVelocity).toBe(0);
    expect(state.player.isGrounded).toBe(true);
    expect(state.player.isStuck).toBe(false);
    expect(state.player.canMove).toBe(true);
    expect(state.player.movementLocked).toBe(false);
    expect(state.player.blockedByFloor).toBe(false);
    expect(length(state.player.velocity)).toBeGreaterThan(0.05);
  });

  it("does not let the floor unstick controller rescue a real ring-out", () => {
    const state = createInitialState();
    state.npc.position = vec2(state.arenaRadius + 0.35, 0);
    state.npc.rootHeight = arenaFloorY;

    frame(state);
    frame(state);

    expect(state.status).toBe("playerWon");
    expect(state.npc.falling).toBe(true);
    expect(state.npc.rootHeight).toBeLessThan(arenaFloorY);
  });

  it("keeps zero-balance stun on the floor and restores movement after the stun timer", () => {
    const state = createInitialState();
    state.player.balance = 0;
    state.player.body.stunSeconds = 0.6;
    state.player.rootHeight = arenaFloorY - 1;
    state.player.verticalVelocity = -12;
    state.npc.position = vec2(3.2, 0);
    state.npc.sword.hand = vec2(8, 8);
    state.npc.sword.tip = vec2(9, 9);
    state.npcHitCooldown = 999;
    state.playerHitCooldown = 999;
    state.clashCooldown = 999;
    forceUnstickFighter(state.player, state.arenaRadius);

    expect(state.player.rootHeight).toBe(arenaFloorY);
    expect(state.player.canMove).toBe(false);
    expect(state.player.movementLocked).toBe(true);

    for (let i = 0; i < 42; i += 1) {
      frame(state, { ...neutralInput, move: vec2(0, 1) });
    }

    expect(state.player.rootHeight).toBe(arenaFloorY);
    expect(state.player.canMove).toBe(true);
    expect(state.player.movementLocked).toBe(false);
  });

  it("returns off-balance fighters to a controllable recovery state instead of keeping them stuck", () => {
    const state = createInitialState();
    state.player.balance = 20;
    state.player.isOffBalance = true;
    state.player.stumbleTimer = 0.12;
    state.player.balanceRecoveryCooldown = 0;
    state.player.combatState = "OFF_BALANCE";

    for (let i = 0; i < 18; i += 1) {
      frame(state, { ...neutralInput, move: vec2(0, 1) });
    }

    expect(state.player.isOffBalance).toBe(false);
    expect(state.player.combatState).not.toBe("OFF_BALANCE");
    expect(state.player.combatState).not.toBe("CRITICAL_STUMBLE");
    expect(length(state.player.velocity)).toBeGreaterThan(0.05);
  });

  it("does not add fatigue, recovery exposure, or lunging when a hard swing whiffs", () => {
    const state = createInitialState();
    state.npc.position = vec2(3.7, 0);
    const beforePosition = state.player.position;

    frame(state, { ...neutralInput, swordAim: vec2(1, 1) });
    for (let i = 0; i < 24; i += 1) {
      state.playerHitCooldown = 0;
      state.clashCooldown = 0;
      frame(state, neutralInput);
    }

    expect(state.player.fatigue).toBe(0);
    expect(state.player.combatState).not.toBe("RECOVERING");
    expect(length(sub(state.player.position, beforePosition))).toBeLessThan(0.01);
  });

  it("gently restores neutral spacing without teleporting the player", () => {
    const state = createInitialState();
    state.player.position = vec2(0, -1);
    state.npc.position = vec2(0, 4.4);
    const playerBefore = state.player.position;
    const startingDistance = length(sub(state.player.position, state.npc.position));

    for (let i = 0; i < 20; i += 1) {
      frame(state);
    }

    expect(length(sub(state.player.position, state.npc.position))).toBeLessThan(startingDistance);
    expect(length(sub(state.player.position, playerBefore))).toBeLessThan(0.35);
  });

  it("removes visible health UI from the HUD source", () => {
    const hudSource = Hud.toString();

    expect(hudSource).not.toMatch(/HP|health-meter|data-player-health-fill|data-npc-health-fill/i);
  });

  it("forces locked combat states back to neutral control after the safety window", () => {
    const state = createInitialState();
    state.player.combatState = "PARRIED";
    state.player.inputLockSeconds = 2;
    state.player.staggerSeconds = 2;
    state.player.stumbleTimer = 2;

    for (let i = 0; i < 30; i += 1) {
      frame(state, { ...neutralInput, move: vec2(0, 1), swordAim: vec2(0.2, 0.2) });
    }

    expect(state.player.inputLockSeconds).toBe(0);
    expect(state.player.staggerSeconds).toBe(0);
    expect(state.player.stumbleTimer).toBe(0);
    expect(state.player.combatState).not.toBe("PARRIED");
    expect(state.player.sword.aim?.x).toBeGreaterThan(0.1);
  });

  it("empties pending hit events every frame after resolving combat", () => {
    const state = createInitialState();
    state.pendingHitEvents = [
      {
        id: 800,
        attackerId: "player",
        defenderId: "npc",
        damage: 0,
        balanceLoss: 10,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 1,
        frameCreated: state.frame,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0.1,
        collisionPoint: state.npc.position,
      },
    ];

    frame(state);

    expect(state.pendingHitEvents).toHaveLength(0);
  });

  it("keeps pending-hit character velocity at zero regardless of remaining balance", () => {
    const fresh = createInitialState();
    const unstable = createInitialState();
    fresh.npc.balance = 100;
    unstable.npc.balance = 25;

    fresh.pendingHitEvents = [
      {
        id: 810,
        attackerId: "player",
        defenderId: "npc",
        damage: 0,
        balanceLoss: 8,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 1,
        frameCreated: fresh.frame,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0,
        collisionPoint: fresh.npc.position,
      },
    ];
    unstable.pendingHitEvents = [
      {
        id: 811,
        attackerId: "player",
        defenderId: "npc",
        damage: 0,
        balanceLoss: 8,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 1,
        frameCreated: unstable.frame,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0,
        collisionPoint: unstable.npc.position,
      },
    ];

    frame(fresh, neutralInput, 0);
    frame(unstable, neutralInput, 0);

    expect(fresh.npc.balance).toBeLessThan(100);
    expect(unstable.npc.balance).toBeLessThan(25);
    expect(length(fresh.npc.velocity)).toBe(0);
    expect(length(unstable.npc.velocity)).toBe(0);
  });
});
