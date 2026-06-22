import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const inputSource = readFileSync(new URL("../src/input/InputController.ts", import.meta.url), "utf8");

describe("main menu start gate", () => {
  it("shows SWORDPLAY and PLAY before enabling the game loop", () => {
    expect(mainSource).toContain("<h1>SWORDPLAY</h1>");
    expect(mainSource).toContain(">PLAY</button>");
    expect(mainSource).toContain("let gameStarted = false");
    expect(mainSource).toContain("if (!gameStarted)");
  });

  it("enables input and requests pointer lock from the PLAY gesture", () => {
    expect(mainSource).toContain("new InputController(shell, { enabled: false })");
    expect(mainSource).toContain("input.setEnabled(true)");
    expect(mainSource).toContain("input.requestPointerLock()");
    expect(inputSource).toContain("setEnabled(enabled: boolean)");
    expect(inputSource).toContain("requestPointerLock(): void");
  });
});
