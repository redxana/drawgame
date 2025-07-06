const express = require('express'); 
const http = require('http');
const cors = require('cors');
const app = express();

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: false
};

app.use(cors(corsOptions));


app.get('/', (req, res) => {
  res.send('Server is running!');
});

const server = http.createServer(app);

const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false 
  }
});

const rooms = {};
const THEMES = [
        { name: 'Animal'},

        { name: 'Anime' },
  
        { name: 'Sports' },
  
        { name: 'superhero'  },

        { name: 'food'  },

        { name: 'meme'  },

        { name: 'country'  },

        { name: 'FREE DRAW', free: true }

        ];

io.on('connection', (socket) => {
  socket.on('createRoom', ({ username }, callback) => {
    if (!username) {
      callback({ error: 'Username required' });
      return;
    }
    console.log('createRoom username:', username); // Add this line
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomCode] = { players: [{ name: username, ready: false, id: socket.id }], leader: socket.id, started: false };
    socket.join(roomCode);
    callback({ roomCode });
    io.to(roomCode).emit('updatePlayers', rooms[roomCode].players, rooms[roomCode].leader, rooms[roomCode].started);
    console.log('Emitting updatePlayers:', JSON.stringify(rooms[roomCode].players));
  });

  socket.on('joinRoom', ({ username, roomCode }, callback) => {
    if (!username) {
      callback({ error: 'Username required' });
      return;
    }
    if (!rooms[roomCode]) {
      callback({ error: 'Room not found' });
      return;
    }
    // Prevent duplicate players with the same socket.id
    if (!rooms[roomCode].players.find(p => p.id === socket.id)) {
      rooms[roomCode].players.push({ name: username, ready: false, id: socket.id });
    }
    socket.join(roomCode);
    callback({ success: true });
    io.to(roomCode).emit('updatePlayers', rooms[roomCode].players, rooms[roomCode].leader, rooms[roomCode].started);
    console.log('Emitting updatePlayers:', JSON.stringify(rooms[roomCode].players));
  });

  socket.on('setReady', ({ roomCode, ready }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.ready = ready;
    io.to(roomCode).emit('updatePlayers', room.players, room.leader, room.started);
  });

  socket.on('startGame', (roomCode) => {  
    const room = rooms[roomCode];
    if (!room || room.leader !== socket.id) return;
    console.log(`Starting round ${room.currentRound + 1} for room ${roomCode}`);
    room.started = true;
    room.currentRound = 0;
    room.drawings = {};
    startNextRound(roomCode);
  });

  function startNextRound(roomCode) {
    

  const room = rooms[roomCode];
  if (!room) return;

  room.nextRoundReady = []; // Clear readiness

  io.to(roomCode).emit('nextRoundReadyUpdate', {
    ready: 0,
    total: room.players.length
  });

  let theme = null;
  if (room.currentRound < THEMES.length) {
    theme = THEMES[room.currentRound].name;
  }

  const time = 180; // seconds
  const startTimestamp = Date.now();
  room.roundStartTimestamp = startTimestamp;
  room.roundTime = time;
  room.drawings = {}; // Reset drawings

  const round = room.currentRound + 1;
  const totalRounds = THEMES.length;
  const item = null;

  if (room.roundTimeout) clearTimeout(room.roundTimeout);
  room.roundTimeout = setTimeout(() => {
    for (const player of room.players) {
      if (!room.drawings[player.id]) {
        room.drawings[player.id] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAMAAACahl6sAAAAA1BMVEUAAACnej3aAAAASElEQVR4nO3BMQEAAAgDoJvc6F9hAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwG4wAAQ2r+JwAAAAASUVORK5CYII=";
      }
    }
    io.to(roomCode).emit('showDrawings', room.drawings);
  }, time * 1000);

  io.to(roomCode).emit('startRound', {
    round,
    totalRounds,
    theme,
    item,
    time,
    startTimestamp,
    serverTime: Date.now()
  });
}



  socket.on('submitDrawing', ({ roomCode, round, drawing }) => {
    console.log(`Received drawing from ${socket.id} for round ${round}`);

    const room = rooms[roomCode];
    if (!room) return;
    if (!room.drawings) room.drawings = {};
    room.drawings[socket.id] = drawing;
    // When all drawings are in, move to rating
    if (Object.keys(room.drawings).length === room.players.length) {
      if (room.roundTimeout) clearTimeout(room.roundTimeout);
      io.to(roomCode).emit('showDrawings', room.drawings);
    }
  });

  // Provide player names for a room
  socket.on('getPlayerNames', ({ roomCode }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback([]);
    callback(room.players.map(p => ({ id: p.id, name: p.name })));
  });

  // Collect ratings
  socket.on('submitRating', ({ roomCode, targetId, rating }) => {
    console.log(`Received drawing from ${socket.id} for round ${round}`);

    const room = rooms[roomCode];
    if (!room) return;
    if (!room.ratings) room.ratings = {};
    if (!room.ratings[targetId]) room.ratings[targetId] = [];
    if (socket.id === targetId) return;
    // Remove previous rating from this user if exists
    room.ratings[targetId] = room.ratings[targetId].filter(r => r.from !== socket.id);
    // Clamp rating
    if (typeof rating !== 'number' || isNaN(rating)) rating = 0;
    if (rating < 0) rating = 0;
    if (rating > 10) rating = 10;
    room.ratings[targetId].push({ from: socket.id, value: rating });

    // Check if all ratings are in for all drawings
    const totalPlayers = room.players.length;
    let allRated = true;
    for (const pid of Object.keys(room.drawings)) {
      if (
        !room.ratings[pid] ||
        room.ratings[pid].length < totalPlayers - 1
      ) {
        allRated = false;
        break;
      }
    }
    if (allRated) {
      // Calculate scores
      const scores = {};
      for (const pid of Object.keys(room.drawings)) {
        const ratings = room.ratings[pid] || [];
        const avg = ratings.length
          ? (ratings.reduce((sum, r) => sum + r.value, 0) / ratings.length)
          : 0;
        scores[pid] = { 
          average: Math.round(avg * 100) / 100, 
          ratings 
        };
      }
      io.to(roomCode).emit('showScores', { drawings: room.drawings, scores });
      room.waitingForNext = true;
      room.nextRoundReady = []; // <-- Add this line
    }
  });

    // Collect votes for best drawing if there are >2 players
  socket.on('submitVote', ({ roomCode, targetId }) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (!room.votes) room.votes = {};
  if (targetId === socket.id) return; // Prevent self vote

  room.votes[socket.id] = targetId;

  if (Object.keys(room.votes).length === room.players.length) {
    const voteCounts = {};
    Object.values(room.votes).forEach(votedId => {
      voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
    });

    let maxVotes = 0;
    let winners = [];
    for (const [id, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        winners = [id];
      } else if (count === maxVotes) {
        winners.push(id);
      }
    }

    if (room.players.length > 2) {
      // Only for >2 players show winners’ drawings without scores
      const winnerDrawings = {};
      winners.forEach(winnerId => {
        winnerDrawings[winnerId] = room.drawings[winnerId];
      });

      io.to(roomCode).emit('showRoundWinners', {
        title: "Drawing(s) of the round:",
        drawings: winnerDrawings,
        winners,
        voteCounts
      });
    } else {
      // For <=2 players fallback to old behaviour (show all drawings with scores if needed)
      io.to(roomCode).emit('voteResults', { winners, voteCounts });
    }

    room.waitingForNext = true;
    room.nextRoundReady = [];
    room.votes = {};
  }
});




  socket.on('unreadyDrawing', ({ roomCode, round }) => {
    const room = rooms[roomCode];
    if (!room || !room.drawings) return;
    // Remove the drawing for this player
    delete room.drawings[socket.id];
    // Also remove any ratings for this drawing (optional, for safety)
    if (room.ratings) {
      delete room.ratings[socket.id];
    }
  });

  // Handle next round readiness
  socket.on('nextRoundReady', ({ roomCode, ready }) => {
    const room = rooms[roomCode];
    if (!room || !room.waitingForNext) return;
    if (!room.nextRoundReady) room.nextRoundReady = [];
    if (ready) {
      if (!room.nextRoundReady.includes(socket.id)) room.nextRoundReady.push(socket.id);
    } else {
      room.nextRoundReady = room.nextRoundReady.filter(id => id !== socket.id);
    }
    io.to(roomCode).emit('nextRoundReadyUpdate', {
      ready: room.nextRoundReady.length,
      total: room.players.length
    });
    if (room.nextRoundReady.length === room.players.length) {
      room.waitingForNext = false;
      room.currentRound++;
      if (room.currentRound < THEMES.length + 1) {
        room.drawings = {};
        room.ratings = {};
        startNextRound(roomCode);
      } else {
        io.to(roomCode).emit('gameOver');
      }
    }
  });

  socket.on('leaderNextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.leader !== socket.id || !room.waitingForNext) return;
    room.waitingForNext = false;
    room.currentRound++;
    if (room.currentRound < THEMES.length + 1) {
      room.drawings = {};
      room.ratings = {};
      startNextRound(roomCode);
    } else {
      io.to(roomCode).emit('gameOver');
    }
  });

  




  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        // If leader left, assign new leader
        if (room.leader === socket.id && room.players.length > 0) {
          room.leader = room.players[0].id;
        }
        io.to(roomCode).emit('updatePlayers', room.players, room.leader, room.started);
        if (room.players.length === 0) delete rooms[roomCode];
      }
    }
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});