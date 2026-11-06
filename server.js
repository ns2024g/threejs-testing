// Serves the game files in /public and relays player positions between everyone connected.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PLATFORM_SIZE = 100;   // must match public/game.js
const PLAYER_RADIUS = 0.5;
const LIMIT = PLATFORM_SIZE / 2 - PLAYER_RADIUS;

app.use(express.static(path.join(__dirname, 'public')));

// id -> { x, z, color }
const players = {};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

io.on('connection', (socket) => {
  players[socket.id] = {
    x: (Math.random() - 0.5) * 10,
    z: (Math.random() - 0.5) * 10,
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`,
  };

  // Tell the new player who they are and who is already here
  socket.emit('init', { id: socket.id, players });
  // Tell everyone else a new player joined
  socket.broadcast.emit('playerJoined', { id: socket.id, ...players[socket.id] });

  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p || !data || !Number.isFinite(data.x) || !Number.isFinite(data.z)) return;
    p.x = clamp(data.x, -LIMIT, LIMIT);
    p.z = clamp(data.z, -LIMIT, LIMIT);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

// Send everyone's positions to everyone, 20 times per second
setInterval(() => io.volatile.emit('state', players), 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game running at http://localhost:${PORT}`);
});
