const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const ARENA_RADIUS = 380;
const BALL_RADIUS = 10;
const HIPPO_BODY_RADIUS = 38;
const MOUTH_LENGTH_MAX = 160;
const MOUTH_EXTEND_SPEED = 12;
const MOUTH_RETRACT_SPEED = 8;
const MOUTH_WIDTH = 50;
const CHOMP_COOLDOWN_MS = 300;
const MAX_PLAYERS = 20;
const TARGET_BALLS = 30;
const RESPAWN_BATCH = 5;
const BALL_SPEED_MIN = 1.2;
const BALL_SPEED_MAX = 3.5;
const BALL_DAMPING = 0.9995;
const BALL_BOUNCE_DAMPING = 0.9;
const SCORE_WINDOW_MS = 15_000;

const HIPPO_COLORS = [
  '#e74c3c', '#2ecc71', '#3498db', '#f1c40f',
  '#9b59b6', '#e67e22', '#1abc9c', '#e84393',
  '#00b894', '#fd79a8', '#6c5ce7', '#fdcb6e',
  '#00cec9', '#d63031', '#a29bfe', '#55efc4',
  '#fab1a0', '#74b9ff', '#ff7675', '#ffeaa7',
];

// ---------------------------------------------------------------------------
// Room state
// ---------------------------------------------------------------------------
const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('base64url');
}

function createRoom(code) {
  return {
    code,
    players: new Map(),
    balls: [],
    state: 'lobby', // lobby | countdown | playing
    loopInterval: null,
    nextColorIndex: 0,
    nextBallId: 0,
  };
}

function assignColor(room) {
  const color = HIPPO_COLORS[room.nextColorIndex % HIPPO_COLORS.length];
  room.nextColorIndex++;
  return color;
}

function hippoPosition(index, total) {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  return {
    x: Math.cos(angle) * ARENA_RADIUS,
    y: Math.sin(angle) * ARENA_RADIUS,
    angle: angle + Math.PI, // face center
  };
}

function recalcPositions(room) {
  const players = Array.from(room.players.values());
  const total = players.length;
  players.forEach((p, i) => {
    const pos = hippoPosition(i, total);
    p.x = pos.x;
    p.y = pos.y;
    p.angle = pos.angle;
    p.index = i;
  });
}

// ---------------------------------------------------------------------------
// Ball helpers
// ---------------------------------------------------------------------------
function spawnBall(room) {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * ARENA_RADIUS * 0.6;
  const speed = BALL_SPEED_MIN + Math.random() * (BALL_SPEED_MAX - BALL_SPEED_MIN);
  const dir = Math.random() * Math.PI * 2;
  const id = room.nextBallId++;
  room.balls.push({
    id,
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    vx: Math.cos(dir) * speed,
    vy: Math.sin(dir) * speed,
    alive: true,
  });
}

function spawnBalls(room) {
  room.balls = [];
  room.nextBallId = 0;
  for (let i = 0; i < TARGET_BALLS; i++) {
    spawnBall(room);
  }
}

function replenishBalls(room) {
  const alive = room.balls.filter(b => b.alive).length;
  if (alive < TARGET_BALLS) {
    const toSpawn = Math.min(RESPAWN_BATCH, TARGET_BALLS - alive);
    for (let i = 0; i < toSpawn; i++) {
      spawnBall(room);
    }
  }
  // Clean up dead balls to prevent array from growing forever
  if (room.balls.length > TARGET_BALLS * 3) {
    room.balls = room.balls.filter(b => b.alive);
  }
}

