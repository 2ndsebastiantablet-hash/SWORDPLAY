import {
  add,
  clamp,
  distance,
  length,
  normalize,
  scale,
  sub,
  vec2,
  type Vec2,
} from "./math";
import type { FighterState, GuardSide, NpcIntent } from "./types";

export type NpcIntentInput = {
  npc: FighterState;
  player: FighterState;
  arenaRadius: number;
  reaction: number;
  elapsed: number;
};

function oppositeGuard(side: GuardSide): GuardSide {
  if (side === "left") {
    return "right";
  }
  if (side === "right") {
    return "left";
  }
  return "center";
}

function guardTarget(side: GuardSide, pressure: number, elapsed: number): Vec2 {
  if (side === "left") {
    return vec2(-0.72, 0.28 + Math.sin(elapsed * 2.1) * 0.08);
  }
  if (side === "right") {
    return vec2(0.72, 0.28 + Math.sin(elapsed * 2.1) * 0.08);
  }
  return vec2(Math.sin(elapsed * 1.5) * 0.18 * pressure, 0.18);
}

export function chooseNpcIntent(input: NpcIntentInput): NpcIntent {
  const { npc, player, arenaRadius, elapsed } = input;
  const reaction = clamp(input.reaction, 0, 1);
  const toCenter = scale(normalize(npc.position, vec2(1, 0)), -1);
  const toPlayer = normalize(sub(player.position, npc.position), vec2(0, -1));
  const range = distance(npc.position, player.position);
  const edgeRatio = length(npc.position) / arenaRadius;
  const edgeUrgency = clamp((edgeRatio - 0.68) / 0.25, 0, 1);
  const orbit = vec2(-toPlayer.y, toPlayer.x);
  const orbitBias = Math.sin(elapsed * 0.85) > 0 ? 1 : -1;

  let move = scale(toCenter, edgeUrgency * 1.8);
  if (edgeUrgency < 0.78) {
    const pressure = player.balance < 48 ? 1 : 0.45;
    if (range > 2.25) {
      move = add(move, scale(toPlayer, 0.5 + pressure * 0.25));
    }
    if (range < 1.35) {
      move = add(move, scale(toPlayer, -0.75));
    }
    move = add(move, scale(orbit, orbitBias * 0.32));
  }

  const readableSwing = length(player.sword.velocity) > 2.2 || player.sword.guardSide !== "center";
  const mistakeWindow = reaction < 0.82 && Math.sin(elapsed * 2.7 + npc.balance * 3) > 0.88;
  let guardSide: GuardSide = readableSwing && reaction > 0.25 ? player.sword.guardSide : "center";
  if (mistakeWindow) {
    guardSide = oppositeGuard(guardSide);
  }

  const pressure = clamp(
    0.35 + (player.balance < 55 ? 0.45 : 0) + (range < 1.8 ? 0.16 : 0) - edgeUrgency * 0.38,
    0,
    1,
  );
  let swordTarget = guardTarget(guardSide, pressure, elapsed);

  const attackBeat = Math.sin(elapsed * 2.4) > 0.62 && pressure > 0.62 && edgeUrgency < 0.55;
  if (attackBeat) {
    swordTarget = vec2(Math.sin(elapsed * 5.2) > 0 ? -0.86 : 0.86, -0.08 + Math.sin(elapsed * 4.6) * 0.45);
  }

  return {
    move: normalize(move),
    swordTarget,
    guardSide,
    pressure,
  };
}
