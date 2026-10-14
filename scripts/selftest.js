// Tes cepat tanpa dependency: node scripts/selftest.js
import assert from 'node:assert/strict';
import { evaluate, betterStatus, solvePoints, shuffle, WORD_LENGTH } from '../src/game.js';
import { ANSWERS } from '../src/words.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

test('semua benar', () => {
  assert.deepEqual(evaluate('BUNGA', 'BUNGA'), Array(5).fill('correct'));
});

test('huruf ganda: SPEED vs ERASE', () => {
  assert.deepEqual(evaluate('SPEED', 'ERASE'), ['present', 'absent', 'present', 'present', 'absent']);
});

test('huruf ganda: ALLOW vs LLAMA', () => {
  assert.deepEqual(evaluate('ALLOW', 'LLAMA'), ['present', 'correct', 'present', 'absent', 'absent']);
});

test('huruf ganda di tebakan, satu di jawaban: NANDA vs BUNGA', () => {
  // BUNGA cuma punya satu N (posisi 2) dan satu A (posisi 4); keduanya sudah hijau,
  // jadi N dan A lain di tebakan harus absent (tidak boleh oranye).
  assert.deepEqual(evaluate('NANDA', 'BUNGA'), ['absent', 'absent', 'correct', 'absent', 'correct']);
});

test('huruf ganda: oranye hanya sebanyak sisa di jawaban', () => {
  // ANGIN punya dua N; tebakan NANAS punya dua N tapi tidak ada yang pas posisinya
  assert.deepEqual(evaluate('NANAS', 'ANGIN'), ['present', 'present', 'present', 'absent', 'absent']);
});

test('betterStatus', () => {
  assert.equal(betterStatus(undefined, 'absent'), 'absent');
  assert.equal(betterStatus('present', 'absent'), 'present');
  assert.equal(betterStatus('present', 'correct'), 'correct');
  assert.equal(betterStatus('correct', 'present'), 'correct');
});

test('solvePoints makin kecil kalau makin lambat', () => {
  assert.equal(solvePoints(0, 6, 100, 20), 200);
  assert.equal(solvePoints(5, 6, 100, 20), 100);
});

test('shuffle menjaga isi', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(shuffle(a).sort(), a);
});

test('daftar kata valid', () => {
  assert.ok(ANSWERS.length >= 200, `terlalu sedikit kata: ${ANSWERS.length}`);
  for (const w of ANSWERS) {
    assert.equal(w.length, WORD_LENGTH, w);
    assert.match(w, /^[A-Z]{5}$/, w);
  }
  assert.equal(new Set(ANSWERS).size, ANSWERS.length);
  console.log(`    (${ANSWERS.length} kata)`);
});

console.log(`\n${passed} tes lulus`);
