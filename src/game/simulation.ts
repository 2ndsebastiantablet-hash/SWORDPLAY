import { chooseNpcIntent } from "./ai";
import {
  add,
  angleOf,
  clamp,
  clamp01,
  clampMagnitude,
  distancePointToSegment,
  distanceSegmentToSegment,
  dot,
  fromAngle,
  length,
  lerp,
  lerpVec,
  moveToward,
  normalize,
  perpendicularRight,
  scale,
  sub,
  vec2,
  type Vec2,
} from "./math";
import {
  applyBalanceRecovery,
  criticalBalanceThreshold,
  defaultBalance,
  lowBalanceThreshold,
  maxBalance,
  offBalanceThreshold,
  isRingOut,
  perfectParryBalanceLoss,
  perfectParryStaggerSeconds,
  resolveBodyHit,
  resolveCombatMatrix,
  resolveSwordClash,
  staggerBalanceThreshold,
} from "./combat";
import type {
  DuelState,
  FighterState,
  GuardSide,
  ImpactEvent,
  ImpactKind,
  PendingHitEvent,
  PlayerInputFrame,
} from "./types";

export const ARENA_RADIUS = 4.5;
const FIGHTER_RADIUS = 0.42;
const BASE_SPEED = 2.35;
const NPC_REACTION = 0.72;
const SWORD_TARGET_SPEED = 4.9;
const MAX_HEALTH = 100;
export const swordWeightFactor = 0.07;
export const swordBounceDecay = 0.72;
export const maxSwordReach = 2.2;
export const minSwordGuardDistance = 0.7;
export const minimumHitVelocity = 4.0;
export const heavyHitVelocity = 12.0;
const simultaneousHitBufferFrames = 2;
const maxLockedStateSeconds = 0.4;
const balanceRecoveryCooldownSeconds = 1.5;
const stumbleDuration = 0.75;
const criticalStumbleDuration = 1.15;
const offBalanceRecoverySeconds = 0.38;
const knockbackSlideBaseDistance = 0.42;
const knockbackSlideDuration = 0.18;
const fatigueRecoveryRate = 3.0;
const heavySwingFatigueGain = 6;
const blockedStrikeFatigueGain = 10;
const guardBreakFatigueGain = 12;
const fatigueStunMultiplier = 1.25;
const edgeDangerDistance = 1.25;
const edgeBalanceDamageMultiplier = 1.25;
export const zeroBalancePinStunSeconds = 0.6;

function makeBodyState(): FighterState["body"] {
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
    recoverySeconds: 0,
  };
}

function emptySword(position: Vec2, guardSide: GuardSide = "center") {
  return {
    hand: vec2(position.x, position.y),
    tip: vec2(position.x, position.y + 0.9),
    velocity: vec2(0, 0),
    bladeDirection: vec2(0, 1),
    bounceOffset: vec2(0, 0),
    guardSide,
    handHeight: 1.08,
    tipHeight: 1.35,
    aim: vec2(0, 0.2),
    roll: 0,
  };
}

function makeFighter(id: "player" | "npc", position: Vec2): FighterState {
  return {
    id,
    position,
    velocity: vec2(0, 0),
    facing: id === "player" ? Math.PI / 2 : -Math.PI / 2,
    health: MAX_HEALTH,
    balance: defaultBalance,
    maxBalance,
    isOffBalance: false,
    balanceRecoveryCooldown: 0,
    stumbleTimer: 0,
    fatigue: 0,
    maxFatigue: 100,
    lastKnockbackDirection: vec2(0, id === "player" ? -1 : 1),
    staggerSeconds: 0,
    combatState: "IDLE_GUARD",
    inputLockSeconds: 0,
    lockedStateSeconds: 0,
    sword: emptySword(position),
    body: makeBodyState(),
    blocking: false,
    falling: false,
    fallSeconds: 0,
  };
}

export function createInitialState(round = 1): DuelState {
  const state: DuelState = {
    player: makeFighter("player", vec2(0, -1.55)),
    npc: makeFighter("npc", vec2(0, 1.55)),
    status: "playing",
    message: "Push your rival off the edge",
    elapsed: 0,
    round,
    arenaRadius: ARENA_RADIUS,
    npcAim: vec2(0, 0.18),
    npcRoll: 0,
    clashCooldown: 0,
    playerHitCooldown: 0,
    npcHitCooldown: 0,
    hitPause: 0,
    shake: 0,
    nextImpactId: 1,
    effects: [],
    frame: 0,
    pendingHitEvents: [],
  };
  updateFacing(state.player, state.npc);
  updateSwordPhysics(state.player, vec2(0.35, 0.18), 0, vec2(0, 0), 1 / 60);
  updateSwordPhysics(state.npc, state.npcAim, 0, vec2(0, 0), 1 / 60);
  return state;
}

function updateFacing(a: FighterState, b: FighterState): void {
  const toB = normalize(sub(b.position, a.position), fromAngle(a.facing));
  a.facing = angleOf(toB);
  b.facing = angleOf(scale(toB, -1));
}

function movementBasis(fighter: FighterState) {
  const forward = fromAngle(fighter.facing);
  const right = perpendicularRight(forward);
  return { forward, right };
}

function balanceRatio(fighter: FighterState): number {
  return clamp01(fighter.balance / Math.max(fighter.maxBalance, 1));
}

