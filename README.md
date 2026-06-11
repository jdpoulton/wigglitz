# Wigglitz 3D

A pseudo-3D (raycaster) open-map sandbox themed on **wigglitz.com**, built with
**zero installs and no admin rights** — only tools that ship with Windows.

Think Wolfenstein-3D-style first-person exploration: a procedurally generated
open world of colorful pillars you walk through, after picking which Wigglitz
collectible is your avatar.

## How it's built (the "hybrid" design)

| Piece | Language | Built by | Role |
|-------|----------|----------|------|
| `WorldGen.dll` | **hand-written IL assembly** | `ilasm.exe` | Procedural world generator. `Cell(x,y,seed)` is called per ray-step — the genuine hot path. |
| `Wigglitz3D.exe` | C# | `csc.exe` | Window, raycaster renderer, input, Wigglitz character-select, HUD. References the IL DLL. |

Both `ilasm.exe` and `csc.exe` live in
`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\` on essentially every Windows
machine — they come with the .NET Framework, not with Visual Studio.

This is the answer to the original goal: code at the base layer, in hand-written
assembly, with no installs — with the hand-tuned IL placed exactly where speed
matters (the inner generation loop) and C# handling the window plumbing that
gains nothing from being assembly.

## Quick start (Windows)

Clone the repo, then pick either way to run — both need nothing installed:

- **Just play it:** double-click **`Play.bat`**. It assembles the hand-written
  IL into `WorldGen.dll` (if needed), then runs the game inside PowerShell by
  compiling `Game.cs` in memory. No standalone `.exe` is ever written to disk.
- **Build a real .exe:** run **`build.bat`**, then double-click the resulting
  `Wigglitz3D.exe`.

Both paths use only `ilasm.exe` / `csc.exe`, which ship with the .NET Framework
in `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\` — present on essentially
every Windows machine, no Visual Studio required.

## Build by hand

```
set NET=C:\Windows\Microsoft.NET\Framework64\v4.0.30319
%NET%\ilasm.exe /dll /output:WorldGen.dll WorldGen.il
%NET%\csc.exe /target:winexe /out:Wigglitz3D.exe /reference:WorldGen.dll ^
  /reference:System.dll /reference:System.Core.dll ^
  /reference:System.Drawing.dll /reference:System.Windows.Forms.dll Game.cs
```

## Play

Run **`Play.bat`** (or the built `Wigglitz3D.exe`).

- **Title screen** — press **Enter**.
- **Character select** — **Left / Right** to pick your Wigglitz, **Enter** to enter the world.
- **In the world**:
  - **Mouse** — look around: move left/right to turn, up/down to look up at your
    towers or down into your holes
  - **W / S** (or **Up / Down**) — move forward / back;  **A / D** (or **Left / Right**) — strafe
  - **Left mouse** — dig: lower the cell you're facing one block (chip a wall, or dig a hole into the ground)
  - **Right mouse** — build: raise the cell you're facing one block (stack repeatedly to grow a tower)
  - **1–4** — pick which block type to build with
  - **C** or **Tab** — open your collection screen
  - **Esc** — release the mouse / close collection / back to character select
  - You climb cells up to one block taller (walk up your own towers like stairs);
    taller walls block you; step down into pits freely.
- **The collect loop:** Wigglitz collectibles are scattered across the world as
  3D billboard characters. Walk into one to add it to your collection (you'll get
  a sparkle, a chime, and a "NEW!" toast). Find all of them to complete the set.
- Top-right is a live **minimap** — gold dots are nearby uncollected Wigglitz.
- The HUD shows your collection count and your chosen Wigglitz bobbing along.

All world edits and your collection live entirely in memory — nothing is saved
to disk, so each launch is a fresh world.

## Web version (play in a browser / deploy to Vercel)

[`web/`](web/) is a self-contained HTML5 Canvas port — same heightmap world,
build/dig towers and holes, collectibles, and Wigglitz. The world generator is a
1:1 JavaScript port of the hand-written IL, **verified to produce an identical
map**. Mouse-look uses the browser Pointer Lock API (smooth, no recentering).

Pure static files — no build step, no dependencies.

**Try it locally:** open `web/index.html` in a browser (just double-click it).

**Deploy to Vercel:**
1. On [vercel.com](https://vercel.com): New Project -> import this repo ->
   set **Root Directory** to `web` -> Framework Preset **Other** -> **Deploy**
   (no build command; it's static).
2. Or with the CLI: `cd web && npx vercel`.

**Controls:** click the canvas to capture the mouse, then **mouse** to look,
**WASD** to move, **left-click** dig, **right-click** build, **1-4** pick a
block, **C** collection, **Esc** to release. **-** / **+** tune sensitivity.
(Desktop-oriented; touch controls aren't wired up yet.)

## The roster

Drawn in code from the wigglitz.com palette (teals, purples, yellows, greens):
Winky (the one-eyed mascot), Speckles, Scuba Steve, Miley, Blooper, Starshine,
Jett, Melly.

## Easy things to tweak

- **World feel** — edit `WorldGen.il` (the `78` constant = % open space; the
  `% 4` = number of wall types), then rerun `build.bat`.
- **Different world** — change `seed` in `Game.cs`.
- **Resolution / FOV** — `IW`, `IH`, and the `planeY` (0.66) field in `Game.cs`.
- **Add characters** — add entries to `BuildRoster()` in `Game.cs`.

## Roadmap

- **Phase 1 (done):** raycaster foundation — movement, world gen, character select, HUD/minimap.
- **Phase 2 (done):** the game loop — mine/place blocks, collectible Wigglitz as
  3D billboard sprites, collection screen, hotbar, particle juice, pickup chime.
- **Phase 3 (done):** verticality — a heightmap voxel engine (build towers, dig
  holes), mouse-look (yaw + pitch), step-up climbing, eye height that rides the
  surface, collectibles anchored to their cell's height.
- **Phase 4 (planned):** the showpiece wrapper — textures, sound/music, biomes
  themed to the real Wigglitz series, title cinematic, collection gallery,
  achievements. The full "I'd sell this" polish pass.

## Easy things to tweak (Phase 2)

- **How many collectibles** — the `h % 100` test in `BuildCollectibles()` (smaller = more).
- **Pickup range** — the `< 0.30` distance check in `Update()`.
- **Reach for mining/placing** — the `reach = 4.5` in `RayTarget()`.
