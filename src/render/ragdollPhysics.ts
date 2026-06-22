import { clamp, length as length2, type Vec2 } from "../game/math";
import type { FighterId } from "../game/types";

export const RAGDOLL_NODE_NAMES = ["leftHand", "rightHand"] as const;
export const floatingHandNames = RAGDOLL_NODE_NAMES;
export type RagdollNodeName = (typeof RAGDOLL_NODE_NAMES)[number];

export const BOWLING_PIN_BODY_PARTS = [
  "body",
  "faceLeftEye",
  "faceRightEye",
  "faceMouth",
  "leftFootStub",
  "rightFootStub",
] as const;
export const bowlingPinFootStubNames = ["leftFootStub", "rightFootStub"] as const;

export const bowlingPinBodyHeight = 1.68;
export const bowlingPinBodyRadius = 0.42;
export const bowlingPinHeadRadius = 0.22;
export const floatingHandFollowSpeed = 14.5;
export const handRecoilDecay = 8.5;
export const maxHandRecoilOffset = 0.42;
export const maxVisualLeanOffset = 0.28;
export const visualLeanRecoverySpeed = 9.5;
export const swordGripSeparation = 0.18;

export type RagdollVector = {
  x: number;
  y: number;
  z: number;
};

export type RagdollUpdateInput = {
  rootPosition: Vec2;
  facing: number;
  velocity: Vec2;
  balance: number;
  maxBalance: number;
  staggerSeconds: number;
  falling: boolean;
  fallSeconds: number;
  swordHand: Vec2;
  swordTip: Vec2;
  handHeight: number;
  tipHeight: number;
  swordBounceOffset: Vec2;
  swordVelocity: Vec2;
  arenaRadius: number;
  time: number;
};

export type SwordGripTargets = {
  hilt: RagdollVector;
  leftGrip: RagdollVector;
  rightGrip: RagdollVector;
  tip: RagdollVector;
  bladeDirection: RagdollVector;
};

export type RagdollBalanceResponse = {
  bodyLeanScale: number;
  handGripScale: number;
  wobbleForce: number;
  limpScale: number;
  muscleScale: number;
  walkingScale: number;
  gripScale: number;
  nodeDamping: number;
  recoveryScale: number;
};

function v(x = 0, y = 0, z = 0): RagdollVector {
  return { x, y, z };
}

function clone(a: RagdollVector): RagdollVector {
  return { x: a.x, y: a.y, z: a.z };
}

