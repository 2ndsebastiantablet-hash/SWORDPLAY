import { describe, expect, it } from "vitest";
import { applySwordPointerDelta, mapAbsolutePointerToSwordAim, mapMovementKeys } from "../src/input/inputMapping";
import { vec2 } from "../src/game/math";

describe("input mapping", () => {
  it("maps corrected horizontal strafe while preserving W and S", () => {
    expect(mapMovementKeys(new Set(["KeyA"]))).toEqual(vec2(1, 0));
    expect(mapMovementKeys(new Set(["KeyD"]))).toEqual(vec2(-1, 0));
    expect(mapMovementKeys(new Set(["KeyW"]))).toEqual(vec2(0, 1));
    expect(mapMovementKeys(new Set(["KeyS"]))).toEqual(vec2(0, -1));
  });

  it("maps corrected horizontal sword deltas while preserving vertical tracking", () => {
    const left = applySwordPointerDelta(vec2(0, 0.1), -40, 0, 0);
    const right = applySwordPointerDelta(vec2(0, 0.1), 40, 0, 0);
    const up = applySwordPointerDelta(vec2(0, 0.1), 0, -40, 0);
    const down = applySwordPointerDelta(vec2(0, 0.1), 0, 40, 0);

    expect(left.aim.x).toBeGreaterThan(0);
    expect(right.aim.x).toBeLessThan(0);
    expect(left.aim.y).toBeCloseTo(0.1);
    expect(right.aim.y).toBeCloseTo(0.1);
    expect(up.aim.y).toBeGreaterThan(0.1);
    expect(down.aim.y).toBeLessThan(0.1);
  });

  it("maps absolute pointer left/right through the same corrected horizontal axis", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };

    expect(mapAbsolutePointerToSwordAim(25, 50, rect).x).toBeGreaterThan(0);
    expect(mapAbsolutePointerToSwordAim(75, 50, rect).x).toBeLessThan(0);
    expect(mapAbsolutePointerToSwordAim(50, 25, rect).y).toBeGreaterThan(0);
    expect(mapAbsolutePointerToSwordAim(50, 75, rect).y).toBeLessThan(0);
  });
});
