import type { DuelState } from "../game/types";

export class Hud {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly round: HTMLElement;
  private readonly playerFill: HTMLElement;
  private readonly npcFill: HTMLElement;
  private readonly playerLabel: HTMLElement;
  private readonly npcLabel: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly result: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("section");
    this.root.className = "hud";
    this.root.setAttribute("aria-label", "Round status");
    this.root.innerHTML = `
      <div class="hud-strip">
        <span class="round-pill" data-round>Round 1</span>
        <strong data-status>Push your rival off the edge</strong>
      </div>
      <div class="balance-stack" aria-label="Balance indicators">
        <div class="balance-row">
          <span data-player-label>You</span>
          <div class="balance-meter"><span data-player-fill></span></div>
        </div>
        <div class="balance-row">
          <span data-npc-label>Rival</span>
          <div class="balance-meter npc"><span data-npc-fill></span></div>
        </div>
      </div>
      <div class="prompt" data-prompt>Click to capture mouse. WASD move. Mouse guides blade.</div>
      <div class="result-banner" data-result hidden></div>
    `;
    parent.appendChild(this.root);
    this.status = this.required("[data-status]");
    this.round = this.required("[data-round]");
    this.playerFill = this.required("[data-player-fill]");
    this.npcFill = this.required("[data-npc-fill]");
    this.playerLabel = this.required("[data-player-label]");
    this.npcLabel = this.required("[data-npc-label]");
    this.prompt = this.required("[data-prompt]");
    this.result = this.required("[data-result]");
  }

  update(state: DuelState, pointerLocked: boolean): void {
    this.round.textContent = `Round ${state.round}`;
    this.status.textContent = state.message;
    this.playerFill.style.transform = `scaleX(${(state.player.balance / state.player.maxBalance).toFixed(3)})`;
    this.npcFill.style.transform = `scaleX(${(state.npc.balance / state.npc.maxBalance).toFixed(3)})`;
    this.playerLabel.textContent = state.player.isOffBalance ? "You - off balance" : state.player.staggerSeconds > 0 ? "You - staggered" : "You";
    this.npcLabel.textContent = state.npc.isOffBalance ? "Rival - off balance" : state.npc.staggerSeconds > 0 ? "Rival - staggered" : "Rival";
    this.prompt.hidden = pointerLocked || state.status !== "playing";

    if (state.status === "playing") {
      this.result.hidden = true;
      this.result.textContent = "";
      return;
    }

    this.result.hidden = false;
    this.result.textContent =
      state.status === "playerWon"
        ? "Ring-out. You win. Press R to restart."
        : state.player.falling
          ? "You were knocked off. Press R to restart."
          : "Ring-out loss. Press R to restart.";
  }

  private required(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) {
      throw new Error(`Missing HUD element: ${selector}`);
    }
    return element;
  }
}