function fatigueFactor(fighter: FighterState): number {
  return clamp01(fighter.fatigue / Math.max(fighter.maxFatigue, 1));
}

function edgeRatio(fighter: FighterState, arenaRadius: number): number {
  return clamp(length(fighter.position) / Math.max(arenaRadius, 0.001), 0, 1.4);
}

function edgeDangerMultiplier(fighter: FighterState, arenaRadius: number): number {
  const distanceToEdge = arenaRadius - length(fighter.position);
  if (distanceToEdge > edgeDangerDistance) return 1;
  const danger = clamp01((edgeDangerDistance - distanceToEdge) / edgeDangerDistance);
  return 1 + danger * (edgeBalanceDamageMultiplier - 1);
}

function addFatigue(fighter: FighterState, amount: number): void {
  fighter.fatigue = clamp(fighter.fatigue + amount, 0, fighter.maxFatigue);
}

function isLockedCombatState(fighter: FighterState): boolean {
  return (
    fighter.inputLockSeconds > 0 ||
    fighter.combatState === "PARRIED"
  );
}

function forceNeutralControl(fighter: FighterState): void {
  if (fighter.falling) return;
  fighter.inputLockSeconds = 0;
  fighter.staggerSeconds = 0;
  fighter.stumbleTimer = 0;
  fighter.lockedStateSeconds = 0;
  fighter.isOffBalance = false;
  fighter.body.recoverySeconds = 0;
  fighter.combatState = "IDLE_GUARD";
}

function updateBodyAnimation(fighter: FighterState, dt: number, elapsed: number): void {
  fighter.body.stunSeconds = Math.max(0, fighter.body.stunSeconds - dt);
  fighter.body.recoverySeconds = Math.max(0, fighter.body.recoverySeconds - dt);

  const speed = length(fighter.velocity);
  const movementDirection = normalize(fighter.velocity, fromAngle(fighter.facing));
  const moveAmount = clamp(speed / BASE_SPEED, 0, 1);
  if (moveAmount > 0.02 && !fighter.falling) {
    fighter.body.walkPhase += dt * (5.5 + moveAmount * 4.5);
  }

  const phase = fighter.body.walkPhase;
  const stepAmount = fighter.falling ? 0 : moveAmount;
  fighter.body.leftFootLift = Math.max(0, Math.sin(phase)) * 0.11 * stepAmount;
  fighter.body.rightFootLift = Math.max(0, Math.sin(phase + Math.PI)) * 0.11 * stepAmount;
  fighter.body.bob = Math.abs(Math.sin(phase * 2)) * 0.035 * stepAmount;

  const balanceMissing = clamp01((fighter.maxBalance - fighter.balance) / Math.max(fighter.maxBalance, 1));
  const movementLean = scale(movementDirection, 0.055 * stepAmount);
  const impactLean = scale(normalize(fighter.body.recentImpact, fighter.lastKnockbackDirection ?? fromAngle(fighter.facing)), balanceMissing * 0.22);
  const stunWobble = fighter.body.stunSeconds > 0
    ? scale(vec2(Math.sin(elapsed * 34), Math.cos(elapsed * 29)), 0.035 + balanceMissing * 0.08)
    : vec2(0, 0);
  const fallLean = fighter.falling ? scale(normalize(fighter.position, fromAngle(fighter.facing)), 0.34) : vec2(0, 0);
  const targetLean = clampMagnitude(add(add(add(movementLean, impactLean), stunWobble), fallLean), 0.36);
  const leanFollow = clamp(1 - Math.exp(-dt * (fighter.body.stunSeconds > 0 ? 16 : 9)), 0, 1);

  fighter.body.targetLean = targetLean;
  fighter.body.visualLean = lerpVec(fighter.body.visualLean, targetLean, leanFollow);
  fighter.body.recentImpact = scale(fighter.body.recentImpact, Math.exp(-dt * 4.8));
}

export function movementMultiplierForFighter(fighter: FighterState): number {
  if (fighter.falling) return 1;
  if (fighter.balance <= 0 && fighter.body.stunSeconds > 0) return 0;

  let multiplier = lerp(0.78, 1, balanceRatio(fighter));
  const isStumbling =
    fighter.stumbleTimer > 0 ||
    fighter.combatState === "OFF_BALANCE" ||
    fighter.combatState === "CRITICAL_STUMBLE";

  if (isStumbling) {
    multiplier = Math.min(multiplier, fighter.balance < criticalBalanceThreshold ? 0.55 : 0.68);
  }
  if (fighter.staggerSeconds > 0) {
    multiplier = Math.min(multiplier, 0.65);
  }
  if (fighter.body.recoverySeconds > 0 || fighter.combatState === "RECOVERING") {
    multiplier = Math.max(multiplier, 0.75);
  }

  return clamp(multiplier, 0, 1);
}

function updateLockSafety(fighter: FighterState, dt: number): void {
  if (!isLockedCombatState(fighter)) {
    fighter.lockedStateSeconds = 0;
    return;
  }

  fighter.lockedStateSeconds += dt;
  if (fighter.lockedStateSeconds > maxLockedStateSeconds) {
    forceNeutralControl(fighter);
  }
}

