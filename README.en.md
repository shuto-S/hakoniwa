<div align="center">

# Hakoniwa 🌱

**A tiny world in the corner of your desktop.**

A hexagonal-block miniature garden that keeps growing, living, and cycling
through seasons — while you work. A "watch-and-relax" desktop widget.

[日本語](README.md) | English

[![CI](https://github.com/shuto-S/hakoniwa/actions/workflows/ci.yml/badge.svg)](https://github.com/shuto-S/hakoniwa/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/shuto-S/hakoniwa?color=6cc75a)](https://github.com/shuto-S/hakoniwa/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![Made with](https://img.shields.io/badge/Electron%20%2B%20Three.js-2b3a55)

<img src="docs/demo.gif" width="440" alt="Hakoniwa demo: water flowing, rain passing, a campfire burning, and villagers wandering" />
<br />
<sub>Pour some water, light a campfire, watch the rain pass — everything else just happens</sub>

</div>

## What is this?

A Minecraft-like sandbox floating in a transparent, always-on-top window —
but the real point is *watching*.

- 🔷 Build an island with **hexagonal blocks** (15×15 grid, resizable)
- 🧑‍🌾 Villagers have **names, personalities and jobs**, and live on their own
- 🌸 **Seasons, day/night and weather** cycle; the world grows and decays
- 🎧 **Ambient sound** — rain, birds, crickets, crackling campfires — all procedurally generated
- 🖥 The window is transparent; only the blocks' **shadow falls on your desktop**

## ✨ What happens in the world

| | |
| --- | --- |
| 🏗 **Build** | Stack and break blocks. Water flows downhill, campfires burn with smoke |
| 🌱 **Grow** | Grass spreads, flowers bloom, trees grow, villagers build huts |
| 🍂 **Decay** | Campfires burn out, flowers wither, old trees fall, huts crumble |
| 🌦 **Cycle** | Four seasons (3 days each). Fireflies on summer nights, falling leaves in autumn, frozen ponds in winter |
| 🐑 **Live** | The lumberjack fells trees and plants saplings, the farmer tends wheat, the fisher casts a line. At night everyone sleeps; every third night there's a bonfire festival |
| 🐣 **Continue** | Eggs hatch into chicks, lambs are born, travelers settle in the village |
| 💬 **Meet** | Characters greet each other when they pass by (cats are aloof) |
| 🎁 **Secrets** | A few rare visitors and events are not documented — you'll have to keep watching |

## 📦 Install

### Download

Grab the latest zip from [Releases](https://github.com/shuto-S/hakoniwa/releases)
(`arm64` = Apple Silicon, `x64` = Intel), unzip, and drop `はこにわ.app` into Applications.

> Unsigned build: right-click → "Open" on first launch.

### Build from source

```sh
git clone https://github.com/shuto-S/hakoniwa.git
cd hakoniwa
npm install
npm start        # run directly
npm run package  # build the .app (output in release/)
```

Requires macOS + Node.js 20+.

## 🎮 Controls

| Input | Action |
| --- | --- |
| Left click | Place the selected block |
| Right click / ⛏ | Break a block |
| Scroll wheel | Zoom |
| ⟲ / ⟳ | Rotate view by 60° |
| 🌱 | Auto-develop mode |
| 📷 | Take a screenshot, preview it, then save or share to X |
| ⚙ | Settings |
| Drag the top bar | Move the window |

The UI fades away when the window loses focus, leaving just the world on your desktop.

## 🛠 Development

- Procedures (setup / releasing / troubleshooting): [DEVELOPMENT.md](DEVELOPMENT.md) (Japanese)
- Architecture notes for AI agents: [AGENTS.md](AGENTS.md) (Japanese)

Electron + Three.js (orthographic isometric camera, InstancedMesh), odd-r offset
hex grid, esbuild bundle. Ambient audio is generated in real time with Web Audio —
no audio files.

## License

[MIT](LICENSE)
