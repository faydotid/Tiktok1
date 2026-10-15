import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import * as TLNamespace from 'tiktok-live-connector';

// ---------- Config ----------
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const AUTO_RECONNECT = process.env.AUTO_RECONNECT !== 'false';
const DEBUG = process.env.DEBUG_CHAT === 'true';
const GUESS_COOLDOWN_MS = Number(process.env.GUESS_COOLDOWN_MS) || 300;

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : null;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// ---------- tiktok-live-connector (support v1 & v2) ----------
// v1: WebcastPushConnection | v2: TikTokLiveConnection (+ WebcastEvent / ControlEvent)
const TL =
  !TLNamespace.TikTokLiveConnection && !TLNamespace.WebcastPushConnection && TLNamespace.default
    ? TLNamespace.default
    : TLNamespace;
const ConnectionClass = TL.TikTokLiveConnection ?? TL.WebcastPushConnection;
if (!ConnectionClass) {
  console.error(
    '[server] Class koneksi tidak ditemukan di tiktok-live-connector. ' +
      'Cek versi paketnya: npm ls tiktok-live-connector'
  );
  process.exit(1);
}
const EV = TL.WebcastEvent ?? {};
const CTRL = TL.ControlEvent ?? {};
const NAME = {
  chat: EV.CHAT ?? 'chat',
  gift: EV.GIFT ?? 'gift',
  streamEnd: EV.STREAM_END ?? 'streamEnd',
  connected: CTRL.CONNECTED ?? 'connected',
  disconnected: CTRL.DISCONNECTED ?? 'disconnected',
  error: CTRL.ERROR ?? 'error',
};

// ---------- Socket.io ----------
const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('tebak-kata server OK');
});

const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = allowedOrigins ? allowedOrigins.includes(origin) : LOCAL_ORIGIN.test(origin);
      cb(null, ok);
    },
  },
});

// ---------- State ----------
let conn = null;
let wantedUser = '';
let retryTimer = null;
let retries = 0;
let status = { state: 'idle', username: '', message: '' };
const lastGuessAt = new Map();

function setStatus(patch) {
  status = { ...status, ...patch };
  console.log(`[tiktok] ${status.state}${status.username ? ' @' + status.username : ''} ${status.message || ''}`);
  io.emit('status', status);
}

function who(d) {
  const u = d?.user ?? d ?? {};
  // v2/v3 pakai user.displayId, v1 pakai uniqueId
  const id = u.uniqueId ?? u.displayId ?? d?.uniqueId ?? u.secUid ?? u.id ?? 'anon';
  const name = u.nickname || d?.nickname || id;
  return { id: String(id), name: String(name) };
}

// Ambil tebakan 5 huruf dari komentar. Emoji/tanda baca di sekitar kata diabaikan,
// jadi "kapal!", "Kapal 🔥", "KAPAL." tetap kebaca. Komentar lebih dari 1 kata ditolak.
function parseGuess(raw) {
  const cleaned = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]+/g, ' ')
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1 || !/^[A-Za-z]{5}$/.test(tokens[0])) return null;
  return tokens[0].toUpperCase();
}

// Buang event ganda (msgId sama), mis. pesan riwayat yang dikirim ulang saat konek.
const seenMsg = new Set();
function isDupMsg(d) {
  const raw = d?.common?.msgId ?? d?.msgId;
  if (raw === undefined || raw === null || raw === '') return false;
  const k = String(raw);
  if (seenMsg.has(k)) return true;
  seenMsg.add(k);
  if (seenMsg.size > 5000) seenMsg.delete(seenMsg.values().next().value);
  return false;
}

// Gift beruntun (combo) dikirim TikTok berkali-kali dengan repeatCount naik (1,2,3,4,5).
// Hitung selisihnya supaya tiap gift terhitung tepat sekali, tanpa menunggu repeatEnd
// (repeatEnd kadang tidak pernah datang, itu yang bikin gift "hilang").
const streaks = new Map();
function giftDelta(userId, d, streakable, now = Date.now()) {
  const cur = Math.max(1, Number(d?.repeatCount) || Number(d?.comboCount) || 1);
  if (!streakable) return cur;
  const key = `${userId}|${d?.giftId ?? d?.gift?.id ?? ''}|${d?.groupId ?? ''}`;
  const rec = streaks.get(key);
  const prev = rec && now - rec.t < 20000 ? rec.n : 0;
  if (d?.repeatEnd) streaks.delete(key);
  else streaks.set(key, { n: Math.max(prev, cur), t: now });
  if (streaks.size > 2000) streaks.clear();
  return cur - prev;
}