function localMoveToWorld(fighter: FighterState, local: Vec2): Vec2 {
  const { forward, right } = movementBasis(fighter);
  return normalize(add(scale(right, local.x), scale(forward, local.y)));
}

function guardSideFromAim(aim: Vec2): GuardSide {
  if (aim.x < -0.22) {
    return "left";
  }
  if (aim.x > 0.22) {
    return "right";
  }
  return "center";
}

function stanceOffsetFromMove(move: Vec2): Vec2 {
  return vec2(
    (move.x > 0 ? 0.35 : 0) + (move.x < 0 ? -0.35 : 0),
    (move.y > 0 ? 0.25 : 0) + (move.y < 0 ? -0.25 : 0),
  );
}

function updateSwordTarget(fighter: FighterState, aim: Vec2, move: Vec2) {
  const { forward, right } = movementBasis(fighter);
  const guardedAim = clampMagnitude(aim, 1.2);
  const stanceOffset = stanceOffsetFromMove(move);
  const outward = clamp(Math.max(Math.abs(guardedAim.x), Math.abs(guardedAim.y)), 0, 1);
  const sideOffset = guardedAim.x * 1.08 + stanceOffset.x;
  const forwardOffset = clamp(
    lerp(minSwordGuardDistance, maxSwordReach, outward) + Math.max(0, guardedAim.y) * 0.18 + stanceOffset.y,
    minSwordGuardDistance * 0.72,
    maxSwordReach,
  );
  const handSide = guardedAim.x * 0.18 + stanceOffset.x * 0.35;
  const handForward = lerp(0.2, 0.34, outward) + stanceOffset.y * 0.25;
  const bounceOffset = fighter.sword.bounceOffset ?? vec2(0, 0);

  return {
    aim: guardedAim,
    targetHand: add(add(fighter.position, add(scale(forward, handForward), scale(right, handSide))), bounceOffset),
    targetTip: add(add(fighter.position, add(scale(forward, forwardOffset), scale(right, sideOffset))), bounceOffset),
    targetHandHeight: clamp(1.02 + guardedAim.y * 0.12, 0.82, 1.22),
    targetTipHeight: clamp(1.14 + guardedAim.y * 0.9, 0.42, 2.18),
  };
}

function updateSwordPhysics(fighter: FighterState, aim: Vec2, roll: number, move: Vec2, dt: number): void {
  const previousTip = fighter.sword.tip;
  const target = updateSwordTarget(fighter, aim, move);
  const followT = clamp(1 - Math.pow(1 - swordWeightFactor, dt * 60), 0, 1);
  const hand = lerpVec(fighter.sword.hand, target.targetHand, followT);
  const tip = lerpVec(fighter.sword.tip, target.targetTip, followT);
  const bladeDirection = normalize(sub(tip, hand), movementBasis(fighter).forward);
  const handHeight = lerp(fighter.sword.handHeight ?? 1.08, target.targetHandHeight, followT);
  const tipHeight = lerp(fighter.sword.tipHeight ?? 1.35, target.targetTipHeight, followT);
  const tipVelocity =
    dt <= 0
      ? fighter.sword.finalVelocity ?? fighter.sword.tipVelocity ?? fighter.sword.velocity
      : scale(sub(tip, previousTip), 1 / Math.max(dt, 0.0001));
  const characterVelocity = vec2(fighter.velocity.x, fighter.velocity.y);
  const finalVelocity = add(tipVelocity, characterVelocity);
  const speed = length(finalVelocity);
  const bounceOffset = scale(fighter.sword.bounceOffset ?? vec2(0, 0), Math.pow(swordBounceDecay, dt * 60));

  fighter.sword = {
    hand,
    tip,
    targetHand: target.targetHand,
    targetTip: target.targetTip,
    previousTip,
    currentTip: tip,
    tipVelocity,
    characterVelocity,
    finalVelocity,
    velocity: finalVelocity,
    bladeDirection,
    bounceOffset,
    guardSide: guardSideFromAim(target.aim),
    isSlashing:
      speed >= minimumHitVelocity &&
      !fighter.falling,
    handHeight,
    tipHeight,
    targetHandHeight: target.targetHandHeight,
    targetTipHeight: target.targetTipHeight,
    aim: target.aim,
    roll: lerp(fighter.sword.roll ?? 0, roll, followT),
  };
  fighter.blocking = !fighter.sword.isSlashing || Math.abs(target.aim.x) > 0.45;
  if (fighter.falling) fighter.combatState = "FALLING";
  else if (fighter.stumbleTimer > 0 && fighter.balance < criticalBalanceThreshold) fighter.combatState = "CRITICAL_STUMBLE";
  else if (fighter.stumbleTimer > 0 && fighter.balance < offBalanceThreshold) fighter.combatState = "OFF_BALANCE";
  else if (fighter.body.recoverySeconds > 0) fighter.combatState = "RECOVERING";
  else if (fighter.inputLockSeconds <= 0 && fighter.staggerSeconds <= 0) fighter.combatState = fighter.sword.isSlashing ? "SLASHING" : "IDLE_GUARD";
}

