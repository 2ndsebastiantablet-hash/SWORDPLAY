# Edgeguard Duel

Original browser-based 3D sword-dueling prototype built with TypeScript, Vite, and Three.js.

## Run

```powershell
npm.cmd install
npm.cmd run dev -- --port 5177
```

Open `http://127.0.0.1:5177`.

## Controls

- `W A S D`: move
- Mouse movement: position, rotate, attack, and block with the sword
- `R`: restart after a win or loss

There are no attack, block, stamina, or special ability buttons. Blocking and striking come from where the sword is and how quickly it moves.

## Checks

```powershell
npm.cmd test
npm.cmd run build
```
