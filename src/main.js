import './style.css';
import { io } from 'socket.io-client';
import CONFIG from './config.js';
import { WORD_LENGTH, MAX_ROWS, evaluate, betterStatus, solvePoints, shuffle } from './game.js';
import { ANSWERS, DICT } from './words.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  title: $('#title'),
  subtitle: $('#subtitle'),
  board: $('#board'),
  keyboard: $('#keyboard'),
  toast: $('#toast'),
  hint: $('#hint'),
  pill: $('#pill'),
  pillText: $('#pill-text'),
  panelBtn: $('#panel-btn'),
  panel: $('#panel'),
  username: $('#username'),
  connect: $('#btn-connect'),
  disconnect: $('#btn-disconnect'),
  skip: $('#btn-skip'),
  reset: $('#btn-reset'),
  lb: $('#lb-list'),
  result: $('#result'),
  resultTitle: $('#result-title'),
  resultWord: $('#result-word'),
  resultSub: $('#result-sub'),
  round: $('#round'),
};

// ---------- Storage (aman kalau localStorage diblokir) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* abaikan */
    }
  },
};

// ---------- State ----------
const state = {
  roundNo: 0,
  answer: '',
  rows: [], // { word, result, id, name }
  current: '', // ketikan host
  over: false,
  hintPos: new Set(),
  greenSeen: new Set(),
  lastUser: null,
  keyStatus: {},
};
let bag = [];
let scores = store.get('tk:scores', {});
const queue = [];
let pumping = false;
const timers = { result: null, next: null, toast: null, keys: null };

// ---------- Papan ----------
function buildBoard() {
  el.board.replaceChildren();
  for (let r = 0; r < MAX_ROWS; r++) {
    const row = document.createElement('div');
    row.className = 'row-tiles';
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      row.appendChild(tile);
    }
    el.board.appendChild(row);
  }
}

function renderBoard(animateRow = -1) {
  for (let r = 0; r < MAX_ROWS; r++) {
    const rowEl = el.board.children[r];
    const row = state.rows[r];
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = rowEl.children[c];
      tile.className = 'tile';
      tile.style.removeProperty('--d');
      if (row) {
        tile.textContent = row.word[c];
        tile.classList.add(row.result[c]);
        if (r === animateRow) {
          tile.classList.add('flip');
          tile.style.setProperty('--d', `${c * 140}ms`);
        }
      } else if (r === state.rows.length && state.current[c]) {
        tile.textContent = state.current[c];
        tile.classList.add('typing');
      } else {
        tile.textContent = '';
      }
    }
  }
}

function renderHint() {
  const letters = [];
  for (let i = 0; i < WORD_LENGTH; i++) letters.push(state.hintPos.has(i) ? state.answer[i] : '_');
  el.hint.textContent = letters.join(' ');
}

// ---------- Keyboard layar ----------
const KEY_ROWS = [
  'QWERTYUIOP'.split(''),
  'ASDFGHJKL'.split(''),
  ['ENTER', ...'ZXCVBNM'.split(''), '⌫'],
];
const keyEls = {};

function buildKeyboard() {
  el.keyboard.replaceChildren();
  for (const keys of KEY_ROWS) {
    const row = document.createElement('div');
    row.className = 'krow';
    for (const k of keys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = k.length > 1 || k === '⌫' ? 'key wide' : 'key';
      btn.textContent = k;
      btn.addEventListener('click', () => hostKey(k === '⌫' ? 'BACKSPACE' : k));
      if (/^[A-Z]$/.test(k)) keyEls[k] = btn;
      row.appendChild(btn);
    }
    el.keyboard.appendChild(row);
  }
}

function renderKeyboard() {
  for (const [letter, btn] of Object.entries(keyEls)) {
    btn.className = 'key';
    const s = state.keyStatus[letter];
    if (s) btn.classList.add(s);
  }
}

function hostKey(k) {
  if (state.over) return;
  if (k === 'ENTER') {
    if (state.current.length === WORD_LENGTH) {
      const word = state.current;
      state.current = '';
      enqueue({ id: 'host', name: 'Host', word });
    }
  } else if (k === 'BACKSPACE') {
    state.current = state.current.slice(0, -1);
  } else if (/^[A-Z]$/.test(k) && state.current.length < WORD_LENGTH) {
    state.current += k;
  }
  renderBoard();
}

