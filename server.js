// Local test server only: serves the game in /docs at http://localhost:3000.
// Online, GitHub Pages serves /docs directly, and players connect peer-to-peer.
const path = require('path');
const express = require('express');

const app = express();
app.use(express.static(path.join(__dirname, 'docs')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Game running at http://localhost:${PORT}`);
});
