import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import * as TLNamespace from 'tiktok-live-connector';

// ---------- Config ----------
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const AUTO_RECONNECT = process.env.AUTO_RECONNECT !== 'false';
const GUESS_COOLDOWN_MS = Number(process.env.GUESS_COOLDOWN_MS) || 1000;

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
  const id = u.uniqueId ?? d?.uniqueId ?? 'anon';
  const name = u.nickname ?? d?.nickname ?? id;
  return { id: String(id), name: String(name) };
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

  const c = new ConnectionClass(username, { enableExtendedGiftInfo: true });
  conn = c;

  c.on(NAME.chat, (d) => {
    if (conn !== c) return;
    const text = String(d?.comment ?? '').trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(text)) return; // cuma tebakan 5 huruf A-Z
    const user = who(d);
    const now = Date.now();
    if (now - (lastGuessAt.get(user.id) || 0) < GUESS_COOLDOWN_MS) return;
    lastGuessAt.set(user.id, now);
    if (lastGuessAt.size > 5000) lastGuessAt.clear();
    io.emit('guess', { ...user, word: text });
  });

  c.on(NAME.gift, (d) => {
    if (conn !== c) return;
    const type = d?.giftType ?? d?.giftDetails?.giftType;
    if (type === 1 && !d?.repeatEnd) return; // gift beruntun masih jalan, tunggu selesai
    const perGift = d?.diamondCount ?? d?.giftDetails?.diamondCount ?? 0;
    io.emit('gift', {
      ...who(d),
      giftName: d?.giftName ?? d?.giftDetails?.giftName ?? 'Gift',
      diamonds: perGift * (d?.repeatCount || 1),
    });
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
