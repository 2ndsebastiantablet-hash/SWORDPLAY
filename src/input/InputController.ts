import { sub, vec2, type Vec2 } from "../game/math";
import type { PlayerInputFrame } from "../game/types";
import { applySwordPointerDelta, mapAbsolutePointerToSwordAim, mapMovementKeys } from "./inputMapping";

export class InputController {
  private readonly target: HTMLElement;
  private readonly keys = new Set<string>();
  private swordAim = vec2(0.34, 0.16);
  private previousAim = vec2(0.34, 0.16);
  private swordVelocity = vec2(0, 0);
  private swordRoll = 0;
  private restartQueued = false;
  private locked = false;

  constructor(target: HTMLElement) {
    this.target = target;
    this.target.tabIndex = 0;
    this.bindEvents();
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  consumeFrame(dt: number): PlayerInputFrame {
    const move = mapMovementKeys(this.keys);

    this.swordVelocity = {
      x: (this.swordAim.x - this.previousAim.x) / Math.max(dt, 0.0001),
      y: (this.swordAim.y - this.previousAim.y) / Math.max(dt, 0.0001),
    };
    this.previousAim = vec2(this.swordAim.x, this.swordAim.y);
    const restart = this.restartQueued;
    this.restartQueued = false;

    return {
      move,
      swordAim: vec2(this.swordAim.x, this.swordAim.y),
      swordVelocity: vec2(this.swordVelocity.x, this.swordVelocity.y),
      swordRoll: this.swordRoll,
      pointerLocked: this.locked,
      restart,
    };
  }

  private bindEvents(): void {
    this.target.addEventListener("click", () => {
      this.target.focus();
      if (document.pointerLockElement !== this.target) {
        const lockRequest = this.target.requestPointerLock();
        if (lockRequest && typeof lockRequest.catch === "function") {
          lockRequest.catch(() => {
            this.locked = false;
          });
        }
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.target;
    });

    window.addEventListener("keydown", (event) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        this.keys.add(event.code);
        event.preventDefault();
      }
      if (event.code === "KeyR") {
        this.restartQueued = true;
      }
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
    });

    window.addEventListener("mousemove", (event) => {
      if (this.locked) {
        this.applyPointerDelta(event.movementX, event.movementY);
        return;
      }
      this.applyAbsolutePointer(event.clientX, event.clientY);
    });
  }

  private applyPointerDelta(dx: number, dy: number): void {
    const next = applySwordPointerDelta(this.swordAim, dx, dy, this.swordRoll);
    this.swordAim = next.aim;
    this.swordRoll = next.roll;
  }

  private applyAbsolutePointer(clientX: number, clientY: number): void {
    const rect = this.target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const next = mapAbsolutePointerToSwordAim(clientX, clientY, rect);
    const delta = sub(next, this.swordAim);
    this.swordAim = next;
    this.swordRoll += delta.x * 0.25;
  }
}
