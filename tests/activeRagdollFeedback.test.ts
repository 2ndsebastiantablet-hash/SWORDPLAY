import { describe, expect, it } from "vitest";
import {
  perfectParryBalanceLoss,
  resolveSwordClash,
  swordBounceDistance,
} from "../src/game/combat";
import { createInitialState, stepDuel, swordWeightFactor } from "../src/game/simulation";
import { length, sub, vec2 } from "../src/game/math";
import {
  arenaSurfaceY,
  clampPinLeanRotation,
  computeCorrectedPinVisualLift,
  computeFighterRootY,
  computePinVisualBottomY,
  computePinVisualLift,
  maxPinLeanRadians,
} from "../src/render/DuelRenderer";
import {
  BOWLING_PIN_BODY_PARTS,
  RAGDOLL_NODE_NAMES,
  bowlingPinBodyHeight,
  bowlingPinFootStubNames,
  createRagdollFighter,
  floatingHandFollowSpeed,
  floatingHandNames,
  getSwordGripTargets,
  maxHandRecoilOffset,
  maxVisualLeanOffset,
  updateRagdollBalanceResponse,
  updateRagdollPhysics,
  applySwordRecoilToHands,
} from "../src/render/ragdollPhysics";

const removedFullBodyRagdollNodes = [
  "pelvis",
  "lowerTorso",
  "upperTorso",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftKnee",
  "rightKnee",
  "leftFoot",
  "rightFoot",
] as const;