function stopConnection() {
  clearTimeout(retryTimer);
  retryTimer = null;
  const old = conn;
  conn = null; // handler lama akan mengabaikan event setelah ini
  try {
    // v2 mengembalikan Promise, v1 sinkron; dua-duanya aman di sini
    Promise.resolve(old?.disconnect()).catch(() => {});
  } catch {
    /* abaikan */
  }
}

function scheduleRetry() {
  if (!AUTO_RECONNECT || !wantedUser) return;
  clearTimeout(retryTimer);
  retries += 1;
  const delay = Math.min(30000, 5000 * retries);
  console.log(`[tiktok] coba konek ulang dalam ${delay / 1000}s (percobaan ${retries})`);
  retryTimer = setTimeout(() => connectTo(wantedUser, true), delay);
}

async function connectTo(raw, isRetry = false) {
  const username = String(raw || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{2,24}$/.test(username)) {
    setStatus({ state: 'error', username: '', message: 'Username tidak valid' });
    return;
  }
  stopConnection();
  if (!isRetry) retries = 0;
  wantedUser = username;
  setStatus({ state: 'connecting', username, message: '' });

  // enableExtendedGiftInfo sengaja dimatikan: opsi itu mengambil daftar gift lewat endpoint
  // sign Euler yang butuh paket Business ("Empty Payload ... requires a Business plan").
  // Info gift (nama & diamond) tetap ada di event gift itu sendiri.
  const c = new ConnectionClass(username, {
    enableExtendedGiftInfo: false,
    processInitialData: false, // jangan proses chat/gift lama yang dikirim ulang saat konek
  });
  conn = c;

  c.on(NAME.chat, (d) => {
    if (conn !== c) return;
    if (isDupMsg(d)) return;
    // v3: field `content`, v1/v2: field `comment`
    const raw = String(d?.content ?? d?.comment ?? '').trim();
    const user = who(d);
    if (DEBUG) console.log(`[chat] ${user.id}: ${raw}`);
    const text = parseGuess(raw);
    if (!text) return; // cuma tebakan 5 huruf
    const now = Date.now();
    const key = `${user.id}|${text}`;
    if (now - (lastGuessAt.get(key) || 0) < GUESS_COOLDOWN_MS) return; // anti-spam kata yang sama
    lastGuessAt.set(key, now);
    if (lastGuessAt.size > 5000) lastGuessAt.clear();
    io.emit('guess', { ...user, word: text });
  });

  c.on(NAME.gift, (d) => {
    if (conn !== c) return;
    if (isDupMsg(d)) return;
    const user = who(d);
    const g = d?.gift ?? d?.giftDetails ?? {};
    const type = g.type ?? g.giftType ?? d?.giftType;
    const count = giftDelta(user.id, d, type === 1);
    if (count <= 0) return;
    const name = g.name ?? g.giftName ?? d?.giftName ?? 'Gift';
    // diamond tidak selalu ikut di event; semua gift minimal 1 diamond
    const perGift = Math.max(1, Number(g.diamondCount ?? d?.diamondCount) || 1);
    if (DEBUG) console.log(`[gift] ${user.id}: ${name} x${count}`);
    io.emit('gift', { ...user, giftName: name, count, diamonds: perGift });
  });

  c.on(NAME.connected, () => {
    if (conn !== c) return;
    retries = 0;
    setStatus({ state: 'connected', username, message: '' });
  });

  c.on(NAME.disconnected, () => {
    if (conn !== c) return;
    setStatus({ state: 'idle', username, message: 'Terputus' });
    scheduleRetry();
  });

  c.on(NAME.streamEnd, () => {
    if (conn !== c) return;
    setStatus({ state: 'error', username, message: 'Live berakhir' });
  });

  c.on(NAME.error, (err) => {
    if (conn !== c) return;
    console.error('[tiktok] error:', err?.message ?? err);
  });

  try {
    await c.connect();
  } catch (err) {
    if (conn !== c) return;
    const msg = String(err?.message ?? err).slice(0, 120);
    setStatus({ state: 'error', username, message: msg });
    scheduleRetry();
  }
}

io.on('connection', (socket) => {
  socket.emit('status', status);

  socket.on('tiktok:connect', (u) => {
    connectTo(u);
  });

  socket.on('tiktok:disconnect', () => {
    wantedUser = '';
    stopConnection();
    setStatus({ state: 'idle', username: '', message: '' });
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[server] socket.io jalan di http://${HOST}:${PORT}`);
  const initial = process.env.TIKTOK_USERNAME;
  if (initial) connectTo(initial);
  else console.log('[server] TIKTOK_USERNAME kosong — isi username lewat panel di game.');
});

process.on('SIGINT', () => {
  stopConnection();
  process.exit(0);
});
