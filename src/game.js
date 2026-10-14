// Logika murni (tanpa DOM) supaya gampang dites.
export const WORD_LENGTH = 5;
export const MAX_ROWS = 6;

/** Hasil per huruf: 'correct' (benar), 'present' (salah posisi), 'absent' (salah huruf). */
export function evaluate(guess, answer) {
  const result = Array(WORD_LENGTH).fill('absent');
  const remaining = {};

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) result[i] = 'correct';
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] !== 'correct' && remaining[guess[i]] > 0) {
      result[i] = 'present';
      remaining[guess[i]] -= 1;
    }
  }
  return result;
}

const RANK = { absent: 1, present: 2, correct: 3 };

/** Status terbaik untuk warna keyboard: correct > present > absent. */
export function betterStatus(prev, next) {
  if (!prev) return next;
  return RANK[next] > RANK[prev] ? next : prev;
}

/** Poin untuk yang menebak benar. rowIndex dimulai dari 0. */
export function solvePoints(rowIndex, maxRows, base, perRow) {
  return base + (maxRows - 1 - rowIndex) * perRow;
}

/** Acak Fisher-Yates (tidak mengubah array asli). */
export function shuffle(list, rand = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