function integrateFighter(fighter: FighterState, desiredMove: Vec2, dt: number, elapsed: number): void {
  if (fighter.falling) {
    fighter.fallSeconds = (fighter.fallSeconds ?? 0) + dt;
    fighter.position = add(fighter.position, scale(fighter.velocity, dt));
    updateBodyAnimation(fighter, dt, elapsed);
    return;
  }

  const desiredVelocity = scale(normalize(desiredMove), BASE_SPEED * movementMultiplierForFighter(fighter));
  const acceleration = fighter.id === "player" ? 12 : 9;
  fighter.velocity = add(fighter.velocity, scale(sub(desiredVelocity, fighter.velocity), clamp(dt * acceleration, 0, 1)));

  fighter.velocity = clampMagnitude(fighter.velocity, 4.2);
  fighter.position = add(fighter.position, scale(fighter.velocity, dt));
  fighter.velocity = scale(fighter.velocity, Math.pow(0.82, dt * 60));
  updateBodyAnimation(fighter, dt, elapsed);
}

function damageBalance(fighter: FighterState, loss: number, staggerSeconds = 0, knockbackDirection?: Vec2): void {
  fighter.balance = clamp(fighter.balance - loss, 0, fighter.maxBalance);
  fighter.balanceRecoveryCooldown = balanceRecoveryCooldownSeconds;
  if (knockbackDirection) {
    const impactDirection = normalize(knockbackDirection, fighter.lastKnockbackDirection ?? vec2(0, 1));
    fighter.lastKnockbackDirection = impactDirection;
    fighter.body.recentImpact = impactDirection;
  }
  fighter.staggerSeconds = Math.max(fighter.staggerSeconds, staggerSeconds);
  fighter.body.recoverySeconds = 0;
  if (fighter.balance <= 0 && !fighter.falling) {
    fighter.body.stunSeconds = Math.max(fighter.body.stunSeconds, zeroBalancePinStunSeconds);
    fighter.combatState = "CRITICAL_STUMBLE";
  }
  if (fighter.balance < criticalBalanceThreshold) {
    fighter.isOffBalance = true;
    fighter.stumbleTimer = Math.max(fighter.stumbleTimer, criticalStumbleDuration);
    fighter.combatState = "CRITICAL_STUMBLE";
  } else if (fighter.balance < offBalanceThreshold) {
    fighter.isOffBalance = true;
    fighter.stumbleTimer = Math.max(fighter.stumbleTimer, stumbleDuration);
    fighter.combatState = "OFF_BALANCE";
  } else if (fighter.balance < staggerBalanceThreshold) {
    fighter.combatState = "STAGGERED";
  }
}

function damageHealth(fighter: FighterState, amount: number): void {
  fighter.health = clamp(fighter.health - amount, 0, MAX_HEALTH);
}

function pushFighter(fighter: FighterState, direction: Vec2, force: number): void {
  const pushDirection = normalize(direction);
  fighter.lastKnockbackDirection = pushDirection;
  void force;
}

function bounceSwordTarget(fighter: FighterState, direction: Vec2, distance: number): void {
  const bounceDirection = normalize(direction, scale(fromAngle(fighter.facing), -1));
  fighter.sword.bounceOffset = add(fighter.sword.bounceOffset ?? vec2(0, 0), scale(bounceDirection, distance));
}

function isKnockbackVulnerable(fighter: FighterState): boolean {
  return fighter.staggerSeconds > 0 || fighter.balance < 50 || fighter.combatState === "STAGGERED" || fighter.combatState === "OFF_BALANCE" || fighter.combatState === "CRITICAL_STUMBLE";
}

function startKnockbackSlide(fighter: FighterState, direction: Vec2): void {
  const slideDirection = normalize(direction, fighter.lastKnockbackDirection ?? vec2(0, 1));
  const slideDistance = knockbackSlideBaseDistance * (1 + (fighter.maxBalance - fighter.balance) / 25);
  fighter.lastKnockbackDirection = slideDirection;
  fighter.body.recentImpact = slideDirection;
  fighter.knockbackStart = fighter.position;
  fighter.knockbackTarget = add(fighter.position, scale(slideDirection, slideDistance));
  fighter.knockbackSeconds = 0;
  fighter.knockbackDuration = knockbackSlideDuration;
}

function updateKnockbackSlide(fighter: FighterState, dt: number): void {
  if (!fighter.knockbackStart || !fighter.knockbackTarget || !fighter.knockbackDuration) return;
  fighter.knockbackSeconds = (fighter.knockbackSeconds ?? 0) + dt;
  const t = clamp(fighter.knockbackSeconds / fighter.knockbackDuration, 0, 1);
  const eased = 1 - (1 - t) * (1 - t);
  fighter.position = lerpVec(fighter.knockbackStart, fighter.knockbackTarget, eased);
  if (t >= 1) {
    fighter.knockbackStart = undefined;
    fighter.knockbackTarget = undefined;
    fighter.knockbackSeconds = undefined;
    fighter.knockbackDuration = undefined;
  }
}

function addImpact(state: DuelState, kind: ImpactKind, position: Vec2, height: number, force: number): ImpactEvent {
  const effect = {
    id: state.nextImpactId++,
    kind,
    position,
    height,
    force,
  };
  state.effects.push(effect);
  return effect;
}