function add3(a: RagdollVector, b: RagdollVector): RagdollVector {
  return v(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub3(a: RagdollVector, b: RagdollVector): RagdollVector {
  return v(a.x - b.x, a.y - b.y, a.z - b.z);
}

function scale3(a: RagdollVector, amount: number): RagdollVector {
  return v(a.x * amount, a.y * amount, a.z * amount);
}

function length3(a: RagdollVector): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize3(a: RagdollVector, fallback = v(0, 1, 0)): RagdollVector {
  const magnitude = length3(a);
  if (magnitude <= 0.00001) return clone(fallback);
  return scale3(a, 1 / magnitude);
}

function clampLength3(vector: RagdollVector, maxLength: number): RagdollVector {
  const magnitude = length3(vector);
  if (magnitude <= maxLength || magnitude <= 0.00001) return clone(vector);
  return scale3(vector, maxLength / magnitude);
}

function lerp3(a: RagdollVector, b: RagdollVector, t: number): RagdollVector {
  return v(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

function fromVec2(position: Vec2, y = 0): RagdollVector {
  return v(position.x, y, position.y);
}

function forwardFromFacing(facing: number): RagdollVector {
  return v(Math.cos(facing), 0, Math.sin(facing));
}

function rightFromForward(forward: RagdollVector): RagdollVector {
  return normalize3(v(forward.z, 0, -forward.x), v(1, 0, 0));
}

function handStart(origin: RagdollVector, facing: number, side: -1 | 1): RagdollVector {
  const forward = forwardFromFacing(facing);
  const right = rightFromForward(forward);
  return add3(add3(origin, v(0, 1.04, 0)), add3(scale3(forward, 0.34), scale3(right, side * 0.12)));
}

export class FloatingHandNode {
  readonly name: RagdollNodeName;
  position: RagdollVector;
  previousPosition: RagdollVector;
  radius: number;
  mass: number;
  damping: number;

  constructor(name: RagdollNodeName, position: RagdollVector) {
    this.name = name;
    this.position = clone(position);
    this.previousPosition = clone(position);
    this.radius = 0.085;
    this.mass = 0.35;
    this.damping = 0.92;
  }

  velocity(): RagdollVector {
    return sub3(this.position, this.previousPosition);
  }

  setPosition(position: RagdollVector): void {
    this.previousPosition = clone(this.position);
    this.position = clone(position);
  }

  applyImpulse(impulse: RagdollVector): void {
    this.previousPosition = sub3(this.previousPosition, scale3(impulse, 1 / Math.max(this.mass, 0.001)));
  }
}

export class RagdollFighter {
  readonly id: FighterId;
  readonly bodyStyle = "bowling-pin";
  readonly nodes: Record<RagdollNodeName, FloatingHandNode>;
  readonly constraints: [];
  lastSwordBounce: RagdollVector;
  lastRootPosition: RagdollVector;
  response: RagdollBalanceResponse;
  handRecoilOffset: RagdollVector;
  visualLean: RagdollVector;
  visualLeanImpulse: RagdollVector;
  lastImpactDirection: RagdollVector;
  lastAppliedRecoilForce: number;
  recentHeavyImpactTimer: number;
  gripRelaxTimer: number;
  limpSeconds: number;

  constructor(id: FighterId, origin: RagdollVector, facing: number) {
    this.id = id;
    this.nodes = {
      leftHand: new FloatingHandNode("leftHand", handStart(origin, facing, -1)),
      rightHand: new FloatingHandNode("rightHand", handStart(origin, facing, 1)),
    };
    this.constraints = [];
    this.lastSwordBounce = v();
    this.lastRootPosition = clone(origin);
    this.response = updateRagdollBalanceResponse(100, 100, 0);
    this.handRecoilOffset = v();
    this.visualLean = v();
    this.visualLeanImpulse = v();
    this.lastImpactDirection = forwardFromFacing(facing);
    this.lastAppliedRecoilForce = 0;
    this.recentHeavyImpactTimer = 0;
    this.gripRelaxTimer = 0;
    this.limpSeconds = 0;
  }

  reset(origin: RagdollVector, facing: number): void {
    this.nodes.leftHand.setPosition(handStart(origin, facing, -1));
    this.nodes.rightHand.setPosition(handStart(origin, facing, 1));
    this.lastRootPosition = clone(origin);
    this.lastSwordBounce = v();
    this.handRecoilOffset = v();
    this.visualLean = v();
    this.visualLeanImpulse = v();
    this.lastImpactDirection = forwardFromFacing(facing);
    this.lastAppliedRecoilForce = 0;
    this.recentHeavyImpactTimer = 0;
    this.gripRelaxTimer = 0;
    this.limpSeconds = 0;
  }
}

export function createRagdollFighter(id: FighterId, origin: RagdollVector, facing: number): RagdollFighter {
  return new RagdollFighter(id, origin, facing);
}

export function updateRagdollBalanceResponse(balance: number, maxBalance: number, staggerSeconds: number): RagdollBalanceResponse {
  const ratio = clamp(balance / Math.max(maxBalance, 1), 0, 1);
  const missing = 1 - ratio;
  const stagger = clamp(staggerSeconds / 0.6, 0, 1);
  const limpScale = ratio <= 0.001 ? 0.12 : clamp(1 - stagger * 0.32 - missing * 0.18, 0.28, 1);
  const bodyLeanScale = clamp(missing + stagger * 0.55, 0, 1.35);
  const handGripScale = clamp(1 - missing * 0.22, 0.65, 1);

  return {
    bodyLeanScale,
    handGripScale,
    wobbleForce: missing * 0.16 + stagger * 0.12,
    limpScale,
    muscleScale: limpScale,
    walkingScale: clamp(0.52 + ratio * 0.48, 0.52, 1),
    gripScale: handGripScale,
    nodeDamping: 0.92,
    recoveryScale: ratio,
  };
}

export function getSwordGripTargets(input: { hand: Vec2; tip: Vec2; handHeight: number; tipHeight: number }): SwordGripTargets {
  const hilt = fromVec2(input.hand, input.handHeight);
  const tip = fromVec2(input.tip, input.tipHeight);
  const bladeDirection = normalize3(sub3(tip, hilt), v(0, 0.2, 1));
  const side = normalize3(v(bladeDirection.z, 0, -bladeDirection.x), v(1, 0, 0));
  const leftGrip = add3(hilt, scale3(side, -swordGripSeparation * 0.5));
  const rightGrip = add3(hilt, scale3(side, swordGripSeparation * 0.5));

  return {
    hilt,
    leftGrip,
    rightGrip,
    tip,
    bladeDirection,
  };
}

export function applyRagdollVisualImpact(ragdoll: RagdollFighter, direction: RagdollVector, force: number): void {
  const impactDirection = normalize3(direction, ragdoll.lastImpactDirection);
  const clampedForce = clamp(force, 0, 4);
  ragdoll.lastImpactDirection = impactDirection;
  ragdoll.visualLeanImpulse = clampLength3(
    add3(ragdoll.visualLeanImpulse, scale3(impactDirection, clampedForce * 0.055)),
    maxVisualLeanOffset,
  );
  ragdoll.recentHeavyImpactTimer = Math.max(ragdoll.recentHeavyImpactTimer, 0.18);
}

export function applySwordRecoilToHands(ragdoll: RagdollFighter, direction: RagdollVector, force: number): void {
  const impactDirection = normalize3(direction, ragdoll.lastImpactDirection);
  const clampedForce = clamp(force, 0, 4);
  ragdoll.lastAppliedRecoilForce = clampedForce;
  ragdoll.handRecoilOffset = clampLength3(
    add3(ragdoll.handRecoilOffset, scale3(impactDirection, clampedForce * 0.14)),
    maxHandRecoilOffset,
  );
  applyRagdollVisualImpact(ragdoll, impactDirection, clampedForce * 0.6);
  ragdoll.gripRelaxTimer = Math.max(ragdoll.gripRelaxTimer, 0.14);
}

function updateVisualLean(ragdoll: RagdollFighter, input: RagdollUpdateInput, response: RagdollBalanceResponse, dt: number): void {
  const forward = forwardFromFacing(input.facing);
  const right = rightFromForward(forward);
  const velocity = fromVec2(input.velocity, 0);
  const speed = length2(input.velocity);
  const moveDirection = speed > 0.01 ? normalize3(velocity, forward) : v();
  const moveLean = add3(
    scale3(forward, (moveDirection.x * forward.x + moveDirection.z * forward.z) * clamp(speed / 2.35, -1, 1) * 0.045),
    scale3(right, (moveDirection.x * right.x + moveDirection.z * right.z) * clamp(speed / 2.35, -1, 1) * 0.04),
  );
  const wobble = response.wobbleForce > 0.001
    ? add3(
        scale3(right, Math.sin(input.time * 9.5 + (ragdoll.id === "player" ? 0 : Math.PI)) * response.wobbleForce),
        scale3(forward, Math.cos(input.time * 7.25) * response.wobbleForce * 0.55),
      )
    : v();
  const limpLean = response.limpScale < 0.35 ? scale3(ragdoll.lastImpactDirection, 0.2) : v();
  const fallingLean = input.falling ? scale3(normalize3(fromVec2(input.rootPosition, 0), forward), 0.25 + Math.min(0.2, input.fallSeconds * 0.08)) : v();
  const target = clampLength3(add3(add3(add3(moveLean, wobble), limpLean), add3(fallingLean, ragdoll.visualLeanImpulse)), maxVisualLeanOffset);
  const leanT = clamp(1 - Math.exp(-dt * visualLeanRecoverySpeed * (0.35 + response.limpScale * 0.65)), 0, 1);

  ragdoll.visualLean = lerp3(ragdoll.visualLean, target, leanT);
  ragdoll.visualLeanImpulse = scale3(ragdoll.visualLeanImpulse, Math.exp(-dt * 6.5));
}

export function updateRagdollPhysics(ragdoll: RagdollFighter, input: RagdollUpdateInput, dt: number): void {
  const safeDt = clamp(dt, 0, 1 / 20);
  const root = fromVec2(input.rootPosition, 0);
  const rootDelta = sub3(root, ragdoll.lastRootPosition);
  if (!Number.isFinite(root.x + root.y + root.z) || length3(rootDelta) > 8) {
    ragdoll.reset(root, input.facing);
  }

  ragdoll.limpSeconds = input.balance <= 0.001 && !input.falling
    ? Math.max(ragdoll.limpSeconds, 0.6)
    : Math.max(0, ragdoll.limpSeconds - safeDt);

  const response = updateRagdollBalanceResponse(input.balance, input.maxBalance, Math.max(input.staggerSeconds, ragdoll.limpSeconds));
  ragdoll.response = response;
  updateVisualLean(ragdoll, input, response, safeDt);

  const bounce = fromVec2(input.swordBounceOffset, 0);
  const bounceDelta = sub3(bounce, ragdoll.lastSwordBounce);
  if (length3(bounceDelta) > 0.025) {
    applySwordRecoilToHands(ragdoll, bounceDelta, length3(bounceDelta) * 2.2);
  }
  ragdoll.lastSwordBounce = clone(bounce);

  const swordVelocity = fromVec2(input.swordVelocity, 0);
  if (length3(swordVelocity) > 7) {
    ragdoll.handRecoilOffset = clampLength3(
      add3(ragdoll.handRecoilOffset, scale3(normalize3(swordVelocity), Math.min(0.08, length3(swordVelocity) * 0.004))),
      maxHandRecoilOffset,
    );
  }

  ragdoll.handRecoilOffset = scale3(ragdoll.handRecoilOffset, Math.exp(-safeDt * handRecoilDecay));
  const grips = getSwordGripTargets({
    hand: input.swordHand,
    tip: input.swordTip,
    handHeight: input.handHeight,
    tipHeight: input.tipHeight,
  });
  const followT = clamp(1 - Math.exp(-safeDt * floatingHandFollowSpeed * response.handGripScale), 0, 1);
  const leftTarget = add3(grips.leftGrip, ragdoll.handRecoilOffset);
  const rightTarget = add3(grips.rightGrip, ragdoll.handRecoilOffset);

  ragdoll.nodes.leftHand.setPosition(lerp3(ragdoll.nodes.leftHand.position, leftTarget, followT));
  ragdoll.nodes.rightHand.setPosition(lerp3(ragdoll.nodes.rightHand.position, rightTarget, followT));
  ragdoll.recentHeavyImpactTimer = Math.max(0, ragdoll.recentHeavyImpactTimer - safeDt);
  ragdoll.gripRelaxTimer = Math.max(0, ragdoll.gripRelaxTimer - safeDt);
  ragdoll.lastRootPosition = clone(root);
}
