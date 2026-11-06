# THREEJS Testing

A multiplayer 3D web game built with [three.js](https://threejs.org).

**Play:** https://ns2024g.github.io/threejs-testing/

Multiplayer is peer-to-peer ([Trystero](https://github.com/dmotz/trystero)), so there's no game server —
GitHub Pages serves the `docs/` folder and players' browsers connect to each other directly.

## Run locally

```
npm install
npm start
```

Then open http://localhost:3000.

## Credits

- Characters: "Rogue" and "Rogue (Hooded)" from the
  [KayKit Adventurers Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)
  by Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)) — CC0. Trimmed for the web
  (built-in animations and weapons removed); animated by this project's own walk/jog system.