function nearEdgeBalanceDrain(fighter: FighterState, dt: number, arenaRadius: number): void {
  const edgeRatio = length(fighter.position) / arenaRadius;
  if (edgeRatio < 0.74 || fighter.falling) {
    return;
  }
  const outward = normalize(fighter.position);
  const movingOutward = dot(fighter.velocity, outward) > 0;
  const drain = (edgeRatio - 0.74) * (movingOutward ? 12 : 5.5) * dt;
  if (drain > 0) damageBalance(fighter, drain, 0, outward);
}

function resolveSwordCollision(state: DuelState): void {
  if (state.clashCooldown > 0) {
    return;
  }

  const player = state.player;
  const npc = state.npc;
  const bladeDistance = distanceSegmentToSegment(player.sword.hand, player.sword.tip, npc.sword.hand, npc.sword.tip);
  if (bladeDistance > 0.25) {
    return;
  }

  if (player.falling || npc.falling) return;
  const playerSpeed = length(player.sword.finalVelocity ?? player.sword.velocity);
  const npcSpeed = length(npc.sword.finalVelocity ?? npc.sword.velocity);
  if (playerSpeed < minimumHitVelocity && npcSpeed < minimumHitVelocity) return;
  const playerAttacks = playerSpeed >= npcSpeed;
  const attacker = playerAttacks ? player : npc;
  const defender = playerAttacks ? npc : player;
  const pushNormal = normalize(sub(defender.position, attacker.position), vec2(0, 1));

  const clash = resolveSwordClash({
    attackerVelocity: attacker.sword.finalVelocity ?? attacker.sword.velocity,
    defenderVelocity: defender.sword.finalVelocity ?? defender.sword.velocity,
    attackerBladeDirection: attacker.sword.bladeDirection,
    defenderBladeDirection: defender.sword.bladeDirection,
    contactNormal: pushNormal,
    defenderBalance: defender.balance,
  });

  bounceSwordTarget(attacker, scale(normalize(attacker.sword.finalVelocity ?? attacker.sword.velocity, scale(pushNormal, -1)), -1), clash.attackerBounce);
  bounceSwordTarget(defender, scale(normalize(defender.sword.finalVelocity ?? defender.sword.velocity, pushNormal), -1), clash.defenderBounce);
  if (clash.kind === "perfectParry") {
    damageBalance(attacker, clash.attackerBalanceLoss || perfectParryBalanceLoss, clash.attackerStaggerSeconds || perfectParryStaggerSeconds, scale(pushNormal, -1));
    attacker.staggerSeconds = Math.max(attacker.staggerSeconds, clash.attackerStaggerSeconds || perfectParryStaggerSeconds);
    attacker.combatState = "STAGGERED";
    attacker.inputLockSeconds = 0;
    defender.inputLockSeconds = 0;
    state.clashCooldown = 0.1;
    state.shake = Math.max(state.shake, 0.2);
    addImpact(state, "stagger", attacker.position, 1.28, clash.force);
    state.message = `${defender.id === "player" ? "Perfect parry" : "Rival parried"}`;
    return;
  }

  if (clash.attackerBalanceLoss > 0) {
    damageBalance(attacker, clash.attackerBalanceLoss, 0, scale(pushNormal, -1));
  }
  if (clash.defenderBalanceLoss > 0) {
    damageBalance(defender, clash.defenderBalanceLoss, 0, pushNormal);
  }
  state.clashCooldown = 0.06;
  state.shake = Math.max(state.shake, clamp(clash.force * 0.018, 0.05, 0.18));
  addImpact(state, "clash", scale(add(player.sword.tip, npc.sword.tip), 0.5), 1.28, clash.force);
  state.message = "Blades bounce";
}

function addPendingHit(state: DuelState, event: Omit<PendingHitEvent, "id">): void {
  state.pendingHitEvents.push({ ...event, id: state.nextImpactId++ });
}

function triggerClash(state: DuelState, fighterA: FighterState, fighterB: FighterState, point: Vec2): void {
  const direction = normalize(sub(fighterB.position, fighterA.position), vec2(0, 1));
  bounceSwordTarget(fighterA, scale(direction, -1), 0.3);
  bounceSwordTarget(fighterB, direction, 0.3);
  state.shake = Math.max(state.shake, 0.12);
  addImpact(state, "clash", point, 1.25, 1);
  state.message = "Simultaneous bounce";
}

function fighterById(state: DuelState, id: "player" | "npc"): FighterState {
  return id === "player" ? state.player : state.npc;
}

function applyPendingHit(state: DuelState, hit: PendingHitEvent): void {
  const attacker = fighterById(state, hit.attackerId);
  const defender = fighterById(state, hit.defenderId);
  if (defender.falling) return;
  const upperMultiplier = hit.hitLocation === "upper" ? 1.18 : 1;
  const edgeMultiplier = edgeDangerMultiplier(defender, state.arenaRadius);
  const vulnerableToSlide = isKnockbackVulnerable(defender);
  damageBalance(defender, hit.balanceLoss * upperMultiplier * edgeMultiplier, hit.staggerSeconds, hit.knockbackDirection);
  if (vulnerableToSlide) {
    startKnockbackSlide(defender, hit.knockbackDirection);
  }
  addFatigue(attacker, length(attacker.sword.finalVelocity ?? attacker.sword.velocity) >= heavyHitVelocity ? heavySwingFatigueGain : 2);
  if (defender.isOffBalance || defender.balance < offBalanceThreshold) defender.combatState = defender.balance < criticalBalanceThreshold ? "CRITICAL_STUMBLE" : "OFF_BALANCE";
  else defender.combatState = "STAGGERED";
  addImpact(state, hit.staggerSeconds > 0.2 ? "stagger" : "hit", defender.position, hit.hitLocation === "upper" ? 1.65 : 1.25, hit.knockbackForce);
  state.message = hit.hitType === "GUARD_BREAK" ? "Guard break hit" : hit.hitType === "GLANCING_BLOCK" ? "Glancing hit" : "Clean hit";
}

