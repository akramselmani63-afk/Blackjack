const configuredServerUrl = (
  localStorage.getItem('game21ServerUrl') ||
  window.GAME_SERVER_URL ||
  ''
).trim().replace(/\/+$/, '');
const runningFromWebServer = /^https?:$/.test(window.location.protocol);
const socket = io(configuredServerUrl || undefined, { autoConnect: false });
let myId = null;
let currentState = null;
let myName = localStorage.getItem('name21') || '';

const serverUrlInput = document.getElementById('serverUrlInput');
const connectionStatus = document.getElementById('connectionStatus');
serverUrlInput.value = configuredServerUrl || (runningFromWebServer ? window.location.origin : '');

function setConnectionStatus(message, connected = false) {
  connectionStatus.textContent = message;
  connectionStatus.classList.toggle('connected', connected);
}

function connectServer() {
  const url = serverUrlInput.value.trim().replace(/\/+$/, '');
  if (!url) {
    setConnectionStatus('Enter the URL of the running Node.js server.');
    return;
  }
  localStorage.setItem('game21ServerUrl', url);
  window.location.reload();
}

socket.on('connect', () => {
  myId = socket.id;
  setConnectionStatus('Connected', true);
  socket.emit('setName', myName);
});
socket.on('disconnect', () => setConnectionStatus('Disconnected'));
socket.on('connect_error', () => setConnectionStatus('Could not reach server'));

// Init
document.getElementById('nameInput').value = myName;
document.getElementById('nameInput').addEventListener('input', (e) => {
  myName = e.target.value;
  localStorage.setItem('name21', myName);
  socket.emit('setName', myName);
});
if (configuredServerUrl || runningFromWebServer) {
  socket.connect();
} else {
  setConnectionStatus('Set a server URL to play on Android.');
}

// Lang init
document.getElementById('lang-en').classList.toggle('active', currentLang === 'en');
document.getElementById('lang-ar').classList.toggle('active', currentLang === 'ar');
const origSetLang = setLang;
setLang = function(lang) {
  origSetLang(lang);
  document.getElementById('lang-en').classList.toggle('active', lang === 'en');
  document.getElementById('lang-ar').classList.toggle('active', lang === 'ar');
};
renderAll();

// ============ LOBBY ============
function quickMatch() {
  socket.emit('quickMatch');
  document.getElementById('queueStatus').classList.remove('hidden');
}
function cancelQueue() {
  socket.emit('cancelQueue');
  document.getElementById('queueStatus').classList.add('hidden');
}
function createRoom() {
  socket.emit('createRoom');
}
function joinRoom() {
  const code = document.getElementById('roomCodeInput').value.trim();
  if (!code) return;
  socket.emit('joinRoom', code);
}
function copyCode() {
  const code = document.getElementById('roomCodeDisplay').textContent;
  navigator.clipboard.writeText(code);
  const btn = document.getElementById('copyBtn');
  btn.textContent = t('copied');
  setTimeout(() => btn.textContent = t('copy'), 1500);
}

socket.on('queued', () => {
  document.getElementById('queueStatus').classList.remove('hidden');
});
socket.on('roomCreated', ({ code }) => {
  document.getElementById('roomCodeDisplay').textContent = code;
  document.getElementById('roomCreatedBox').classList.remove('hidden');
});
socket.on('roomJoined', ({ code }) => {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
});
socket.on('error', (msg) => {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
});

// ============ GAME STATE ============
socket.on('state', (state) => {
  currentState = state;
  renderGame(state);
});

