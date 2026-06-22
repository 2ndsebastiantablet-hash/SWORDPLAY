import { describe, expect, it } from "vitest";
import { mapMovementKeys } from "../src/input/inputMapping";
import { createInitialState, stepDuel } from "../src/game/simulation";
import { length, sub, vec2 } from "../src/game/math";

const neutralInput = {
  move: vec2(0, 0),
  swordAim: vec2(0, 0.15),
  swordVelocity: vec2(0, 0),
  swordRoll: 0,
  pointerLocked: false,
  restart: false,
};

function quietDuel() {
  const state = createInitialState();
  state.npc.position = vec2(3.2, 3.2);
  state.npc.velocity = vec2(0, 0);
  state.npc.sword.hand = vec2(3.2, 3.2);
  state.npc.sword.tip = vec2(3.2, 4.1);
  return state;
}

describe("phase 1 unified sword physics", () => {
  it("keeps WASD movement unchanged while adding stance bias to the sword target", () => {
    expect(mapMovementKeys(new Set(["KeyA"]))).toEqual(vec2(1, 0));
    expect(mapMovementKeys(new Set(["KeyD"]))).toEqual(vec2(-1, 0));

    const neutral = quietDuel();
    const forward = quietDuel();
    stepDuel(neutral, neutralInput, 1 / 60);
    stepDuel(forward, { ...neutralInput, move: vec2(0, 1) }, 1 / 60);

    const neutralReach = neutral.player.sword.targetTip!.y - neutral.player.position.y;
    const forwardReach = forward.player.sword.targetTip!.y - forward.player.position.y;
    expect(forwardReach).toBeGreaterThan(neutralReach + 0.12);
  });

  it("moves the actual sword toward its mouse target with weighted drag instead of snapping", () => {
    const state = quietDuel();
    const startingTip = state.player.sword.tip;
    const aggressiveAim = { ...neutralInput, swordAim: vec2(1, 0.9), swordRoll: 0.9 };

    stepDuel(state, aggressiveAim, 1 / 60);
    const firstDistance = length(sub(state.player.sword.targetTip!, state.player.sword.tip));
    const targetDistanceFromStart = length(sub(state.player.sword.targetTip!, startingTip));

    expect(firstDistance).toBeGreaterThan(0.05);
    expect(firstDistance).toBeLessThan(targetDistanceFromStart);

    stepDuel(state, aggressiveAim, 1 / 60);
    const secondDistance = length(sub(state.player.sword.targetTip!, state.player.sword.tip));
    expect(secondDistance).toBeLessThan(firstDistance);
  });

  it("reports true tip velocity plus body movement as final sword velocity", () => {
    const state = quietDuel();

    stepDuel(state, { ...neutralInput, swordAim: vec2(1, 0.55), move: vec2(0, 1) }, 1 / 60);

    expect(state.player.sword.previousTip).toBeDefined();
    expect(state.player.sword.currentTip).toEqual(state.player.sword.tip);
    expect(length(state.player.sword.characterVelocity!)).toBeGreaterThan(0);
    expect(length(state.player.sword.finalVelocity!)).toBeGreaterThan(length(state.player.sword.tipVelocity!));
  });

  it("does not mark resting or slow sword contact as a damaging slash", () => {
    const state = createInitialState();
    state.npc.position = vec2(0, -0.72);
    state.npc.velocity = vec2(0, 0);
    state.npc.sword.hand = vec2(2, 2);
    state.npc.sword.tip = vec2(2.7, 2.7);

    for (let i = 0; i < 6; i += 1) {
      stepDuel(state, neutralInput, 1 / 60);
      state.hitPause = 0;
      state.playerHitCooldown = 0;
      state.clashCooldown = 0;
    }

    expect(state.player.sword.isSlashing).toBe(false);
    expect(state.npc.health).toBe(100);
  });
});