function processPendingHits(state: DuelState): void {
  const hits = state.pendingHitEvents.slice();
  state.pendingHitEvents = [];
  for (let i = 0; i < hits.length; i += 1) {
    for (let j = i + 1; j < hits.length; j += 1) {
      const a = hits[i];
      const b = hits[j];
      if (a.attackerId === b.defenderId && b.attackerId === a.defenderId && Math.abs(a.frameCreated - b.frameCreated) <= simultaneousHitBufferFrames) {
        triggerClash(state, fighterById(state, a.attackerId), fighterById(state, b.attackerId), scale(add(a.collisionPoint, b.collisionPoint), 0.5));
        return;
      }
    }
  }
  for (const hit of hits) {
    applyPendingHit(state, hit);
  }
}

function updateFatigue(fighter: FighterState, dt: number, arenaRadius: number): void {
  const nearEdge = edgeRatio(fighter, arenaRadius) > 0.74;
  const active = fighter.sword.isSlashing || fighter.blocking || fighter.inputLockSeconds > 0 || fighter.staggerSeconds > 0 || nearEdge;
  if (active) {
    if (fighter.isOffBalance && length(fighter.velocity) > 0.2) addFatigue(fighter, dt * 5);
    if (nearEdge && fighter.balance < lowBalanceThreshold) addFatigue(fighter, dt * 3);
    return;
  }
  fighter.fatigue = clamp(fighter.fatigue - fatigueRecoveryRate * dt, 0, fighter.maxFatigue);
}

function updateBalanceRecovery(fighter: FighterState, dt: number, arenaRadius: number): void {
  const wasStumbling =
    fighter.isOffBalance ||
    fighter.combatState === "OFF_BALANCE" ||
    fighter.combatState === "CRITICAL_STUMBLE";
  fighter.balanceRecoveryCooldown = Math.max(0, fighter.balanceRecoveryCooldown - dt);
  fighter.stumbleTimer = Math.max(0, fighter.stumbleTimer - dt);
  if (fighter.balanceRecoveryCooldown <= 0 && fighter.staggerSeconds <= 0 && !fighter.falling) {
    fighter.balance = applyBalanceRecovery(fighter.balance, dt, edgeRatio(fighter, arenaRadius), fatigueFactor(fighter));
  }

  const zeroBalanceStunned = fighter.balance <= 0 && fighter.body.stunSeconds > 0;
  fighter.isOffBalance = zeroBalanceStunned || fighter.stumbleTimer > 0;

  if (zeroBalanceStunned) {
    fighter.combatState = "CRITICAL_STUMBLE";
  } else if (fighter.stumbleTimer > 0) {
    fighter.combatState = fighter.balance < criticalBalanceThreshold ? "CRITICAL_STUMBLE" : "OFF_BALANCE";
  } else if (wasStumbling && !fighter.falling) {
    fighter.body.recoverySeconds = Math.max(fighter.body.recoverySeconds, offBalanceRecoverySeconds);
    fighter.combatState = "RECOVERING";
    fighter.isOffBalance = false;
  } else if (fighter.body.recoverySeconds > 0) {
    fighter.combatState = "RECOVERING";
  } else if (fighter.combatState === "OFF_BALANCE" || fighter.combatState === "CRITICAL_STUMBLE" || fighter.combatState === "RECOVERING") {
    fighter.combatState = "IDLE_GUARD";
  }
}

function drainRetreatBlockingBalance(fighter: FighterState, opponent: FighterState, dt: number): void {
  if (!fighter.blocking || fighter.sword.isSlashing || fighter.falling) return;
  const awayFromOpponent = normalize(sub(fighter.position, opponent.position), vec2(0, 1));
  if (dot(fighter.velocity, awayFromOpponent) > 0.15) {
    damageBalance(fighter, 12 * dt, 0, awayFromOpponent);
  }
}

