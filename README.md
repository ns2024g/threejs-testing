# FIVE TAPES

A multiplayer lo-fi horror game built with [three.js](https://threejs.org).

**Play:** https://ns2024g.github.io/threejs-testing/

Five VHS tapes are hidden in the ruins of a village swallowed by a dark forest. Each one hums —
listen for it. Carry them one at a time to the altar in the church and play them. Every tape
makes the world worse and the thing in the woods faster.

**It replays you.** The thing in the woods walks exactly where you walked, at the speed you
walked, some seconds behind you (the timecode in the corner). Run, and it will run. Stand still
and it catches up. Go back the way you came and you walk straight into it. Get close enough for
it to see you and it drops onto all fours and comes straight for you. Playing a tape rewinds it.

**Controls:** click to play · WASD move · Shift run · E take / play a tape · Esc pause menu & settings

Multiplayer is peer-to-peer ([Trystero](https://github.com/dmotz/trystero)), so there's no game server —
GitHub Pages serves the `docs/` folder and players' browsers connect to each other directly.

## Run locally

```
npm install
npm start
```

Then open http://localhost:3000.
