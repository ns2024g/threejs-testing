// Background thread: sculpts Creature 1's body and sends it back to the game.
const { buildCreature1Geometry } = await import(`./creature1-geometry.js${self.location.search}`);

// Low detail on purpose (bigger number = blockier, lower-poly body), to match the cheap PS1 look
const geometry = buildCreature1Geometry({ resolution: 0.016, onProgress: (progress) => self.postMessage({ progress }) });
self.postMessage({ geometry }, [
  geometry.position.buffer, geometry.index.buffer, geometry.color.buffer,
  geometry.skinIndex.buffer, geometry.skinWeight.buffer,
]);
