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
  ov: $('#ov'),
  ovTitle: $('#ov-title'),
  ovWord: $('#ov-word'),
  ovSub: $('#ov-sub'),
  ovBar: $('#ov-bar'),
  copy: $('#copy'),
  copyText: $('#copy-text'),
  copyBar: $('#copy-bar'),
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
  phase: 'play', // 'play' = nebak, 'copy' = menunggu yang ikut benar, 'over' = ronde selesai
  solver: null,
  solverName: '',
  copiers: [],
  copied: new Set(),
  gains: {}, // poin yang didapat di ronde ini
  prevRank: {}, // peringkat sebelum ronde ini
  hintPos: new Set(),
  greenSeen: new Set(),
  lastUser: null,
  keyStatus: {},
};
let bag = [];
let scores = store.get('tk:scores', {});
const queue = [];
let pumping = false;
const timers = { result: null, next: null, toast: null, keys: null, copy: null };

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
  if (state.phase !== 'play') return;
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
function rankList() {
  return Object.entries(scores)
    .map(([id, v]) => ({ id, name: v.name, score: v.score }))
    .sort((a, b) => b.score - a.score);
}

function addScore(id, name, pts) {
  if (!pts || id === 'host') return;
  scores[id] = { name: name || id, score: (scores[id]?.score || 0) + pts };
  state.gains[id] = (state.gains[id] || 0) + pts;
  store.set('tk:scores', scores);
}

function snapshotRanks() {
  state.prevRank = {};
  rankList().forEach((r, i) => {
    state.prevRank[r.id] = i + 1;
  });
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text; // textContent: nickname TikTok tidak dieksekusi sebagai HTML
  return n;
}

function renderLeaderboard() {
  const top = rankList().slice(0, CONFIG.LEADERBOARD_SIZE);
  if (top.length === 0) {
    const li = mk('li', 'lb-empty', 'Belum ada skor');
    li.style.setProperty('--i', '0');
    el.lb.replaceChildren(li);
    return;
  }
  const items = top.map((r, i) => {
    const li = mk('li', i < 3 ? `top${i + 1}` : '');
    li.style.setProperty('--i', String(i));
    const pos = i + 1;
    const prev = state.prevRank[r.id];
    let mv = mk('span', 'lb-mv', '');
    if (prev === undefined) {
      mv = mk('span', 'lb-mv new', 'BARU');
    } else if (prev > pos) {
      mv = mk('span', 'lb-mv up', `▲${prev - pos}`);
    } else if (prev < pos) {
      mv = mk('span', 'lb-mv down', `▼${pos - prev}`);
    }
    const gain = state.gains[r.id] ? `+${state.gains[r.id]}` : '';
    li.append(mk('span', 'lb-pos', String(pos)), mk('span', 'lb-name', r.name), mv, mk('span', 'lb-gain', gain), mk('span', 'lb-pts', String(r.score)));
    return li;
  });
  el.lb.replaceChildren(...items);
}

function restartBar(bar, ms) {
  bar.style.animation = 'none';
  void bar.offsetWidth; // paksa reflow supaya animasi mulai ulang
  bar.style.animation = `drain ${ms}ms linear forwards`;
}

function showOverlay() {
  const n = state.copiers.length;
  if (state.solver) {
    el.ovTitle.textContent = `🎉 @${state.solver} menebak!`;
    el.ovSub.textContent = n > 0 ? `✅ ${n} orang ikut benar` : 'Belum ada yang ikut benar';
  } else {
    el.ovTitle.textContent = '⏱ Kesempatan habis';
    el.ovSub.textContent = 'Tidak ada yang berhasil menebak';
  }
  el.ovWord.textContent = state.answer;
  renderLeaderboard();
  restartBar(el.ovBar, CONFIG.LEADERBOARD_MS);
  el.ov.scrollTop = 0;
  el.ov.classList.add('show');
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
  clearTimeout(timers.copy);
  el.ov.classList.remove('show');
  el.copy.hidden = true;
  queue.length = 0;
  snapshotRanks();
  state.gains = {};
  state.roundNo += 1;
  state.answer = pickAnswer();
  state.rows = [];
  state.current = '';
  state.phase = 'play';
  state.solver = null;
  state.solverName = '';
  state.copiers = [];
  state.copied = new Set();
  state.hintPos = new Set();
  state.greenSeen = new Set();
  state.lastUser = null;
  state.keyStatus = {};
  el.round.textContent = `Ronde ${state.roundNo}`;
  renderBoard();
  renderHint();
  renderKeyboard();
}

const REVEAL_DELAY_MS = 900; // biar animasi baris terakhir kebaca dulu

// Ronde selesai -> tampilkan leaderboard LEADERBOARD_MS -> ronde baru
function finishRound() {
  if (state.phase === 'over') return;
  clearTimeout(timers.copy);
  state.phase = 'over';
  queue.length = 0;
  el.copy.hidden = true;
  timers.result = setTimeout(showOverlay, REVEAL_DELAY_MS);
  timers.next = setTimeout(newRound, REVEAL_DELAY_MS + CONFIG.LEADERBOARD_MS);
}

// ---------- Salin jawaban ----------
function renderCopy() {
  el.copyText.textContent = `✅ @${state.solver} BENAR! Ketik kata itu juga — ${state.copiers.length}/${CONFIG.COPY_SLOTS}`;
}