window.addEventListener('keydown', (e) => {
  if (e.target?.tagName === 'INPUT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter') hostKey('ENTER');
  else if (e.key === 'Backspace') hostKey('BACKSPACE');
  else if (/^[a-zA-Z]$/.test(e.key)) hostKey(e.key.toUpperCase());
});

// ---------- Toast ----------
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(timers.toast);
  timers.toast = setTimeout(() => el.toast.classList.remove('show'), CONFIG.TOAST_MS);
}

// ---------- Skor ----------
function renderLeaderboard() {
  const top = Object.values(scores)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const items = top.map((s, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = `${i + 1}. ${s.name}`; // textContent: nickname TikTok tidak dieksekusi sebagai HTML
    const pts = document.createElement('span');
    pts.className = 'lb-pts';
    pts.textContent = String(s.score);
    li.append(name, pts);
    return li;
  });
  el.lb.replaceChildren(...items);
}

function addScore(id, name, pts) {
  if (!pts || id === 'host') return;
  scores[id] = { name: name || id, score: (scores[id]?.score || 0) + pts };
  store.set('tk:scores', scores);
  renderLeaderboard();
}

// ---------- Ronde ----------
function pickAnswer() {
  if (bag.length === 0) bag = shuffle(ANSWERS);
  return bag.pop();
}

function newRound() {
  clearTimeout(timers.result);
  clearTimeout(timers.next);
  clearTimeout(timers.keys);
  el.result.classList.remove('show');
  queue.length = 0;
  state.roundNo += 1;
  state.answer = pickAnswer();
  state.rows = [];
  state.current = '';
  state.over = false;
  state.hintPos = new Set();
  state.greenSeen = new Set();
  state.lastUser = null;
  state.keyStatus = {};
  el.round.textContent = `Ronde ${state.roundNo}`;
  renderBoard();
  renderHint();
  renderKeyboard();
}

function endRound(solvedBy) {
  state.over = true;
  queue.length = 0;
  timers.result = setTimeout(() => {
    el.resultTitle.textContent = solvedBy ? `🎉 @${solvedBy.id} menebak!` : '⏱ Kesempatan habis';
    el.resultWord.textContent = state.answer;
    el.resultSub.textContent = 'Ronde berikutnya sebentar lagi…';
    el.result.classList.add('show');
  }, 900);
  timers.next = setTimeout(newRound, CONFIG.NEXT_ROUND_DELAY_MS);
}

// ---------- Tebakan ----------
function enqueue(g) {
  const word = String(g?.word ?? '').toUpperCase();
  if (!/^[A-Z]{5}$/.test(word)) return;
  if (state.over || queue.length >= 30) return;
  queue.push({ id: String(g.id ?? 'anon'), name: String(g.name ?? g.id ?? 'anon'), word });
  pump();
}

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    if (state.over || queue.length === 0) {
      pumping = false;
      return;
    }
    const accepted = applyGuess(queue.shift());
    setTimeout(step, accepted ? CONFIG.GUESS_INTERVAL_MS : 0);
  };
  step();
}

function applyGuess(g) {
  if (state.over) return false;
  if (!CONFIG.ALLOW_CONSECUTIVE_SAME_USER && g.id !== 'host' && g.id === state.lastUser) return false;
  if (state.rows.some((r) => r.word === g.word)) return false; // kata yang sama tidak memakan baris
  if (CONFIG.REQUIRE_DICTIONARY && !DICT.has(g.word)) {
    toast(`${g.word} tidak ada di kamus`);
    return false;
  }

  const result = evaluate(g.word, state.answer);
  state.rows.push({ word: g.word, result, id: g.id, name: g.name });
  state.lastUser = g.id;
  toast(`Tebakan dari @${g.id}: ${g.word}`);

  let pts = 0;
  result.forEach((s, i) => {
    if (s === 'correct' && !state.greenSeen.has(i)) {
      state.greenSeen.add(i);
      pts += CONFIG.POINTS_NEW_GREEN;
    }
  });
  const solved = g.word === state.answer;
  if (solved) {
    pts += solvePoints(state.rows.length - 1, MAX_ROWS, CONFIG.POINTS_SOLVE_BASE, CONFIG.POINTS_SOLVE_PER_ROW);
  }
  addScore(g.id, g.name, pts);

  renderBoard(state.rows.length - 1);
  // warna keyboard menyusul setelah animasi flip
  clearTimeout(timers.keys);
  timers.keys = setTimeout(() => {
    result.forEach((s, i) => {
      const ch = g.word[i];
      state.keyStatus[ch] = betterStatus(state.keyStatus[ch], s);
    });
    renderKeyboard();
  }, 800);

  if (solved || state.rows.length >= MAX_ROWS) endRound(solved ? g : null);
  return true;
}

