/* ------------------------------------------------------------------ */
/* Audio (Web Audio API — no files needed)                            */
/* ------------------------------------------------------------------ */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let muted = false;

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
}

function playChomp() {
  if (muted) return;
  ensureAudio();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(220, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.12);
  g.gain.setValueAtTime(0.15, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.15);
}

function playCapture() {
  if (muted) return;
  ensureAudio();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(600, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.08);
  g.gain.setValueAtTime(0.12, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.12);
}

/* ------------------------------------------------------------------ */
/* Connection & state                                                 */
/* ------------------------------------------------------------------ */
const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const ARENA_RADIUS = 380;
const BALL_RADIUS = 10;
const HIPPO_BODY = 38;
const MOUTH_WIDTH = 50;

let myId = null;
let myColor = null;
let myName = null;
let gameState = null;   // { players, balls, state }
let phase = 'name';     // name | lobby | countdown | playing
let countdownNum = 0;

// Captured-ball particles
const particles = [];

// Extract room code from URL
const roomCode = window.location.pathname.split('/').pop();

// ---- DOM refs ----
const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

const nameOverlay = document.getElementById('name-overlay');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const lobbyOverlay = document.getElementById('lobby-overlay');
const scoreboard = document.getElementById('scoreboard');
const instruction = document.getElementById('instruction');
const mobileChomp = document.getElementById('mobile-chomp');
const roomLinkInput = document.getElementById('room-link');
const copyBtn = document.getElementById('copy-btn');
const startBtn = document.getElementById('start-btn');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');

/* ------------------------------------------------------------------ */
/* Canvas sizing                                                      */
/* ------------------------------------------------------------------ */
function resize() {
  const size = Math.min(window.innerWidth, window.innerHeight, 860);
  canvas.width = size;
  canvas.height = size;
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ */
/* Name entry                                                         */
/* ------------------------------------------------------------------ */
nameInput.focus();

function submitName() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  myName = name;
  nameOverlay.classList.add('hidden');
  lobbyOverlay.classList.remove('hidden');
  phase = 'lobby';
  socket.emit('join-room', { code: roomCode, name: myName });
}

joinBtn.addEventListener('click', submitName);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitName();
});

/* ------------------------------------------------------------------ */
/* Socket events                                                      */
/* ------------------------------------------------------------------ */
socket.on('joined', (data) => {
  myId = data.playerId;
  myColor = data.color;
  roomLinkInput.value = window.location.href;
  if (data.roomState === 'playing') {
    showPlaying();
  }
});

socket.on('lobby-update', (data) => {
  renderLobbyPlayers(data.players);
});

socket.on('countdown', (num) => {
  phase = 'countdown';
  countdownNum = num;
  lobbyOverlay.classList.add('hidden');
  scoreboard.style.display = 'none';
  instruction.style.display = 'none';
  mobileChomp.style.display = 'none';
});

socket.on('game-start', () => {
  showPlaying();
});

socket.on('game-state', (data) => {
  if (gameState && data.balls) {
    const newBallIds = new Set(data.balls.map(b => b.id));
    for (const oldBall of (gameState.balls || [])) {
      if (!newBallIds.has(oldBall.id)) {
        spawnCaptureParticles(oldBall.x, oldBall.y, ballColor(oldBall.id));
        playCapture();
      }
    }
  }
  gameState = data;
});

socket.on('error-msg', (msg) => {
  alert(msg);
  window.location.href = '/';
});

/* ------------------------------------------------------------------ */
/* Lobby UI                                                           */
/* ------------------------------------------------------------------ */
function renderLobbyPlayers(players) {
  playerList.innerHTML = '';
  players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'player-list-item' + (p.id === myId ? ' me' : '');
    item.innerHTML = `<span class="player-list-dot" style="background:${p.color}"></span>${escHtml(p.name)}`;
    playerList.appendChild(item);
  });
  playerCount.textContent = `${players.length} player${players.length !== 1 ? 's' : ''} in lobby`;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(roomLinkInput.value).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });
});

startBtn.addEventListener('click', () => {
  socket.emit('start-game');
});

/* ------------------------------------------------------------------ */
/* Phase transitions                                                  */
/* ------------------------------------------------------------------ */
function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function showPlaying() {
  phase = 'playing';
  lobbyOverlay.classList.add('hidden');
  scoreboard.style.display = '';
  if (isTouchDevice()) {
    mobileChomp.style.display = 'block';
    instruction.style.display = 'none';
  } else {
    mobileChomp.style.display = 'none';
    instruction.style.display = '';
    instruction.style.opacity = '1';
    setTimeout(() => {
      instruction.style.opacity = '0';
      setTimeout(() => { instruction.style.display = 'none'; }, 600);
    }, 4000);
  }
}