function resolveBodyContact(state: DuelState, attacker: FighterState, defender: FighterState, dt: number): void {
  if (state.clashCooldown > 0) {
    return;
  }

  const cooldownKey = attacker.id === "player" ? "playerHitCooldown" : "npcHitCooldown";
  if (state[cooldownKey] > 0) {
    return;
  }

  const swordSpeed = length(attacker.sword.finalVelocity ?? attacker.sword.velocity);
  if (swordSpeed < minimumHitVelocity || !attacker.sword.isSlashing) {
    return;
  }

  const previousTip = attacker.sword.previousTip ?? sub(attacker.sword.tip, scale(attacker.sword.velocity, dt));
  const bladeToBody = Math.min(
    distancePointToSegment(defender.position, attacker.sword.hand, attacker.sword.tip),
    distancePointToSegment(defender.position, previousTip, attacker.sword.tip),
  );
  if (bladeToBody > FIGHTER_RADIUS + 0.16) {
    return;
  }

  const contactNormal = normalize(sub(defender.position, attacker.position), vec2(0, 1));
  const defenderBlocking =
    defender.blocking && distanceSegmentToSegment(attacker.sword.hand, attacker.sword.tip, defender.sword.hand, defender.sword.tip) < 0.44;
  const defenderMovingBackward = dot(defender.velocity, contactNormal) > 0.2;
  if (defenderBlocking) {
    const matrix = resolveCombatMatrix({
      attackerVelocity: attacker.sword.finalVelocity ?? attacker.sword.velocity,
      defenderVelocity: defender.sword.finalVelocity ?? defender.sword.velocity,
      attackerBladeDirection: attacker.sword.bladeDirection,
      defenderBladeDirection: defender.sword.bladeDirection,
      attackerSlashDirection: normalize(attacker.sword.finalVelocity ?? attacker.sword.velocity, contactNormal),
      contactNormal,
      defenderBalance: defender.balance,
      defenderCombatState: defender.combatState,
    });

    if (matrix.kind === "PERFECT_BLOCK" || matrix.kind === "SUCCESSFUL_BLOCK") {
      pushFighter(attacker, scale(contactNormal, -1), matrix.attackerPush);
      damageBalance(attacker, matrix.attackerBalanceLoss * edgeDangerMultiplier(attacker, state.arenaRadius), matrix.attackerStunSeconds, scale(contactNormal, -1));
      damageBalance(defender, matrix.defenderBalanceLoss * edgeDangerMultiplier(defender, state.arenaRadius), 0, contactNormal);
      addFatigue(attacker, blockedStrikeFatigueGain);
      addFatigue(defender, 3);
      attacker.inputLockSeconds = Math.max(attacker.inputLockSeconds, matrix.inputLockSeconds * (1 + fatigueFactor(attacker) * fatigueStunMultiplier));
      attacker.combatState = "PARRIED";
      defender.combatState = "BLOCKING";
      state.clashCooldown = 0.16;
      state.shake = Math.max(state.shake, matrix.kind === "PERFECT_BLOCK" ? 0.16 : 0.1);
      addImpact(state, "clash", defender.position, 1.35, matrix.attackerPush);
      state[cooldownKey] = clamp(0.16 + swordSpeed * 0.012, 0.16, 0.32);
      state.message = matrix.kind === "PERFECT_BLOCK" ? "Perfect block" : "Attack blocked";
      return;
    }

    if (matrix.kind === "GLANCING_BLOCK") {
      pushFighter(attacker, scale(contactNormal, -1), matrix.attackerPush);
      pushFighter(defender, contactNormal, matrix.defenderPush);
      damageBalance(attacker, matrix.attackerBalanceLoss * edgeDangerMultiplier(attacker, state.arenaRadius), matrix.attackerStunSeconds, scale(contactNormal, -1));
      damageBalance(defender, matrix.defenderBalanceLoss * edgeDangerMultiplier(defender, state.arenaRadius), 0.05, contactNormal);
      addFatigue(attacker, 5);
      addFatigue(defender, 4);
      attacker.inputLockSeconds = Math.max(attacker.inputLockSeconds, matrix.inputLockSeconds * (1 + fatigueFactor(attacker) * fatigueStunMultiplier));
      defender.combatState = "BLOCKING";
      state.clashCooldown = 0.1;
      addImpact(state, "clash", defender.position, 1.25, matrix.defenderPush);
      state[cooldownKey] = clamp(0.16 + swordSpeed * 0.012, 0.16, 0.32);
      state.message = "Glancing block";
      return;
    }

    if (matrix.kind === "GUARD_BREAK") {
      pushFighter(defender, contactNormal, matrix.defenderPush);
      damageBalance(defender, matrix.defenderBalanceLoss * edgeDangerMultiplier(defender, state.arenaRadius), 0.3, contactNormal);
      addFatigue(attacker, guardBreakFatigueGain);
      addFatigue(defender, guardBreakFatigueGain);
      defender.inputLockSeconds = Math.max(defender.inputLockSeconds, matrix.inputLockSeconds * (1 + fatigueFactor(defender) * fatigueStunMultiplier));
      defender.combatState = defender.balance < offBalanceThreshold ? "OFF_BALANCE" : "STAGGERED";
      state.clashCooldown = 0.08;
      state.shake = Math.max(state.shake, 0.18);
      addImpact(state, "stagger", defender.position, 1.25, matrix.defenderPush);
      state[cooldownKey] = clamp(0.16 + swordSpeed * 0.012, 0.16, 0.32);
      state.message = "Guard broken";
      return;
    }
  }
  const hit = resolveBodyHit({
    attackerVelocity: attacker.sword.finalVelocity ?? attacker.sword.velocity,
    bladeDirection: attacker.sword.bladeDirection,
    contactNormal,
    defenderBalance: defender.balance,
    defenderMovingBackward,
    defenderBlocking,
  });
  const highHitMultiplier = (attacker.sword.tipHeight ?? 1.2) > 1.55 ? 1.18 : 1;
  const healthDamage = 0;

  addPendingHit(state, {
    attackerId: attacker.id,
    defenderId: defender.id,
    damage: healthDamage,
    balanceLoss: hit.balanceLoss * highHitMultiplier * edgeDangerMultiplier(defender, state.arenaRadius),
    knockbackDirection: normalize(attacker.sword.finalVelocity ?? contactNormal, contactNormal),
    knockbackForce: 0,
    frameCreated: state.frame,
    hitType: defenderBlocking ? "GLANCING_BLOCK" : "CLEAN_HIT",
    hitLocation: (attacker.sword.tipHeight ?? 1.2) > 1.55 ? "upper" : "body",
    staggerSeconds: hit.staggerSeconds,
    collisionPoint: defender.position,
  });
  if (defenderBlocking) damageBalance(attacker, hit.balanceLoss * 0.18, 0.04, scale(contactNormal, -1));

  state[cooldownKey] = clamp(0.16 + swordSpeed * 0.012, 0.16, 0.32);
  state.message = "Hit pending";
}

