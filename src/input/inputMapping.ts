import { clamp, vec2, type Vec2 } from "../game/math";

export type SwordPointerResult = {
  aim: Vec2;
  roll: number;
};

export function mapMovementKeys(keys: ReadonlySet<string>): Vec2 {
  const move = vec2(0, 0);
  if (keys.has("KeyA")) {
    move.x += 1;
  }
  if (keys.has("KeyD")) {
    move.x -= 1;
  }
  if (keys.has("KeyW")) {
    move.y += 1;
  }
  if (keys.has("KeyS")) {
    move.y -= 1;
  }
  return move;
}

export function applySwordPointerDelta(currentAim: Vec2, dx: number, dy: number, currentRoll: number): SwordPointerResult {
  const before = vec2(currentAim.x, currentAim.y);
  const aim = vec2(clamp(currentAim.x - dx * 0.0036, -1, 1), clamp(currentAim.y - dy * 0.0042, -0.95, 0.95));
  const circularMotion = before.x * aim.y - before.y * aim.x;
  return {
    aim,
    roll: currentRoll + circularMotion * 0.85 - dx * 0.0022,
  };
}

export function mapAbsolutePointerToSwordAim(clientX: number, clientY: number, rect: DOMRect | Pick<DOMRect, "left" | "top" | "width" | "height">): Vec2 {
  if (rect.width <= 0 || rect.height <= 0) {
    return vec2(0, 0);
  }
  return vec2(
    clamp((0.5 - (clientX - rect.left) / rect.width) * 2.3, -1, 1),
    clamp((0.5 - (clientY - rect.top) / rect.height) * 2.1, -0.95, 0.95),
  );
}