/* ------------------------------------------------------------------ */
/* Input handling                                                     */
/* ------------------------------------------------------------------ */
function doChomp() {
  socket.emit('chomp');
  playChomp();
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && phase === 'playing') {
    e.preventDefault();
    if (!e.repeat) doChomp();
  }
});

mobileChomp.addEventListener('touchstart', (e) => {
  e.preventDefault();
  doChomp();
});

/* ------------------------------------------------------------------ */
/* Particles                                                          */
/* ------------------------------------------------------------------ */
function spawnCaptureParticles(x, y, color) {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const speed = 2 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color,
      size: 3 + Math.random() * 5,
    });
  }
  // Add a flash ring
  particles.push({
    x, y, vx: 0, vy: 0,
    life: 1, color: '#fff',
    size: BALL_RADIUS * 2, ring: true,
  });
}

function tickParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.ring ? 0.04 : 0.025;
    if (!p.ring) p.size *= 0.97;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */
function render() {
  requestAnimationFrame(render);
  tickParticles();

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const scale = Math.min(w, h) / (ARENA_RADIUS * 2 + 120);

  if (phase === 'lobby') return;

  // Draw countdown
  if (phase === 'countdown') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    drawArena();
    if (gameState) drawBalls();
    if (gameState) drawHippos();
    ctx.restore();
    ctx.fillStyle = 'rgba(15, 14, 23, 0.6)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 120px sans-serif';
    ctx.fillStyle = '#ff8906';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(countdownNum, cx, cy);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('GET READY!', cx, cy + 70);
    return;
  }

  if (!gameState) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  drawArena();
  drawBalls();
  drawHippos();
  drawParticles();

  ctx.restore();

  updateScoreboard();
}