function startCopyPhase() {
  state.phase = 'copy';
  state.copied = new Set([state.solver]);
  state.copiers = [];
  for (let i = 0; i < WORD_LENGTH; i++) state.hintPos.add(i);
  renderHint();
  // tebakan salah yang masih antre sudah tidak berguna; yang sama dengan jawaban tetap dihitung
  const keep = queue.filter((q) => q.word === state.answer);
  queue.length = 0;
  queue.push(...keep);
  renderCopy();
  el.copy.hidden = false;
  restartBar(el.copyBar, CONFIG.COPY_WINDOW_MS);
  clearTimeout(timers.copy);
  timers.copy = setTimeout(finishRound, CONFIG.COPY_WINDOW_MS);
}

function applyCopy(g) {
  if (g.id === 'host' || state.copied.has(g.id)) return false;
  if (g.word !== state.answer) return false;
  state.copied.add(g.id);
  const order = state.copiers.length;
  state.copiers.push({ id: g.id, name: g.name });
  const pts = Math.max(CONFIG.POINTS_COPY_MIN, CONFIG.POINTS_COPY_BASE - order * CONFIG.POINTS_COPY_STEP);
  addScore(g.id, g.name, pts);
  toast(`✅ @${g.id} ikut benar! (${state.copiers.length}/${CONFIG.COPY_SLOTS})`);
  renderCopy();
  if (state.copiers.length >= CONFIG.COPY_SLOTS) finishRound(); // kuota penuh -> langsung lanjut
  return true;
}

// ---------- Tebakan ----------
function enqueue(g) {
  const word = String(g?.word ?? '').toUpperCase();
  if (!/^[A-Z]{5}$/.test(word)) return;
  if (state.phase === 'over' || queue.length >= 100) return;
  if (state.phase === 'copy' && word !== state.answer) return;
  queue.push({ id: String(g.id ?? 'anon'), name: String(g.name ?? g.id ?? 'anon'), word });
  pump();
}

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    if (state.phase === 'over' || queue.length === 0) {
      pumping = false;
      return;
    }
    const accepted = applyGuess(queue.shift());
    const gap = state.phase === 'copy' ? CONFIG.COPY_INTERVAL_MS : CONFIG.GUESS_INTERVAL_MS;
    setTimeout(step, accepted ? gap : 0);
  };
  step();
}

function applyGuess(g) {
  if (state.phase === 'over') return false;
  if (state.phase === 'copy') return applyCopy(g);
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

  if (solved) {
    state.solver = g.id;
    state.solverName = g.name;
    if (CONFIG.COPY_SLOTS > 0) startCopyPhase();
    else finishRound();
  } else if (state.rows.length >= MAX_ROWS) {
    finishRound();
  }
  return true;
}

// ---------- Gift = petunjuk ----------
function onGift(d) {
  const id = String(d?.id ?? 'anon');
  const label = d?.giftName || 'gift';
  const count = Math.max(1, Math.min(Number(d?.count) || 1, 50));
  addScore(id, d?.name, CONFIG.POINTS_GIFT * Math.min(count, 10));
  const tag = count > 1 ? `${count}× ${label}` : label;

  if (state.phase !== 'play') {
    toast(`🎁 @${id} kirim ${tag} — makasih!`);
    return;
  }
  let opened = 0;
  if ((d?.diamonds ?? 1) >= CONFIG.GIFT_MIN_DIAMONDS) {
    for (let k = 0; k < count; k++) {
      if (state.hintPos.size >= CONFIG.MAX_HINTS) break;
      const free = [];
      for (let i = 0; i < WORD_LENGTH; i++) if (!state.hintPos.has(i) && !state.greenSeen.has(i)) free.push(i);
      if (free.length === 0) break;
      state.hintPos.add(free[Math.floor(Math.random() * free.length)]);
      opened += 1;
    }
  }
  renderHint();
  toast(opened > 0 ? `🎁 @${id} kirim ${tag} — ${opened} petunjuk dibuka!` : `🎁 @${id} kirim ${tag} — makasih!`);
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
  state.gains = {};
  state.prevRank = {};
  store.set('tk:scores', scores);
});

// ---------- Mode demo: buka /?demo=1 untuk tes tanpa TikTok ----------
function startDemo() {
  const users = ['mamaii', 'goku', 'ndwii', 'ipah', 'stillloading', 'elysa'];
  setInterval(() => {
    const id = users[Math.floor(Math.random() * users.length)];
    enqueue({ id, name: id, word: ANSWERS[Math.floor(Math.random() * ANSWERS.length)] });
  }, 1500);
  setInterval(() => onGift({ id: 'sultan', name: 'Sultan', giftName: 'Rose', diamonds: 1, count: 1 }), 20000);
}

// ---------- Init ----------
el.title.textContent = CONFIG.TITLE;
el.subtitle.textContent = CONFIG.SUBTITLE;
el.username.value = store.get('tk:username', '');
buildBoard();
buildKeyboard();
renderPill();
newRound();
if (new URLSearchParams(location.search).has('demo')) startDemo();

// Buat debugging di console: __tk.enqueue({ id: 'tes', name: 'Tes', word: 'BUKAN' })
window.__tk = { state, enqueue, onGift, newRound };