function renderGame(s) {
  // Phase
  const phaseNames = { 1: 'I', 2: 'II', 3: 'III' };
  document.getElementById('phaseNum').textContent = phaseNames[s.phase] || s.phase;
  document.getElementById('extraStake').textContent = s.extraStake;

  // My hand
  const myHandEl = document.getElementById('myHand');
  myHandEl.innerHTML = '';
  s.myHand.forEach(c => myHandEl.appendChild(renderCard(c)));
  const myValEl = document.getElementById('myValue');
  myValEl.textContent = s.myValue;
  myValEl.className = 'value-display' + (s.myValue > 21 ? ' bust' : s.myValue === 21 ? ' blackjack' : '');

  // My status
  document.getElementById('myStrikes').textContent = s.myStrikes;
  document.getElementById('myStoodTag').classList.toggle('hidden', !s.myStood);
  document.getElementById('myFrozenTag').classList.toggle('hidden', !s.myFrozen);

  // Opponent hand (hidden)
  const oppHandEl = document.getElementById('oppHand');
  oppHandEl.innerHTML = '';
  const oppCardCount = Math.max(s.myHand.length, 2); // approximate
  for (let i = 0; i < 2; i++) {
    const back = document.createElement('div');
    back.className = 'card-back';
    oppHandEl.appendChild(back);
  }
  document.getElementById('oppStrikes').textContent = s.oppStrikes;
  document.getElementById('oppStoodTag').classList.toggle('hidden', !s.oppStood);
  document.getElementById('oppFrozenTag').classList.toggle('hidden', !s.oppFrozen);

  // Active indicator
  const isMyTurn = s.currentTurn === myId && s.roundActive;
  document.getElementById('myArea').classList.toggle('active', isMyTurn);
  document.getElementById('oppArea').classList.toggle('active', s.currentTurn !== myId && s.roundActive);

  // Controls
  const canAct = isMyTurn && !s.myStood;
  document.getElementById('hitBtn').disabled = !canAct;
  document.getElementById('standBtn').disabled = !canAct;
  document.getElementById('trumpToggle').disabled = !s.roundActive;

  // Trump hand
  const trumpEl = document.getElementById('trumpHand');
  trumpEl.innerHTML = '';
  if (s.myTrumps.length === 0) {
    trumpEl.innerHTML = `<div style="color:var(--text-dim); font-style:italic;" data-i18n="noTrumps">${t('noTrumps')}</div>`;
  } else {
    s.myTrumps.forEach(tr => {
      const el = document.createElement('div');
      el.className = 'trump-mini';
      el.innerHTML = `
        <div class="tname">${tr.name}</div>
        <div class="tdesc">${tr.desc}</div>
        <span class="tcat">${t('categories.' + tr.cat)}</span>
      `;
      el.onclick = () => playTrump(tr.uid);
      trumpEl.appendChild(el);
    });
  }

  // Log
  const logEl = document.getElementById('log');
  logEl.innerHTML = s.roundLog.map(e => `<div class="entry">${e}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

function renderCard(card) {
  const el = document.createElement('div');
  const isRed = card.suit === '♥' || card.suit === '♦';
  const isSpecial = card.suit === '★' || card.suit === '✦';
  el.className = 'card' + (isRed ? ' red' : '') + (isSpecial ? ' trump-card' : '');
  el.innerHTML = `
    <div class="top">${card.rank}<br>${card.suit}</div>
    <div class="center">${card.suit}</div>
    <div class="bottom">${card.rank}<br>${card.suit}</div>
  `;
  return el;
}

function doHit() { socket.emit('hit'); }
function doStand() { socket.emit('stand'); }
function toggleTrumps() {
  document.getElementById('trumpPanel').classList.toggle('hidden');
}
function playTrump(uid) {
  socket.emit('trump', uid);
  document.getElementById('trumpPanel').classList.add('hidden');
}

// ============ MATCH END ============
socket.on('matchEnd', ({ winnerId }) => {
  const iWon = winnerId === myId;
  document.getElementById('modalTitle').textContent = t('matchEnd');
  document.getElementById('modalText').textContent = iWon ? t('youWin') : t('youLose');
  document.getElementById('modal').classList.remove('hidden');
});
socket.on('lobby', () => {
  // Could return to lobby; for now keep modal
});

socket.on('playerDisconnected', () => {
  // Could show indicator; simplified
});