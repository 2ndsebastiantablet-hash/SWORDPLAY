import { describe, expect, it } from "vitest";
import { chooseNpcIntent } from "../src/game/ai";
import { vec2 } from "../src/game/math";
import type { FighterState } from "../src/game/types";

function bodyState(): FighterState["body"] {
  return {
    style: "bowling-pin",
    walkPhase: 0,
    bob: 0,
    leftFootLift: 0,
    rightFootLift: 0,
    visualLean: vec2(0, 0),
    targetLean: vec2(0, 0),
    recentImpact: vec2(0, 0),
    stunSeconds: 0,
  };
}

const npc: FighterState = {
  id: "npc",
  position: vec2(4.05, 0),
  velocity: vec2(0, 0),
  facing: 0,
  health: 100,
  balance: 65,
  maxBalance: 100,
  isOffBalance: false,
  balanceRecoveryCooldown: 0,
  stumbleTimer: 0,
  fatigue: 0,
  maxFatigue: 100,
  staggerSeconds: 0,
  combatState: "IDLE_GUARD",
  inputLockSeconds: 0,
  lockedStateSeconds: 0,
  sword: {
    hand: vec2(4.05, 0),
    tip: vec2(3.4, 0.8),
    velocity: vec2(0, 0),
    bladeDirection: vec2(-0.62, 0.78),
    guardSide: "center",
  },
  body: bodyState(),
  blocking: false,
  falling: false,
};

const player: FighterState = {
  id: "player",
  position: vec2(1.2, 0),
  velocity: vec2(0, 0),
  facing: 0,
  health: 100,
  balance: 100,
  maxBalance: 100,
  isOffBalance: false,
  balanceRecoveryCooldown: 0,
  stumbleTimer: 0,
  fatigue: 0,
  maxFatigue: 100,
  staggerSeconds: 0,
  combatState: "SLASHING",
  inputLockSeconds: 0,
  lockedStateSeconds: 0,
  sword: {
    hand: vec2(1.2, 0),
    tip: vec2(2.1, 0.6),
    velocity: vec2(5, 0.2),
    bladeDirection: vec2(0.86, 0.51),
    guardSide: "right",
  },
  body: bodyState(),
  blocking: false,
  falling: false,
};

describe("npc intent", () => {
  it("moves back toward center when close to the edge", () => {
    const intent = chooseNpcIntent({
      npc,
      player,
      arenaRadius: 4.5,
      reaction: 1,
      elapsed: 8,
    });

    expect(intent.move.x).toBeLessThan(-0.4);
    expect(intent.pressure).toBeLessThan(0.75);
  });

  it("guards the side suggested by a readable incoming player swing", () => {
    const intent = chooseNpcIntent({
      npc: { ...npc, position: vec2(0.4, 0), balance: 100 },
      player,
      arenaRadius: 4.5,
      reaction: 1,
      elapsed: 3,
    });

    expect(intent.guardSide).toBe("right");
    expect(intent.swordTarget.x).toBeGreaterThan(0);
  });
});
