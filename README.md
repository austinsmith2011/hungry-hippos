# Hungry Hungry Hippos

A real-time multiplayer browser game for livening up those awkward meeting starts. Share a link, and everyone chomps!

## How to Play

1. Click **Start a Game** to create a room
2. Share the link with your team (up to 20 players)
3. Click **Start Game** when everyone's in
4. **Hold Space** (or tap on mobile) to extend your hippo's mouth and grab balls
5. Most balls wins!

## Running Locally

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploying

Designed for Render (free tier). Set the start command to `node server.js`.

## Tech Stack

- **Server**: Node.js, Express, Socket.io
- **Client**: HTML5 Canvas, Web Audio API
- **No database** — game state lives in memory