// ---------- Gift = petunjuk ----------
function onGift(d) {
  if (state.over) return;
  const id = String(d?.id ?? 'anon');
  const label = d?.giftName || 'gift';
  const free = [];
  for (let i = 0; i < WORD_LENGTH; i++) if (!state.hintPos.has(i) && !state.greenSeen.has(i)) free.push(i);

  if ((d?.diamonds ?? 0) < CONFIG.GIFT_MIN_DIAMONDS || state.hintPos.size >= CONFIG.MAX_HINTS || free.length === 0) {
    toast(`🎁 @${id} kirim ${label} — makasih!`);
  } else {
    state.hintPos.add(free[Math.floor(Math.random() * free.length)]);
    renderHint();
    toast(`🎁 @${id} kirim ${label} — petunjuk dibuka!`);
  }
  addScore(id, d?.name, CONFIG.POINTS_GIFT);
}

// ---------- Koneksi ke server ----------
let serverUp = false;
let tt = { state: 'idle', username: '', message: '' };

function renderPill() {
  let text;
  let cls;
  if (!serverUp) {
    text = 'SERVER GAME OFFLINE';
    cls = 'off';
  } else if (tt.state === 'connected') {
    text = 'TIKTOK LIVE MENDENGARKAN…';
    cls = 'ok';
  } else if (tt.state === 'connecting') {
    text = 'MENGHUBUNGKAN KE TIKTOK…';
    cls = 'wait';
  } else if (tt.state === 'error') {
    text = `TIKTOK: ${(tt.message || 'error').slice(0, 34).toUpperCase()}`;
    cls = 'off';
  } else {
    text = 'TIKTOK BELUM TERHUBUNG';
    cls = 'off';
  }
  el.pillText.textContent = text;
  el.pill.className = `pill ${cls}`;
  el.pill.title = tt.username ? `@${tt.username}${tt.message ? ' — ' + tt.message : ''}` : '';
}

const socket = io(CONFIG.SERVER_URL);
socket.on('connect', () => {
  serverUp = true;
  renderPill();
});
socket.on('disconnect', () => {
  serverUp = false;
  renderPill();
});
socket.on('connect_error', () => {
  serverUp = false;
  renderPill();
});
socket.on('status', (s) => {
  tt = s || tt;
  if (tt.username && !el.username.value) el.username.value = tt.username;
  renderPill();
});
socket.on('guess', (g) => enqueue(g));
socket.on('gift', (d) => onGift(d));

// ---------- Panel host ----------
el.panelBtn.addEventListener('click', () => {
  el.panel.hidden = !el.panel.hidden;
});
el.pill.addEventListener('click', () => {
  el.panel.hidden = !el.panel.hidden;
});
el.connect.addEventListener('click', () => {
  const u = el.username.value.trim();
  if (!u) return;
  store.set('tk:username', u);
  socket.emit('tiktok:connect', u);
});
el.disconnect.addEventListener('click', () => socket.emit('tiktok:disconnect'));
el.skip.addEventListener('click', newRound);
el.reset.addEventListener('click', () => {
  scores = {};
  store.set('tk:scores', scores);
  renderLeaderboard();
});

// ---------- Mode demo: buka /?demo=1 untuk tes tanpa TikTok ----------
function startDemo() {
  const users = ['mamaii', 'goku', 'ndwii', 'ipah', 'stillloading', 'elysa'];
  setInterval(() => {
    const id = users[Math.floor(Math.random() * users.length)];
    enqueue({ id, name: id, word: ANSWERS[Math.floor(Math.random() * ANSWERS.length)] });
  }, 1500);
  setInterval(() => onGift({ id: 'sultan', name: 'Sultan', giftName: 'Rose', diamonds: 1 }), 20000);
}

// ---------- Init ----------
el.title.textContent = CONFIG.TITLE;
el.subtitle.textContent = CONFIG.SUBTITLE;
el.username.value = store.get('tk:username', '');
buildBoard();
buildKeyboard();
renderLeaderboard();
renderPill();
newRound();
if (new URLSearchParams(location.search).has('demo')) startDemo();

// Buat debugging di console: __tk.enqueue({ id: 'tes', name: 'Tes', word: 'BUKAN' })
window.__tk = { state, enqueue, onGift, newRound };