function tickBalls(room) {
  const aliveBalls = room.balls.filter(b => b.alive);

  for (const b of aliveBalls) {
    b.vx *= BALL_DAMPING;
    b.vy *= BALL_DAMPING;

    // Keep balls from going too slow — give them a nudge in their current direction
    const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (spd > 0 && spd < BALL_SPEED_MIN) {
      const scale = BALL_SPEED_MIN / spd;
      b.vx *= scale;
      b.vy *= scale;
    }
    if (spd > BALL_SPEED_MAX * 2) {
      const scale = (BALL_SPEED_MAX * 2) / spd;
      b.vx *= scale;
      b.vy *= scale;
    }

    b.x += b.vx;
    b.y += b.vy;

    // Bounce off arena wall
    const dist = Math.sqrt(b.x * b.x + b.y * b.y);
    const wallLimit = ARENA_RADIUS - BALL_RADIUS - 4;
    if (dist > wallLimit) {
      const nx = b.x / dist;
      const ny = b.y / dist;
      const dot = b.vx * nx + b.vy * ny;
      b.vx = (b.vx - 2 * dot * nx) * BALL_BOUNCE_DAMPING;
      b.vy = (b.vy - 2 * dot * ny) * BALL_BOUNCE_DAMPING;
      b.x = nx * wallLimit;
      b.y = ny * wallLimit;
    }

    // Bounce off hippo bodies
    for (const p of room.players.values()) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const minDist = BALL_RADIUS + HIPPO_BODY_RADIUS;
      if (d < minDist && d > 0) {
        const nx = dx / d;
        const ny = dy / d;
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) {
          b.vx -= 2 * dot * nx;
          b.vy -= 2 * dot * ny;
        }
        // Push ball outside hippo
        b.x = p.x + nx * (minDist + 1);
        b.y = p.y + ny * (minDist + 1);
      }
    }
  }

  // Ball-to-ball collisions
  for (let i = 0; i < aliveBalls.length; i++) {
    const a = aliveBalls[i];
    for (let j = i + 1; j < aliveBalls.length; j++) {
      const b = aliveBalls[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const minDist = BALL_RADIUS * 2;
      if (d < minDist && d > 0) {
        const nx = dx / d;
        const ny = dy / d;
        const relVel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (relVel > 0) {
          a.vx -= relVel * nx;
          a.vy -= relVel * ny;
          b.vx += relVel * nx;
          b.vy += relVel * ny;
        }
        // Separate
        const overlap = (minDist - d) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chomp collision
// ---------------------------------------------------------------------------
function tickPlayers(room) {
  const now = Date.now();
  for (const p of room.players.values()) {
    if (p.chomping && p.mouthExtend < MOUTH_LENGTH_MAX) {
      p.mouthExtend = Math.min(p.mouthExtend + MOUTH_EXTEND_SPEED, MOUTH_LENGTH_MAX);
    } else if (!p.chomping && p.mouthExtend > 0) {
      p.mouthExtend = Math.max(p.mouthExtend - MOUTH_RETRACT_SPEED, 0);
      if (p.mouthExtend === 0) {
        p.cooldownUntil = now + CHOMP_COOLDOWN_MS;
      }
    }

    if (p.mouthExtend > 0) {
      checkMouthCollision(room, p);
    }
  }
}

function checkMouthCollision(room, player) {
  const dx = Math.cos(player.angle);
  const dy = Math.sin(player.angle);
  // Mouth tip position
  const tipX = player.x + dx * (HIPPO_BODY_RADIUS + player.mouthExtend);
  const tipY = player.y + dy * (HIPPO_BODY_RADIUS + player.mouthExtend);
  // Mouth base position
  const baseX = player.x + dx * HIPPO_BODY_RADIUS;
  const baseY = player.y + dy * HIPPO_BODY_RADIUS;

  for (const b of room.balls) {
    if (!b.alive) continue;
    const dist = pointToSegmentDist(b.x, b.y, baseX, baseY, tipX, tipY);
    if (dist < BALL_RADIUS + MOUTH_WIDTH / 2) {
      b.alive = false;
      player.captures.push(Date.now());
    }
  }
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return Math.sqrt(apx * apx + apy * apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function rollingScore(player) {
  const cutoff = Date.now() - SCORE_WINDOW_MS;
  return player.captures.filter(t => t >= cutoff).length;
}

function pruneCaptures(room) {
  const cutoff = Date.now() - SCORE_WINDOW_MS;
  for (const p of room.players.values()) {
    p.captures = p.captures.filter(t => t >= cutoff);
  }
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function startGameLoop(room) {
  if (room.loopInterval) clearInterval(room.loopInterval);
  let tickCount = 0;
  room.loopInterval = setInterval(() => {
    tickBalls(room);
    tickPlayers(room);
    replenishBalls(room);

    // Prune old capture timestamps every ~2 seconds
    tickCount++;
    if (tickCount % 120 === 0) {
      pruneCaptures(room);
    }

    io.to(room.code).emit('game-state', buildGameState(room));
  }, TICK_MS);
}

function stopGameLoop(room) {
  if (room.loopInterval) {
    clearInterval(room.loopInterval);
    room.loopInterval = null;
  }
}

function buildGameState(room) {
  const players = [];
  for (const p of room.players.values()) {
    players.push({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      color: p.color,
      score: rollingScore(p),
      mouthExtend: p.mouthExtend,
      chomping: p.chomping,
    });
  }
  const balls = room.balls.filter(b => b.alive).map(b => ({ id: b.id, x: b.x, y: b.y }));
  return { players, balls, state: room.state };
}

function buildLobbyState(room) {
  const players = [];
  for (const p of room.players.values()) {
    players.push({ id: p.id, name: p.name, color: p.color });
  }
  return { players, state: room.state, code: room.code };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/create-room', (_req, res) => {
  const code = generateRoomCode();
  const room = createRoom(code);
  rooms.set(code, room);
  res.json({ code });
});

app.get('/game/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on('join-room', (data) => {
    const code = data && data.code;
    const name = (data && typeof data.name === 'string' ? data.name.trim() : '').slice(0, 16) || 'Hippo';

    const room = rooms.get(code);
    if (!room) {
      socket.emit('error-msg', 'Room not found');
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      socket.emit('error-msg', 'Room is full');
      return;
    }

    currentRoom = room;
    playerId = socket.id;

    const player = {
      id: socket.id,
      name,
      color: assignColor(room),
      x: 0,
      y: 0,
      angle: 0,
      index: room.players.size,
      captures: [],
      mouthExtend: 0,
      chomping: false,
      cooldownUntil: 0,
    };

    room.players.set(socket.id, player);
    recalcPositions(room);
    socket.join(code);

    socket.emit('joined', {
      playerId: socket.id,
      color: player.color,
      roomState: room.state,
    });

    io.to(code).emit('lobby-update', buildLobbyState(room));
  });

  socket.on('start-game', () => {
    if (!currentRoom) return;
    if (currentRoom.state !== 'lobby') return;

    currentRoom.state = 'countdown';

    for (const p of currentRoom.players.values()) {
      p.captures = [];
      p.mouthExtend = 0;
      p.chomping = false;
    }
    recalcPositions(currentRoom);
    spawnBalls(currentRoom);

    let count = 3;
    io.to(currentRoom.code).emit('countdown', count);
    const countInterval = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(currentRoom.code).emit('countdown', count);
      } else {
        clearInterval(countInterval);
        currentRoom.state = 'playing';
        io.to(currentRoom.code).emit('game-start');
        startGameLoop(currentRoom);
      }
    }, 1000);
  });

  socket.on('chomp-start', () => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const player = currentRoom.players.get(socket.id);
    if (!player) return;
    if (Date.now() < player.cooldownUntil) return;
    player.chomping = true;
  });

  socket.on('chomp-end', () => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(socket.id);
    if (!player) return;
    player.chomping = false;
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    currentRoom.players.delete(socket.id);
    if (currentRoom.players.size === 0) {
      stopGameLoop(currentRoom);
      rooms.delete(currentRoom.code);
    } else {
      recalcPositions(currentRoom);
      io.to(currentRoom.code).emit('lobby-update', buildLobbyState(currentRoom));
    }
  });
});

// ---------------------------------------------------------------------------
// Cleanup stale rooms every 10 minutes
// ---------------------------------------------------------------------------
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.players.size === 0) {
      stopGameLoop(room);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hungry Hippos running on http://localhost:${PORT}`);
});
