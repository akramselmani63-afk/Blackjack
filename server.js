const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // The Android build is served from a Capacitor origin, so it needs
  // cross-origin access to the Node.js game server.
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(express.static(path.join(__dirname, 'public')));

// ============ GAME STATE ============
const rooms = new Map();          // roomCode -> Room
const queue = [];                 // sockets waiting for quick match
const DISCONNECT_TIMEOUT = 30000; // 30s to reconnect

// ============ DECK & TRUMP LOGIC ============
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r });
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// Trump card definitions
const TRUMP_TEMPLATES = [
  // Value cards
  { id: 'v4',  cat: 'value',       name: 'Summon 4',  desc: 'Add a 4 to your hand if not in play.' },
  { id: 'v7',  cat: 'value',       name: 'Summon 7',  desc: 'Add a 7 to your hand if not in play.' },
  { id: 'v9',  cat: 'value',       name: 'Summon 9',  desc: 'Add a 9 to your hand if not in play.' },
  // Disruption
  { id: 'dDraw', cat: 'disruption', name: 'Forced Draw', desc: 'Force opponent to draw one card.' },
  { id: 'dFreeze', cat: 'disruption', name: 'Freeze', desc: 'Opponent cannot hit next turn.' },
  { id: 'dDiscard', cat: 'disruption', name: 'Discard', desc: 'Opponent discards their highest card.' },
  // Bet modifiers
  { id: 'bRaise', cat: 'bet', name: 'Raise Stakes', desc: 'Losing this round costs +1 extra strike.' },
  // Reversal
  { id: 'rPush', cat: 'reversal', name: 'Push Over', desc: 'Add 3 to opponent total (may bust them).' },
  { id: 'rCounter', cat: 'reversal', name: 'Counter', desc: 'Negate the last trump used against you.' },
];

function drawTrumpPool() {
  const pool = [];
  const shuffled = [...TRUMP_TEMPLATES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 6; i++) pool.push({ ...shuffled[i % shuffled.length], uid: Math.random().toString(36).slice(2, 9) });
  return pool;
}

// ============ ROOM CLASS ============
class Room {
  constructor(code, isPrivate) {
    this.code = code;
    this.isPrivate = isPrivate;
    this.players = new Map();     // socketId -> { socket, name, hand, trumps, strikes, stood, frozen }
    this.deck = createDeck();
    this.trumpPool = [];
    this.phase = 1;               // 1, 2, 3
    this.phaseStakes = [0, 1, 2, 3]; // strikes lost per phase
    this.currentTurn = null;      // socketId
    this.roundActive = false;
    this.extraStake = 0;          // from Raise Stakes
    this.lastTrumpUsed = null;    // for Counter
    this.roundLog = [];
    this.started = false;
    this.disconnectTimers = new Map();
  }

