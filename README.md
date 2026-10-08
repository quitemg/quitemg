# Neon Survivor

A complete top-down survival game built with HTML, CSS, and vanilla JavaScript. No libraries, image assets, build step, package installation, or network connection are required.

## Play locally

Open `index.html` directly in a modern browser, then click **Play**. Keep `index.html`, `style.css`, and `game.js` together in the same directory.

Alternatively, serve the directory with Python:

```sh
cd /workspace/quitemg
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser. Stop the server with Ctrl+C. The game also works directly from a `file://` URL.

## Controls

| Action | Control |
| --- | --- |
| Move | WASD or arrow keys |
| Shoot | Automatic; targets the nearest enemy |
| Choose an upgrade | Click a card or press 1, 2, or 3 |
| Pause / resume | P, Escape, or the Pause / Resume button |
| Start / restart | Play / Restart button |
| Move on a touch device | On-screen direction pad |

The game pauses automatically when the window loses focus or the tab is hidden. Resume when you return.

## Survive the arena

Start with **100 HP**. Enemies enter from the arena edges, chase you, and damage you on contact. A brief protection period after each hit gives you time to escape. Eliminate enemies to gain XP. Each level pauses the action and offers three distinct random upgrades; select one to resume. Upgrades stack across levels:

- **Rapid Circuit:** +20% fire rate.
- **Overcharged Rounds:** +25% bullet damage.
- **Ghost Step:** +15% movement speed.
- **Split Signal:** +1 projectile per volley.
- **Reinforced Core:** +25 maximum HP and recover 25 HP.
- **Emergency Patch:** restore 30 HP, capped at maximum HP.

Basic enemies are pink diamonds. Fast enemies are yellow triangles and begin appearing after 12 seconds. Tanks are violet hexagons and join after 30 seconds. Enemy health, damage, speed, and spawn frequency grow with survival time; spawn groups grow too. A large orange **Warden boss** enters every 60 seconds of active gameplay, with increasing health. Pauses and upgrade screens do not advance the survival timer or boss countdown.

There is no final wave: survive as long as you can. At zero HP, the game shows your time, kills, and level. Restart begins a fresh run with all stats, enemies, projectiles, and upgrades reset.

## Files and implementation

- `index.html`: interface, accessible controls, HUD, and game screens.
- `style.css`: responsive neon styling, overlays, focus states, and touch controls.
- `game.js`: player and game state, enemies, projectiles, upgrades, input, UI transitions, Canvas renderer, and animation loop.

The arena uses fixed logical coordinates and scales to the available canvas size, with a device-pixel-ratio-aware backing buffer. Movement is time based and diagonal input is normalized. Bullet collisions sweep their traveled path to avoid missing enemies between frames. Death particles and damage shake provide feedback; reduced-motion preferences suppress screen shake.

## Quick checks

Check JavaScript syntax with Node.js if available:

```sh
node --check game.js
```

For a browser check, start a run and verify that WASD movement, automatic fire, kills, XP, and the timer work. Choose a level-up card, pause and resume, survive a minute to see a boss, then verify Game Over and Restart. Check the browser console for errors. Browser developer tools are optional; Node.js and Python are not required to play.
