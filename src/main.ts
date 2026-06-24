import "./styles.css";
import { createInitialState, movementMultiplierForFighter, stepDuel } from "./game/simulation";
import { InputController } from "./input/InputController";
import { DuelRenderer } from "./render/DuelRenderer";
import { Hud } from "./ui/Hud";

declare global {
  interface Window {
    __EDGEGUARD_DEBUG__?: () => {
      elapsed: number;
      status: string;
      player: {
        x: number;
        y: number;
        rootY: number;
        balance: number;
        fatigue: number;
        moveMultiplier: number;
        canMove: boolean;
        movementLocked: boolean;
        grounded: boolean;
        falling: boolean;
        offBalanceTimer: number;
        stunTimer: number;
        swordX: number;
        swordY: number;
      };
      npc: {
        x: number;
        y: number;
        rootY: number;
        balance: number;
        fatigue: number;
        moveMultiplier: number;
        canMove: boolean;
        movementLocked: boolean;
        grounded: boolean;
        falling: boolean;
        offBalanceTimer: number;
        stunTimer: number;
      };
    };
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root");
}

const shell = document.createElement("main");
shell.className = "game-shell";
root.appendChild(shell);

const renderer = new DuelRenderer(shell);
const input = new InputController(shell, { enabled: false });
const hud = new Hud(shell);
const menu = document.createElement("section");
menu.className = "main-menu";
menu.setAttribute("aria-label", "Main menu");
menu.innerHTML = `
  <div class="menu-panel">
    <p class="menu-kicker">Edgeguard arena duel</p>
    <h1>SWORDPLAY</h1>
    <button class="play-button" type="button">PLAY</button>
  </div>
`;
shell.appendChild(menu);
const playButton = menu.querySelector<HTMLButtonElement>(".play-button");
if (!playButton) {
  throw new Error("Missing main menu play button");
}

let state = createInitialState();
let previousTime = performance.now();
let accumulator = 0;
const fixedStep = 1 / 60;
let gameStarted = false;
shell.classList.add("is-menu-open");

playButton.addEventListener("click", () => {
  gameStarted = true;
  state = createInitialState();
  previousTime = performance.now();
  accumulator = 0;
  menu.hidden = true;
  shell.classList.remove("is-menu-open");
  shell.classList.add("is-playing");
  input.setEnabled(true);
  input.requestPointerLock();
});

window.__EDGEGUARD_DEBUG__ = () => ({
  elapsed: state.elapsed,
  status: state.status,
  player: {
    x: state.player.position.x,
    y: state.player.position.y,
    rootY: state.player.rootHeight,
    balance: state.player.balance,
    fatigue: state.player.fatigue,
    moveMultiplier: movementMultiplierForFighter(state.player),
    canMove: state.player.canMove,
    movementLocked: state.player.movementLocked,
    grounded: state.player.isGrounded,
    falling: state.player.falling,
    offBalanceTimer: state.player.stumbleTimer,
    stunTimer: state.player.body.stunSeconds,
    swordX: state.player.sword.aim?.x ?? 0,
    swordY: state.player.sword.aim?.y ?? 0,
  },
  npc: {
    x: state.npc.position.x,
    y: state.npc.position.y,
    rootY: state.npc.rootHeight,
    balance: state.npc.balance,
    fatigue: state.npc.fatigue,
    moveMultiplier: movementMultiplierForFighter(state.npc),
    canMove: state.npc.canMove,
    movementLocked: state.npc.movementLocked,
    grounded: state.npc.isGrounded,
    falling: state.npc.falling,
    offBalanceTimer: state.npc.stumbleTimer,
    stunTimer: state.npc.body.stunSeconds,
  },
});

function syncDebugAttributes(): void {
  shell.dataset.status = state.status;
  shell.dataset.elapsed = state.elapsed.toFixed(3);
  shell.dataset.playerX = state.player.position.x.toFixed(3);
  shell.dataset.playerY = state.player.position.y.toFixed(3);
  shell.dataset.playerRootY = state.player.rootHeight.toFixed(3);
  shell.dataset.playerBalance = state.player.balance.toFixed(1);
  shell.dataset.playerFatigue = state.player.fatigue.toFixed(1);
  shell.dataset.playerMoveMultiplier = movementMultiplierForFighter(state.player).toFixed(3);
  shell.dataset.playerCanMove = String(state.player.canMove);
  shell.dataset.playerMovementLocked = String(state.player.movementLocked);
  shell.dataset.playerGrounded = String(state.player.isGrounded);
  shell.dataset.playerFalling = String(state.player.falling);
  shell.dataset.playerOffBalanceTimer = state.player.stumbleTimer.toFixed(3);
  shell.dataset.playerStunTimer = state.player.body.stunSeconds.toFixed(3);
  shell.dataset.playerSwordX = (state.player.sword.aim?.x ?? 0).toFixed(3);
  shell.dataset.playerSwordY = (state.player.sword.aim?.y ?? 0).toFixed(3);
  shell.dataset.npcX = state.npc.position.x.toFixed(3);
  shell.dataset.npcY = state.npc.position.y.toFixed(3);
  shell.dataset.npcRootY = state.npc.rootHeight.toFixed(3);
  shell.dataset.npcBalance = state.npc.balance.toFixed(1);
  shell.dataset.npcFatigue = state.npc.fatigue.toFixed(1);
  shell.dataset.npcMoveMultiplier = movementMultiplierForFighter(state.npc).toFixed(3);
  shell.dataset.npcCanMove = String(state.npc.canMove);
  shell.dataset.npcMovementLocked = String(state.npc.movementLocked);
  shell.dataset.npcGrounded = String(state.npc.isGrounded);
  shell.dataset.npcFalling = String(state.npc.falling);
  shell.dataset.npcOffBalanceTimer = state.npc.stumbleTimer.toFixed(3);
  shell.dataset.npcStunTimer = state.npc.body.stunSeconds.toFixed(3);
}

function tick(now: number): void {
  const frameDt = Math.min((now - previousTime) / 1000, 0.08);
  previousTime = now;

  if (!gameStarted) {
    renderer.render(state, frameDt);
    syncDebugAttributes();
    requestAnimationFrame(tick);
    return;
  }

  accumulator += frameDt;

  let frame = input.consumeFrame(frameDt);
  while (accumulator >= fixedStep) {
    const nextState = stepDuel(state, frame, fixedStep);
    if (nextState !== state) {
      state = nextState;
      renderer.clearEffects();
      frame = { ...frame, restart: false };
    }
    accumulator -= fixedStep;
  }

  renderer.render(state, frameDt);
  hud.update(state, input.pointerLocked);
  syncDebugAttributes();
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
