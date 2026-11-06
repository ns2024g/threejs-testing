// Serves the game files in /public. Multiplayer will be added here later.
const path = require('path');
const express = require('express');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Game running at http://localhost:${PORT}`);
});