const neutralInput = {
  move: vec2(0, 0),
  swordAim: vec2(0, 0.2),
  swordVelocity: vec2(0, 0),
  swordRoll: 0,
  pointerLocked: false,
  restart: false,
};

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe("bowling-pin fighter presentation and sword feedback", () => {
  it("uses heavier sword mouse lag and amplified blade bounce", () => {
    expect(swordWeightFactor).toBeCloseTo(0.07, 3);
    expect(swordBounceDistance).toBeGreaterThanOrEqual(0.64);

    const clash = resolveSwordClash({
      attackerVelocity: vec2(9, 0),
      defenderVelocity: vec2(-7, 0),
      attackerBladeDirection: vec2(1, 0),
      defenderBladeDirection: vec2(1, 0.15),
      contactNormal: vec2(1, 0),
      defenderBalance: 80,
    });

    expect(clash.kind).toBe("bounce");
    expect(clash.attackerBounce).toBeGreaterThan(0.6);
    expect(clash.defenderBounce).toBeGreaterThan(0.6);
    expect(clash.attackerBalanceLoss).toBe(10);
    expect(clash.defenderBalanceLoss).toBe(10);
  });

  it("drains 45 balance on a perfect parry", () => {
    expect(perfectParryBalanceLoss).toBe(45);
  });

  it("removes the old full-body ragdoll skeleton and exposes only floating hand trackers", () => {
    expect(RAGDOLL_NODE_NAMES).toEqual(["leftHand", "rightHand"]);
    expect(floatingHandNames).toEqual(["leftHand", "rightHand"]);
    expect(removedFullBodyRagdollNodes).toEqual(expect.arrayContaining([
      "pelvis",
      "lowerTorso",
      "upperTorso",
      "neck",
      "head",
      "leftShoulder",
      "rightShoulder",
      "leftElbow",
      "rightElbow",
      "leftKnee",
      "rightKnee",
      "leftFoot",
      "rightFoot",
    ]));

    for (const removedNode of removedFullBodyRagdollNodes) {
      expect(RAGDOLL_NODE_NAMES).not.toContain(removedNode);
    }
  });

  it("declares the new pin body, face, and visual-only foot stubs", () => {
    expect(BOWLING_PIN_BODY_PARTS).toEqual([
      "body",
      "faceLeftEye",
      "faceRightEye",
      "faceMouth",
      "leftFootStub",
      "rightFootStub",
    ]);
    expect(bowlingPinFootStubNames).toEqual(["leftFootStub", "rightFootStub"]);
    expect(bowlingPinBodyHeight).toBeGreaterThanOrEqual(1.45);
    expect(bowlingPinBodyHeight).toBeLessThanOrEqual(1.9);
  });

  it("creates floating hands without constraints, shoulder, elbow, spine, knee, or foot nodes", () => {
    const fighter = createRagdollFighter("player", { x: 0, y: 0, z: -1 }, Math.PI / 2);

    expect(Object.keys(fighter.nodes)).toEqual(["leftHand", "rightHand"]);
    expect(fighter.constraints).toHaveLength(0);
    expect(fighter.bodyStyle).toBe("bowling-pin");
    expect(fighter.visualLean).toEqual({ x: 0, y: 0, z: 0 });
    expect(fighter.handRecoilOffset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("makes floating hands chase sword grip targets instead of transmitting forces to a body skeleton", () => {
    const state = createInitialState();
    const fighter = createRagdollFighter("player", { x: state.player.position.x, y: 0, z: state.player.position.y }, state.player.facing);
    const grips = getSwordGripTargets({
      hand: state.player.sword.hand,
      tip: state.player.sword.tip,
      handHeight: state.player.sword.handHeight ?? 1.08,
      tipHeight: state.player.sword.tipHeight ?? 1.35,
    });
    const beforeLeft = distance(fighter.nodes.leftHand.position, grips.leftGrip);
    const beforeRight = distance(fighter.nodes.rightHand.position, grips.rightGrip);

    updateRagdollPhysics(fighter, {
      rootPosition: state.player.position,
      facing: state.player.facing,
      velocity: vec2(0, 0),
      balance: 100,
      maxBalance: 100,
      staggerSeconds: 0,
      falling: false,
      fallSeconds: 0,
      swordHand: state.player.sword.hand,
      swordTip: state.player.sword.tip,
      handHeight: state.player.sword.handHeight ?? 1.08,
      tipHeight: state.player.sword.tipHeight ?? 1.35,
      swordBounceOffset: vec2(0, 0),
      swordVelocity: vec2(0, 0),
      arenaRadius: 4.5,
      time: 0,
    }, 1 / 60);

    expect(floatingHandFollowSpeed).toBeGreaterThan(9);
    expect(distance(fighter.nodes.leftHand.position, grips.leftGrip)).toBeLessThan(beforeLeft);
    expect(distance(fighter.nodes.rightHand.position, grips.rightGrip)).toBeLessThan(beforeRight);
    expect("leftElbow" in fighter.nodes).toBe(false);
    expect("pelvis" in fighter.nodes).toBe(false);
  });

  it("keeps sword recoil on floating hands and visual lean only", () => {
    const fighter = createRagdollFighter("npc", { x: 0, y: 0, z: 1 }, -Math.PI / 2);
    const leftBefore = { ...fighter.nodes.leftHand.position };
    const rightBefore = { ...fighter.nodes.rightHand.position };

    applySwordRecoilToHands(fighter, { x: 40, y: 2, z: -20 }, 999);

    expect(fighter.lastAppliedRecoilForce).toBeGreaterThan(0);
    expect(Math.hypot(fighter.handRecoilOffset.x, fighter.handRecoilOffset.z)).toBeGreaterThan(0);
    expect(Math.hypot(fighter.handRecoilOffset.x, fighter.handRecoilOffset.z)).toBeLessThanOrEqual(maxHandRecoilOffset + 0.001);
    expect(Math.hypot(fighter.visualLeanImpulse.x, fighter.visualLeanImpulse.z)).toBeGreaterThan(0);
    expect(fighter.nodes.leftHand.position).toEqual(leftBefore);
    expect(fighter.nodes.rightHand.position).toEqual(rightBefore);
  });

  it("procedurally weakens visual balance response without activating old muscle springs", () => {
    const stable = updateRagdollBalanceResponse(100, 100, 0);
    const weak = updateRagdollBalanceResponse(25, 100, 0.6);
    const limp = updateRagdollBalanceResponse(0, 100, 0.6);

    expect(stable.bodyLeanScale).toBeLessThan(weak.bodyLeanScale);
    expect(weak.wobbleForce).toBeGreaterThan(stable.wobbleForce);
    expect(limp.limpScale).toBeLessThan(weak.limpScale);
  });

  it("adds bowling-pin body animation state to both fighters", () => {
    const state = createInitialState();

    expect(state.player.body.style).toBe("bowling-pin");
    expect(state.npc.body.style).toBe("bowling-pin");
    expect(state.player.body.leftFootLift).toBe(0);
    expect(state.player.body.rightFootLift).toBe(0);
    expect(state.player.body.stunSeconds).toBe(0);

    stepDuel(state, { ...neutralInput, move: vec2(1, 0) }, 1 / 60);

    expect(state.player.body.walkPhase).toBeGreaterThan(0);
    expect(Math.max(state.player.body.leftFootLift, state.player.body.rightFootLift)).toBeGreaterThan(0);
    expect(Math.hypot(state.player.body.visualLean.x, state.player.body.visualLean.y)).toBeGreaterThan(0);
  });

  it("uses zero balance as a short pin-body tip/stun without health defeat", () => {
    const state = createInitialState();
    state.npc.position = vec2(0, -0.4);
    state.pendingHitEvents = [
      {
        id: 920,
        attackerId: "player",
        defenderId: "npc",
        damage: 0,
        balanceLoss: 130,
        knockbackDirection: vec2(0, 1),
        knockbackForce: 1,
        frameCreated: state.frame,
        hitType: "CLEAN_HIT",
        hitLocation: "body",
        staggerSeconds: 0,
        collisionPoint: state.npc.position,
      },
    ];

    stepDuel(state, neutralInput, 0);
    const stunnedPosition = state.npc.position;
    stepDuel(state, { ...neutralInput, move: vec2(0, 1) }, 1 / 60);

    expect(state.status).toBe("playing");
    expect(state.npc.health).toBe(100);
    expect(state.npc.balance).toBe(0);
    expect(state.npc.body.stunSeconds).toBeGreaterThan(0.5);
    expect(Math.hypot(state.npc.body.visualLean.x, state.npc.body.visualLean.y)).toBeGreaterThan(0);
    expect(length(sub(state.npc.position, stunnedPosition))).toBeLessThan(0.18);
  });

  it("keeps pin-body visual lean clamped during heavy recoil and low balance", () => {
    const state = createInitialState();
    const fighter = createRagdollFighter("npc", { x: state.npc.position.x, y: 0, z: state.npc.position.y }, state.npc.facing);
    applySwordRecoilToHands(fighter, { x: -80, y: 5, z: 40 }, 999);

    updateRagdollPhysics(fighter, {
      rootPosition: state.npc.position,
      facing: state.npc.facing,
      velocity: vec2(0.8, -0.2),
      balance: 35,
      maxBalance: 100,
      staggerSeconds: 0.4,
      falling: false,
      fallSeconds: 0,
      swordHand: state.npc.sword.hand,
      swordTip: state.npc.sword.tip,
      handHeight: state.npc.sword.handHeight ?? 1.08,
      tipHeight: state.npc.sword.tipHeight ?? 1.35,
      swordBounceOffset: vec2(1.2, -0.4),
      swordVelocity: vec2(12, -4),
      arenaRadius: 4.5,
      time: 0.5,
    }, 1 / 20);

    expect(Math.hypot(fighter.visualLean.x, fighter.visualLean.z)).toBeLessThanOrEqual(maxVisualLeanOffset + 0.001);
    expect(Object.keys(fighter.nodes)).toEqual(["leftHand", "rightHand"]);
  });

  it("keeps the pin root clamped to the arena floor while lean and bob stay visual-only", () => {
    const state = createInitialState();
    state.player.body.bob = 0.035;

    expect(computeFighterRootY(state.player)).toBeCloseTo(arenaSurfaceY, 4);

    state.player.falling = true;
    state.player.fallSeconds = 1.2;
    expect(computeFighterRootY(state.player)).toBeLessThan(arenaSurfaceY);
  });

  it("clamps pin lean and raises the visual body so tilting cannot bury the base", () => {
    const state = createInitialState();
    state.npc.balance = 0;
    state.npc.body.stunSeconds = 0.6;

    const clamped = clampPinLeanRotation(state.npc, { x: 3.5, z: -3.5 });
    const maxLean = maxPinLeanRadians(state.npc);

    expect(Math.hypot(clamped.x, clamped.z)).toBeLessThanOrEqual(maxLean + 0.001);
    expect(computePinVisualLift(clamped.x, clamped.z)).toBeGreaterThan(0);
    expect(computePinVisualLift(0, 0)).toBe(0);
  });

  it("applies a final visual floor safety lift when recoil lean would clip below the arena", () => {
    const unsafeLift = -0.18;
    const correctedLift = computeCorrectedPinVisualLift(arenaSurfaceY, unsafeLift, 0.42, -0.32);

    expect(correctedLift).toBeGreaterThan(unsafeLift);
    expect(computePinVisualBottomY(arenaSurfaceY, correctedLift, 0.42, -0.32)).toBeGreaterThanOrEqual(arenaSurfaceY);
  });
});
