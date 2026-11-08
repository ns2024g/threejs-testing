// Background thread: sculpts Creature 1's body and sends it back to the game.
const { buildCreature1Geometry } = await import(`./creature1-geometry.js${self.location.search}`);

const geometry = buildCreature1Geometry({ onProgress: (progress) => self.postMessage({ progress }) });
self.postMessage({ geometry }, [
  geometry.position.buffer, geometry.index.buffer, geometry.color.buffer,
  geometry.skinIndex.buffer, geometry.skinWeight.buffer,
]);
