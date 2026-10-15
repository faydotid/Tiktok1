// Semua pengaturan game ada di sini.
export default {
  TITLE: 'KATLA',
  SUBTITLE: 'LIVE', // tampil di bawah judul

  // Alamat server socket.io. Bisa juga diset lewat VITE_SERVER_URL di .env
  SERVER_URL:
    import.meta.env?.VITE_SERVER_URL ||
    `http://${typeof location !== 'undefined' ? location.hostname : 'localhost'}:3001`,

  // Aturan main
  REQUIRE_DICTIONARY: false, // true = tebakan harus ada di daftar kata (src/words.js)
  ALLOW_CONSECUTIVE_SAME_USER: false, // false = user yang sama tidak boleh menebak 2x berturut-turut
  GUESS_INTERVAL_MS: 1200, // jeda antar tebakan yang diproses (biar animasi kebaca)
  TOAST_MS: 2500,

  // Salin jawaban: setelah ada yang menebak benar, sisanya boleh ikut mengetik jawaban itu
  COPY_SLOTS: 10, // berapa orang yang boleh ikut benar (0 = matikan fitur ini)
  COPY_WINDOW_MS: 20000, // batas waktu menunggu orang yang ikut benar
  COPY_INTERVAL_MS: 250, // jeda antar salinan yang diproses
  POINTS_COPY_BASE: 60, // poin orang pertama yang menyalin
  POINTS_COPY_STEP: 4, // dikurangi per urutan berikutnya
  POINTS_COPY_MIN: 20, // poin minimum

  // Leaderboard di antara ronde
  LEADERBOARD_MS: 10000, // lama leaderboard tampil sebelum ronde baru
  LEADERBOARD_SIZE: 15,

  // Poin
  POINTS_NEW_GREEN: 10, // tiap huruf hijau baru (posisi yang belum pernah ketemu)
  POINTS_SOLVE_BASE: 100, // bonus menebak benar
  POINTS_SOLVE_PER_ROW: 20, // tambahan per baris yang masih tersisa
  POINTS_GIFT: 25, // poin per gift (maks 10 gift dihitung per kiriman)

  // Gift = petunjuk (1 gift = 1 huruf)
  MAX_HINTS: 4, // maksimal huruf petunjuk per ronde (kata 5 huruf)
  GIFT_MIN_DIAMONDS: 1, // gift di bawah ini tidak membuka petunjuk
};