  addPlayer(socket, name) {
    this.players.set(socket.id, {
      socket, name,
      hand: [],
      trumps: [],
      strikes: 0,
      stood: false,
      frozen: false,
      ready: false,
    });
    socket.join(this.code);
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  opponentOf(socketId) {
    for (const [id] of this.players) if (id !== socketId) return id;
    return null;
  }

  startMatch() {
    if (this.players.size !== 2) return;
    this.deck = createDeck();
    this.trumpPool = drawTrumpPool();
    // Deal 6 trump cards to each
    const ids = [...this.players.keys()];
    this.players.get(ids[0]).trumps = this.trumpPool.slice(0, 6).map(t => ({ ...t }));
    this.players.get(ids[1]).trumps = this.trumpPool.slice(0, 6).map(t => ({ ...t }));
    this.phase = 1;
    this.players.get(ids[0]).strikes = 0;
    this.players.get(ids[1]).strikes = 0;
    this.started = true;
    this.startRound();
  }

  startRound() {
    const ids = [...this.players.keys()];
    for (const id of ids) {
      const p = this.players.get(id);
      p.hand = [this.deck.pop(), this.deck.pop()];
      p.stood = false;
      p.frozen = false;
    }
    this.currentTurn = ids[0];
    this.roundActive = true;
    this.extraStake = 0;
    this.lastTrumpUsed = null;
    this.roundLog = [`— Phase ${this.phase} begins —`];
    this.broadcastState();
  }

  broadcastState() {
    for (const [id, p] of this.players) {
      const oppId = this.opponentOf(id);
      const opp = oppId ? this.players.get(oppId) : null;
      const state = {
        roomCode: this.code,
        phase: this.phase,
        roundActive: this.roundActive,
        currentTurn: this.currentTurn,
        myHand: p.hand,
        myValue: handValue(p.hand),
        myTrumps: p.trumps,
        myStrikes: p.strikes,
        myStood: p.stood,
        myFrozen: p.frozen,
        oppStood: opp ? opp.stood : false,
        oppStrikes: opp ? opp.strikes : 0,
        oppFrozen: opp ? opp.frozen : false,
        extraStake: this.extraStake,
        roundLog: this.roundLog,
        playerCount: this.players.size,
      };
      p.socket.emit('state', state);
    }
  }

  handleHit(socketId) {
    if (!this.roundActive || this.currentTurn !== socketId) return;
    const p = this.players.get(socketId);
    if (p.frozen) {
      p.frozen = false;
      this.roundLog.push(`${p.name} is frozen and passes.`);
      this.advanceTurn();
      return;
    }
    const card = this.deck.pop();
    if (!card) return;
    p.hand.push(card);
    this.roundLog.push(`${p.name} draws a card.`);
    const val = handValue(p.hand);
    if (val > 21) {
      this.roundLog.push(`${p.name} busts at ${val}!`);
      this.resolveRound(this.opponentOf(socketId));
      return;
    }
    this.advanceTurn();
  }

  handleStand(socketId) {
    if (!this.roundActive || this.currentTurn !== socketId) return;
    const p = this.players.get(socketId);
    p.stood = true;
    this.roundLog.push(`${p.name} stands at ${handValue(p.hand)}.`);
    this.advanceTurn();
  }

  handleTrump(socketId, trumpUid, targetArg) {
    if (!this.roundActive) return;
    const p = this.players.get(socketId);
    const idx = p.trumps.findIndex(t => t.uid === trumpUid);
    if (idx === -1) return;
    const trump = p.trumps[idx];
    const oppId = this.opponentOf(socketId);
    const opp = this.players.get(oppId);

    // Execute effect
    let success = true;
    switch (trump.cat) {
      case 'value': {
        const num = parseInt(trump.id.slice(1));
        // Check if number already in play (either hand)
        const inPlay = [...p.hand, ...opp.hand].some(c => parseInt(c.rank) === num);
        if (inPlay) { success = false; break; }
        p.hand.push({ suit: '★', rank: String(num) });
        this.roundLog.push(`${p.name} summons a ${num}!`);
        if (handValue(p.hand) > 21) {
          this.roundLog.push(`${p.name} busts at ${handValue(p.hand)}!`);
          this.resolveRound(oppId);
          return;
        }
        break;
      }
      case 'disruption':
        if (trump.id === 'dDraw') {
          opp.hand.push(this.deck.pop());
          this.roundLog.push(`${p.name} forces ${opp.name} to draw!`);
          if (handValue(opp.hand) > 21) {
            this.roundLog.push(`${opp.name} busts at ${handValue(opp.hand)}!`);
            this.resolveRound(socketId);
            return;
          }
        } else if (trump.id === 'dFreeze') {
          opp.frozen = true;
          this.roundLog.push(`${p.name} freezes ${opp.name}!`);
        } else if (trump.id === 'dDiscard') {
          // Remove highest value card
          let maxIdx = 0;
          for (let i = 1; i < opp.hand.length; i++) {
            if (cardValue(opp.hand[i]) > cardValue(opp.hand[maxIdx])) maxIdx = i;
          }
          opp.hand.splice(maxIdx, 1);
          this.roundLog.push(`${p.name} discards ${opp.name}'s highest card!`);
        }
        break;
      case 'bet':
        this.extraStake += 1;
        this.roundLog.push(`${p.name} raises the stakes! (+1 strike penalty)`);
        break;
      case 'reversal':
        if (trump.id === 'rPush') {
          // Add a synthetic 3 to opponent's hand
          opp.hand.push({ suit: '✦', rank: '3' });
          this.roundLog.push(`${p.name} pushes +3 onto ${opp.name}!`);
          if (handValue(opp.hand) > 21) {
            this.roundLog.push(`${opp.name} busts at ${handValue(opp.hand)}!`);
            this.resolveRound(socketId);
            return;
          }
        } else if (trump.id === 'rCounter') {
          if (this.lastTrumpUsed && this.lastTrumpUsed.userId !== socketId) {
            // Undo last trump (simplified: just log)
            this.roundLog.push(`${p.name} counters the last trump!`);
          } else {
            success = false;
          }
        }
        break;
    }

    if (success) {
      p.trumps.splice(idx, 1);
      this.lastTrumpUsed = { userId: socketId, trump };
    }
    this.broadcastState();
  }

  advanceTurn() {
    const ids = [...this.players.keys()];
    const otherId = this.opponentOf(this.currentTurn);
    const other = this.players.get(otherId);
    const me = this.players.get(this.currentTurn);

    // If both stood, resolve
    if (me.stood && other.stood) {
      const myVal = handValue(me.hand);
      const oppVal = handValue(other.hand);
      if (myVal > oppVal) this.resolveRound(this.currentTurn);
      else if (oppVal > myVal) this.resolveRound(otherId);
      else {
        this.roundLog.push(`Push! Both at ${myVal}.`);
        this.broadcastState();
        setTimeout(() => this.startRound(), 2500);
      }
      return;
    }

    // Skip if other already stood
    if (other.stood) {
      this.currentTurn = this.currentTurn; // keep turn
    } else {
      this.currentTurn = otherId;
    }
    this.broadcastState();
  }

  resolveRound(winnerId) {
    this.roundActive = false;
    const loserId = this.opponentOf(winnerId);
    const loser = this.players.get(loserId);
    const penalty = this.phaseStakes[this.phase] + this.extraStake;
    loser.strikes += penalty;
    this.roundLog.push(`${this.players.get(winnerId).name} wins! ${loser.name} takes ${penalty} strike(s).`);
    this.broadcastState();

    // Check elimination
    if (loser.strikes >= 3) {
      this.roundLog.push(`${loser.name} is ELIMINATED!`);
      io.to(this.code).emit('matchEnd', { winnerId });
      setTimeout(() => {
        this.started = false;
        io.to(this.code).emit('lobby');
      }, 4000);
      return;
    }

    // Next phase
    if (this.phase < 3) this.phase++;
    setTimeout(() => this.startRound(), 3500);
  }
}

// ============ SOCKET HANDLERS ============
io.on('connection', (socket) => {
  let playerName = 'Stranger';
  let currentRoom = null;

  socket.on('setName', (name) => {
    playerName = (name || 'Stranger').slice(0, 16);
  });

  socket.on('createRoom', () => {
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    const room = new Room(code, true);
    room.addPlayer(socket, playerName);
    rooms.set(code, room);
    currentRoom = room;
    socket.emit('roomCreated', { code });
    room.broadcastState();
  });

  socket.on('joinRoom', (code) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit('error', 'Room not found');
    if (room.players.size >= 2) return socket.emit('error', 'Room full');
    room.addPlayer(socket, playerName);
    currentRoom = room;
    socket.emit('roomJoined', { code });
    room.broadcastState();
    if (room.players.size === 2 && !room.started) {
      room.startMatch();
    }
  });

  socket.on('quickMatch', () => {
    if (queue.length > 0) {
      const other = queue.shift();
      if (other.disconnected) return;
      const code = 'QM-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const room = new Room(code, false);
      room.addPlayer(other, other.playerName || 'Stranger');
      room.addPlayer(socket, playerName);
      rooms.set(code, room);
      currentRoom = room;
      other.currentRoom = room;
      other.emit('roomJoined', { code });
      socket.emit('roomJoined', { code });
      room.startMatch();
    } else {
      socket.playerName = playerName;
      socket.currentRoom = null;
      queue.push(socket);
      socket.emit('queued');
    }
  });

  socket.on('cancelQueue', () => {
    const idx = queue.indexOf(socket);
    if (idx !== -1) queue.splice(idx, 1);
  });

  socket.on('hit', () => currentRoom?.handleHit(socket.id));
  socket.on('stand', () => currentRoom?.handleStand(socket.id));
  socket.on('trump', (uid, arg) => currentRoom?.handleTrump(socket.id, uid, arg));

  socket.on('disconnect', () => {
    const idx = queue.indexOf(socket);
    if (idx !== -1) queue.splice(idx, 1);
    if (currentRoom) {
      const timer = setTimeout(() => {
        if (currentRoom && currentRoom.players.has(socket.id)) {
          currentRoom.roundLog.push(`${playerName} disconnected — forfeit.`);
          const oppId = currentRoom.opponentOf(socket.id);
          if (oppId) currentRoom.resolveRound(oppId);
          currentRoom.removePlayer(socket.id);
        }
      }, DISCONNECT_TIMEOUT);
      currentRoom.disconnectTimers.set(socket.id, timer);
      io.to(currentRoom.code).emit('playerDisconnected', { id: socket.id });
    }
  });

  socket.on('reconnect-room', (code) => {
    const room = rooms.get(code);
    if (!room) return;
    // Re-associate (simplified: creates new player slot — real app would persist)
  });
});

// ============ START ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎴 "21" running at http://localhost:${PORT}`);
});