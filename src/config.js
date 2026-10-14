// Semua pengaturan game ada di sini.
export default {
  TITLE: 'TEBAK KATA',
  SUBTITLE: 'LIVE GAME', // ganti dengan nama kamu, mis. 'BY JAJAY'

  // Alamat server socket.io. Bisa juga diset lewat VITE_SERVER_URL di .env
  SERVER_URL:
    import.meta.env?.VITE_SERVER_URL ||
    `http://${typeof location !== 'undefined' ? location.hostname : 'localhost'}:3001`,

  // Aturan main
  REQUIRE_DICTIONARY: false, // true = tebakan harus ada di daftar kata (src/words.js)
  ALLOW_CONSECUTIVE_SAME_USER: false, // false = user yang sama tidak boleh menebak 2x berturut-turut
  GUESS_INTERVAL_MS: 1200, // jeda antar tebakan yang diproses (biar animasi kebaca)
  NEXT_ROUND_DELAY_MS: 6000, // lama layar hasil sebelum ronde baru
  TOAST_MS: 2500,

  // Poin
  POINTS_NEW_GREEN: 10, // tiap huruf hijau baru (posisi yang belum pernah ketemu)
  POINTS_SOLVE_BASE: 100, // bonus menebak benar
  POINTS_SOLVE_PER_ROW: 20, // tambahan per baris yang masih tersisa
  POINTS_GIFT: 25, // poin untuk pengirim gift

  // Gift = petunjuk
  MAX_HINTS: 2, // maksimal huruf petunjuk per ronde
  GIFT_MIN_DIAMONDS: 1, // gift di bawah ini tidak membuka petunjuk
};
