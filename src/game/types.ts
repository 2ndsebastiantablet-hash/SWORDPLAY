import type { Vec2 } from "./math";

export type FighterId = "player" | "npc";
export type GuardSide = "left" | "center" | "right";
export type RoundStatus = "playing" | "playerWon" | "npcWon";
export type ImpactKind = "clash" | "hit" | "stagger" | "fall";
export type CombatState =
  | "IDLE_GUARD"
  | "WINDING"
  | "SLASHING"
  | "RECOVERING"
  | "BLOCKING"
  | "PARRIED"
  | "STAGGERED"
  | "OFF_BALANCE"
  | "CRITICAL_STUMBLE"
  | "FALLING";

export type SwordState = {
  hand: Vec2;
  tip: Vec2;
  targetHand?: Vec2;
  targetTip?: Vec2;
  previousTip?: Vec2;
  currentTip?: Vec2;
  tipVelocity?: Vec2;
  characterVelocity?: Vec2;
  finalVelocity?: Vec2;
  velocity: Vec2;
  bladeDirection: Vec2;
  bounceOffset?: Vec2;
  guardSide: GuardSide;
  isSlashing?: boolean;
  handHeight?: number;
  tipHeight?: number;
  targetHandHeight?: number;
  targetTipHeight?: number;
  aim?: Vec2;
  roll?: number;
};

export type FighterBodyStyle = "bowling-pin";

export type FighterBodyState = {
  style: FighterBodyStyle;
  walkPhase: number;
  bob: number;
  leftFootLift: number;
  rightFootLift: number;
  visualLean: Vec2;
  targetLean: Vec2;
  recentImpact: Vec2;
  stunSeconds: number;
};

export type FighterState = {
  id: FighterId;
  position: Vec2;
  velocity: Vec2;
  facing: number;
  health: number;
  balance: number;
  maxBalance: number;
  isOffBalance: boolean;
  balanceRecoveryCooldown: number;
  stumbleTimer: number;
  fatigue: number;
  maxFatigue: number;
  lastKnockbackDirection?: Vec2;
  knockbackStart?: Vec2;
  knockbackTarget?: Vec2;
  knockbackSeconds?: number;
  knockbackDuration?: number;
  staggerSeconds: number;
  combatState: CombatState;
  inputLockSeconds: number;
  lockedStateSeconds: number;
  sword: SwordState;
  body: FighterBodyState;
  blocking: boolean;
  falling: boolean;
  fallSeconds?: number;
};

export type PendingHitEvent = {
  id: number;
  attackerId: FighterId;
  defenderId: FighterId;
  damage: number;
  balanceLoss: number;
  knockbackDirection: Vec2;
  knockbackForce: number;
  frameCreated: number;
  hitType: "CLEAN_HIT" | "GUARD_BREAK" | "GLANCING_BLOCK";
  hitLocation: "body" | "upper";
  staggerSeconds: number;
  collisionPoint: Vec2;
};

export type ImpactEvent = {
  id: number;
  kind: ImpactKind;
  position: Vec2;
  height: number;
  force: number;
};

export type DuelState = {
  player: FighterState;
  npc: FighterState;
  status: RoundStatus;
  message: string;
  elapsed: number;
  round: number;
  arenaRadius: number;
  npcAim: Vec2;
  npcRoll: number;
  clashCooldown: number;
  playerHitCooldown: number;
  npcHitCooldown: number;
  hitPause: number;
  shake: number;
  nextImpactId: number;
  effects: ImpactEvent[];
  frame: number;
  pendingHitEvents: PendingHitEvent[];
};

export type PlayerInputFrame = {
  move: Vec2;
  swordAim: Vec2;
  swordVelocity: Vec2;
  swordRoll: number;
  pointerLocked: boolean;
  restart: boolean;
};

export type NpcIntent = {
  move: Vec2;
  swordTarget: Vec2;
  guardSide: GuardSide;
  pressure: number;
};
