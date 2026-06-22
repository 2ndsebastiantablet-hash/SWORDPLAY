import { describe, expect, it } from "vitest";
import { createInitialState, stepDuel } from "../src/game/simulation";
import { vec2 } from "../src/game/math";

const neutralInput = {
  move: vec2(0, 0),
  swordAim: vec2(0.35, 0.2),
  swordVelocity: vec2(0, 0),
  swordRoll: 0,
  pointerLocked: false,
  restart: false,
};

function closeDuelState() {
  const state = createInitialState();
  state.npc.position = vec2(0, -0.75);
  state.npc.velocity = vec2(0, 0);
  state.npcAim = vec2(0, 0.85);
  state.npc.sword.hand = vec2(2, 2);
  state.npc.sword.tip = vec2(2.7, 2.7);
  return state;
}

function swingThroughNpc(state: ReturnType<typeof createInitialState>) {
  stepDuel(
    state,
    {
      ...neutralInput,
      swordAim: vec2(-1, 0.2),
    },
    1 / 60,
  );
  state.playerHitCooldown = 0;
  state.clashCooldown = 0;
  state.hitPause = 0;
  stepDuel(
    state,
    {
      ...neutralInput,
      swordAim: vec2(0, 0.2),
    },
    1 / 60,
  );
  state.hitPause = 0;
  stepDuel(state, neutralInput, 1 / 60);
  state.hitPause = 0;
  stepDuel(state, neutralInput, 1 / 60);
}

describe("internal health and ring-out defeat", () => {
  it("starts both fighters at full health", () => {
    const state = createInitialState();

    expect(state.player.health).toBe(100);
    expect(state.npc.health).toBe(100);
  });

  it("solid unblocked body hits reduce balance without reducing health", () => {
    const state = closeDuelState();
    const startBalance = state.npc.balance;

    swingThroughNpc(state);

    expect(state.npc.health).toBe(100);
    expect(state.npc.balance).toBeLessThan(startBalance);
    expect(state.status).toBe("playing");
  });

  it("does not end the round when a fighter's internal health reaches zero", () => {
    const state = closeDuelState();
    state.npc.health = 0;

    swingThroughNpc(state);

    expect(state.npc.health).toBe(0);
    expect(state.status).toBe("playing");
    expect(state.message).not.toContain("defeated");
  });
});