function checkRingOut(state: DuelState, fighter: FighterState, winner: "playerWon" | "npcWon"): void {
  if (!isRingOut(fighter.position, state.arenaRadius + 0.18) || state.status !== "playing") {
    return;
  }

  fighter.falling = true;
  fighter.fallSeconds = 0;
  fighter.velocity = add(fighter.velocity, scale(normalize(fighter.position), 1.4));
  state.status = winner;
  state.message = winner === "playerWon" ? "Opponent knocked out" : "You fell from the arena";
  state.hitPause = 0;
  state.shake = Math.max(state.shake, 0.28);
  addImpact(state, "fall", fighter.position, 0.25, 3.4);
}

export function stepDuel(state: DuelState, input: PlayerInputFrame, dt: number): DuelState {
  const safeDt = clamp(dt, 0, 1 / 30);
  state.effects = [];

  if (input.restart && state.status !== "playing") {
    return createInitialState(state.round + 1);
  }

  state.frame += 1;
  state.elapsed += safeDt;
  state.shake = Math.max(0, state.shake - safeDt * 1.7);

  if (state.status !== "playing") {
    if (state.player.falling) {
      integrateFighter(state.player, vec2(0, 0), safeDt, state.elapsed);
    }
    if (state.npc.falling) {
      integrateFighter(state.npc, vec2(0, 0), safeDt, state.elapsed);
    }
    return state;
  }

  state.clashCooldown = Math.max(0, state.clashCooldown - safeDt);
  state.playerHitCooldown = Math.max(0, state.playerHitCooldown - safeDt);
  state.npcHitCooldown = Math.max(0, state.npcHitCooldown - safeDt);
  state.player.staggerSeconds = Math.max(0, state.player.staggerSeconds - safeDt);
  state.npc.staggerSeconds = Math.max(0, state.npc.staggerSeconds - safeDt);
  state.player.inputLockSeconds = Math.max(0, state.player.inputLockSeconds - safeDt);
  state.npc.inputLockSeconds = Math.max(0, state.npc.inputLockSeconds - safeDt);
  state.player.stumbleTimer = Math.max(0, state.player.stumbleTimer - safeDt);
  state.npc.stumbleTimer = Math.max(0, state.npc.stumbleTimer - safeDt);
  updateLockSafety(state.player, safeDt);
  updateLockSafety(state.npc, safeDt);

  updateFacing(state.player, state.npc);
  const playerMove = localMoveToWorld(state.player, input.move);
  const npcIntent = chooseNpcIntent({
    npc: state.npc,
    player: state.player,
    arenaRadius: state.arenaRadius,
    reaction: NPC_REACTION,
    elapsed: state.elapsed,
  });
  state.npcAim = moveToward(state.npcAim, npcIntent.swordTarget, SWORD_TARGET_SPEED * safeDt);
  state.npcRoll += (npcIntent.swordTarget.x - (state.npc.sword.aim?.x ?? 0)) * safeDt * 3.5;

  integrateFighter(state.player, playerMove, safeDt, state.elapsed);
  integrateFighter(state.npc, npcIntent.move, safeDt, state.elapsed);
  updateFacing(state.player, state.npc);
  updateSwordPhysics(state.player, input.swordAim, input.swordRoll, input.move, safeDt);
  updateSwordPhysics(state.npc, state.npcAim, state.npcRoll, npcIntent.move, safeDt);

  resolveSwordCollision(state);
  resolveBodyContact(state, state.player, state.npc, safeDt);
  resolveBodyContact(state, state.npc, state.player, safeDt);
  processPendingHits(state);
  updateKnockbackSlide(state.player, safeDt);
  updateKnockbackSlide(state.npc, safeDt);
  drainRetreatBlockingBalance(state.player, state.npc, safeDt);
  drainRetreatBlockingBalance(state.npc, state.player, safeDt);

  nearEdgeBalanceDrain(state.player, safeDt, state.arenaRadius);
  nearEdgeBalanceDrain(state.npc, safeDt, state.arenaRadius);
  updateFatigue(state.player, safeDt, state.arenaRadius);
  updateFatigue(state.npc, safeDt, state.arenaRadius);
  updateBalanceRecovery(state.player, safeDt, state.arenaRadius);
  updateBalanceRecovery(state.npc, safeDt, state.arenaRadius);

  checkRingOut(state, state.npc, "playerWon");
  checkRingOut(state, state.player, "npcWon");
  return state;
}