function drawArena() {
  // Outer glow
  const grad = ctx.createRadialGradient(0, 0, ARENA_RADIUS * 0.8, 0, 0, ARENA_RADIUS + 30);
  grad.addColorStop(0, 'rgba(30, 27, 58, 0)');
  grad.addColorStop(1, 'rgba(30, 27, 58, 0.8)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS + 30, 0, Math.PI * 2);
  ctx.fill();

  // Arena circle
  ctx.fillStyle = '#1a1929';
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Border ring
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  // Center ring decoration
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS * 0.4, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBalls() {
  if (!gameState.balls) return;
  for (const b of gameState.balls) {
    const color = ballColor(b.id);
    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    // Shine highlight
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(b.x - 2, b.y - 3, BALL_RADIUS * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawHippos() {
  if (!gameState.players) return;
  for (const p of gameState.players) {
    drawSingleHippo(p, p.id === myId);
  }
}

function drawSingleHippo(p, isMe) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);

  const bodyR = HIPPO_BODY;

  // Draw mouth / tongue first (behind body)
  if (p.mouthExtend > 0) {
    const mouthLen = p.mouthExtend;
    // Upper jaw
    ctx.fillStyle = darken(p.color, 0.15);
    ctx.beginPath();
    ctx.moveTo(bodyR - 4, -MOUTH_WIDTH / 2);
    ctx.lineTo(bodyR + mouthLen, -MOUTH_WIDTH / 2 + 8);
    ctx.lineTo(bodyR + mouthLen, -2);
    ctx.lineTo(bodyR - 4, -2);
    ctx.closePath();
    ctx.fill();
    // Lower jaw
    ctx.fillStyle = darken(p.color, 0.2);
    ctx.beginPath();
    ctx.moveTo(bodyR - 4, MOUTH_WIDTH / 2);
    ctx.lineTo(bodyR + mouthLen, MOUTH_WIDTH / 2 - 8);
    ctx.lineTo(bodyR + mouthLen, 2);
    ctx.lineTo(bodyR - 4, 2);
    ctx.closePath();
    ctx.fill();
    // Tongue / inside
    ctx.fillStyle = '#e84393';
    ctx.beginPath();
    ctx.moveTo(bodyR, -MOUTH_WIDTH / 2 + 12);
    ctx.lineTo(bodyR + mouthLen * 0.7, -4);
    ctx.lineTo(bodyR + mouthLen * 0.7, 4);
    ctx.lineTo(bodyR, MOUTH_WIDTH / 2 - 12);
    ctx.closePath();
    ctx.fill();
  }

  // Body
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(0, 0, bodyR, 0, Math.PI * 2);
  ctx.fill();

  // Body highlight
  ctx.fillStyle = lighten(p.color, 0.2);
  ctx.beginPath();
  ctx.arc(-6, -8, bodyR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Snout bump
  ctx.fillStyle = lighten(p.color, 0.1);
  ctx.beginPath();
  ctx.ellipse(bodyR * 0.6, 0, bodyR * 0.5, bodyR * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = darken(p.color, 0.35);
  ctx.beginPath();
  ctx.arc(bodyR * 0.7, -6, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bodyR * 0.7, 6, 3, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const eyeX = -4;
  const eyeY1 = -14;
  const eyeY2 = 14;
  // Whites
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY1, 9, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY2, 9, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = '#1a1929';
  ctx.beginPath();
  ctx.arc(eyeX + 3, eyeY1, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(eyeX + 3, eyeY2, 5, 0, Math.PI * 2);
  ctx.fill();
  // Pupil highlights
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(eyeX + 5, eyeY1 - 2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(eyeX + 5, eyeY2 - 2, 2, 0, Math.PI * 2);
  ctx.fill();

  // Ears (little bumps on the back)
  ctx.fillStyle = darken(p.color, 0.1);
  ctx.beginPath();
  ctx.arc(-bodyR * 0.6, -bodyR * 0.7, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-bodyR * 0.6, bodyR * 0.7, 10, 0, Math.PI * 2);
  ctx.fill();

  // Name label — counter-rotate so text stays upright
  {
    const label = p.name || '???';
    ctx.save();
    ctx.translate(0, -bodyR - 18);
    ctx.rotate(-p.angle);
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 14;
    const pillW = isMe ? tw + 36 : tw;
    ctx.fillStyle = isMe ? 'rgba(255,137,6,0.25)' : 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-pillW / 2, -10, pillW, 20, 8);
    } else {
      ctx.rect(-pillW / 2, -10, pillW, 20);
    }
    ctx.fill();
    if (isMe) {
      ctx.fillStyle = '#ff8906';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('YOU', -pillW / 2 + 18, 1);
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(label, (36 - pillW) / 2 + tw / 2 + 4, 1);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(label, 0, 1);
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.life;
    if (p.ring) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      const r = p.size * (2 - p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

const SCORE_ROW_HEIGHT = 28;
const scoreRowMap = new Map();
let scoreHeaderCreated = false;

function updateScoreboard() {
  if (!gameState || !gameState.players || gameState.players.length === 0) return;

  if (!scoreHeaderCreated) {
    scoreboard.innerHTML = '<h3>Last 15s</h3>';
    scoreHeaderCreated = true;
  }

  const sorted = [...gameState.players].sort((a, b) => b.score - a.score);

  // Remove rows for players who left
  for (const [id, el] of scoreRowMap) {
    if (!sorted.find(p => p.id === id)) {
      el.remove();
      scoreRowMap.delete(id);
    }
  }

  sorted.forEach((p, i) => {
    let row = scoreRowMap.get(p.id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `
        <span class="score-dot" style="background:${p.color}"></span>
        <span class="score-name"></span>
        <span class="score-label"></span>`;
      scoreboard.appendChild(row);
      scoreRowMap.set(p.id, row);
      // Start at correct position immediately (no animation on first appearance)
      row.style.transition = 'none';
      row.style.transform = `translateY(${i * SCORE_ROW_HEIGHT}px)`;
      requestAnimationFrame(() => {
        row.style.transition = '';
      });
    }

    const isMe = p.id === myId;
    const display = p.name || '???';
    row.querySelector('.score-name').innerHTML =
      (isMe ? '<span class="you-tag">YOU</span> ' : '') + escHtml(display);
    row.querySelector('.score-label').textContent = p.score;
    row.style.transform = `translateY(${i * SCORE_ROW_HEIGHT}px)`;
  });

  // Resize container to fit all rows (header ~32px + rows)
  scoreboard.style.height = (40 + sorted.length * SCORE_ROW_HEIGHT) + 'px';
}

/* ------------------------------------------------------------------ */
/* Kick off                                                           */
/* ------------------------------------------------------------------ */
requestAnimationFrame(render);
