'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const A = require('../core.js');
const make = (entries, n = 5) => { const b = Array(n * n).fill(0); for (const [i, v] of entries) b[i] = v; return b; };
const played = p => { let b = p.board.slice(); for (const m of p.solution) { const prev = b; b = A.apply(b, p.size, m); assert.ok(A.count(b) < A.count(prev)); assert.equal(A.sum(b) % 2, A.sum(prev) % 2); for (let i = 0; i < b.length; i++) if (!prev[i]) assert.equal(b[i], 0, 'empty cells never become occupied'); } return b; };

test('01 board validation rejects dimensions, non-integers and out-of-range values', () => {
  assert.equal(A.assertBoard(Array(25).fill(0), 5), true);
  for (const [b, n] of [[Array(16).fill(1), 4], [Array(36).fill(1), 5], [make([[1, 10]]), 5], [make([[1, -1]]), 5], [make([[1, 1.5]]), 5], [null, 5]]) assert.throws(() => A.assertBoard(b, n));
});
test('02 an exact-distance cardinal jump lands on an occupied cell', () => {
  const b = make([[12, 2], [2, 4], [14, 5], [22, 2], [10, 7], [13, 3], [18, 1]]);
  assert.deepEqual(A.destinations(b, 5, 12), [2, 14, 22, 10]);
});
test('03 intervening pieces do not block a jump', () => {
  const b = make([[10, 2], [11, 9], [12, 5]]); assert.deepEqual(A.destinations(b, 5, 10), [12]);
  assert.deepEqual(A.apply(b, 5, { from: 10, to: 12 }), make([[11, 9], [12, 3]]));
});
test('04 diagonal, short, empty, same-cell and out-of-range moves are rejected', () => {
  const b = make([[12, 2], [13, 2], [18, 3], [24, 1]]);
  for (const to of [12, 13, 18, 14, 24, -1, 25]) assert.throws(() => A.apply(b, 5, { from: 12, to }));
  assert.throws(() => A.apply(b, 5, { from: 0, to: 12 }));
});
test('05 horizontal moves never wrap into the next row', () => {
  assert.deepEqual(A.destinations(make([[4, 1], [5, 1]]), 5, 4), []);
});
test('06 merge leaves the absolute difference at the destination without mutating input', () => {
  const b = make([[11, 1], [12, 4]]), before = b.slice();
  assert.deepEqual(A.apply(b, 5, { from: 11, to: 12 }), make([[12, 3]])); assert.deepEqual(b, before);
});
test('07 equal values disappear; an empty board wins before checking legal moves', () => {
  const b = A.apply(make([[10, 3], [13, 3]]), 5, { from: 10, to: 13 }); assert.equal(A.status(b, 5), 'won'); assert.equal(A.count(b), 0);
});
test('08 nonempty boards with no legal moves are stuck, including a single tile', () => {
  assert.equal(A.status(make([[12, 1]]), 5), 'stuck'); assert.equal(A.status(make([[0, 1], [24, 1]]), 5), 'stuck');
});
test('09 large values cannot move themselves but can receive a moving tile', () => {
  const p = A.journey(4); assert.deepEqual(A.destinations(p.board, 5, 14), []); assert.ok(A.validateSolution(p.board, 5, p.solution));
  for (const n of [5, 6, 7]) for (let value = n; value <= 9; value++) assert.deepEqual(A.destinations(make([[0, value], [1, 1]], n), n, 0), []);
});
test('10 certificates for all 60 journey levels end at zero', () => {
  const signatures = new Set();
  for (let i = 1; i <= 60; i++) { const p = A.journey(i); assert.ok(A.validateSolution(p.board, p.size, p.solution), `level ${i}`); assert.equal(A.count(played(p)), 0); signatures.add(`${p.size}:${A.key(p.board)}`); assert.ok(A.moves(p.board, p.size).length); }
  assert.equal(signatures.size, 60);
});
test('11 1200 free-play boards have valid certificates and deterministic codes', () => {
  for (const n of [5, 6, 7]) for (let i = 0; i < 400; i++) {
    const p = A.free(n, `T${i}`); assert.equal(A.count(played(p)), 0, p.code); assert.equal(A.sum(p.board) % 2, 0); assert.equal(A.count(p.board), [12, 19, 27][n - 5]);
    if (i < 10) assert.deepEqual(A.fromCode(p.code), p);
  }
});
test('12 1098 daily boards cover every day of a leap year at all three tiers', () => {
  const start = Date.UTC(2028, 0, 1);
  for (let d = 0; d < 366; d++) for (let tier = 0; tier < 3; tier++) {
    const date = new Date(start + d * 86400000).toISOString().slice(0, 10), p = A.daily(date, tier);
    assert.equal(A.count(played(p)), 0, p.code); assert.equal(A.sum(p.board) % 2, 0);
  }
});
test('13 same seed generates identical boards and certified move sequences', () => {
  for (let i = 0; i < 20; i++) assert.deepEqual(A.generate(`stable${i}`, 6, 18), A.generate(`stable${i}`, 6, 18));
});
test('14 invalid seeds, codes, sizes, levels and impossible date strings are rejected', () => {
  for (const code of ['AZ1-J00', 'AZ1-J61', 'AZ1-D20260230-1', 'AZ1-D20261301-1', 'AZ1-D20260101-4', 'AZ2-J01', '<script>', 'AZ1-F4-X']) assert.throws(() => A.fromCode(code), code);
  assert.throws(() => A.free(5, '<svg>')); assert.throws(() => A.generate('bad', 5, 26)); assert.throws(() => A.generate('bad', 8, 20));
  assert.equal(A.fromCode(' az1-j03 ').level, 3);
});
test('15 JST daily rollover is deterministic and independent of host timezone', () => {
  assert.equal(A.tokyoDate(Date.parse('2026-09-06T14:59:59Z')), '2026-09-06');
  assert.equal(A.tokyoDate(Date.parse('2026-09-06T15:00:00Z')), '2026-09-07');
  assert.equal(A.validDate('2028-02-29'), true); assert.equal(A.validDate('2026-02-29'), false);
});
test('16 each certified intermediate position has a complete verified suffix', () => {
  const p = A.journey(60), cert = A.certificate(p.board, p.size, p.solution); let b = p.board.slice();
  for (let i = 0; i <= p.solution.length; i++) { assert.ok(A.validateSolution(b, p.size, cert.get(A.key(b)))); if (i < p.solution.length) b = A.apply(b, p.size, p.solution[i]); }
});
test('17 solver finds a valid route for all first ten levels, without certificates', () => {
  for (let i = 1; i <= 10; i++) { const p = A.journey(i), r = A.solve(p.board, p.size, { maxNodes: 300000, budgetMs: 10000 }); assert.equal(r.status, 'solved'); assert.ok(A.validateSolution(p.board, p.size, r.moves)); }
});
test('18 solver reports exhaustive impossibility and odd-sum obstruction', () => {
  for (const b of [make([[0, 1]]), make([[0, 1], [24, 1]]), make([[0, 1], [1, 2]])]) assert.equal(A.solve(b, 5).status, 'unsolvable');
});
test('19 budget exhaustion is UNKNOWN, never called unsolvable', () => {
  const p = A.journey(20); assert.equal(A.solve(p.board, p.size, { maxNodes: 0 }).status, 'limit');
  assert.equal(A.solve(p.board, p.size, { budgetMs: 0 }).status, 'limit');
});
test('20 a verified certificate still works under a zero search budget', () => {
  const p = A.journey(60), r = A.solve(p.board, p.size, { maxNodes: 0, known: A.certificate(p.board, p.size, p.solution) });
  assert.equal(r.status, 'solved'); assert.ok(A.validateSolution(p.board, p.size, r.moves));
});
test('21 an invalid supplied certificate is not trusted', () => {
  const b = make([[0, 1], [24, 1]]), r = A.solve(b, 5, { known: [[A.key(b), []]] }); assert.equal(r.status, 'unsolvable');
});
test('22 bounded solver agrees with an independent exhaustive oracle on 120 small boards', () => {
  function oracle(b, n, seen = new Set()) { if (b.every(v => v === 0)) return true; const k = b.join(','); if (seen.has(k)) return false; seen.add(k);
    for (let from = 0; from < b.length; from++) if (b[from]) for (let to = 0; to < b.length; to++) if (from !== to && b[to]) {
      const ar = Math.floor(from / n), ac = from % n, br = Math.floor(to / n), bc = to % n;
      if (!((ar === br && Math.abs(ac - bc) === b[from]) || (ac === bc && Math.abs(ar - br) === b[from]))) continue;
      const next = b.slice(); next[to] = Math.abs(b[from] - b[to]); next[from] = 0; if (oracle(next, n, seen)) return true;
    } return false;
  }
  const random = A.rng('independent-oracle');
  for (let i = 0; i < 120; i++) {
    let b; if (i % 2 === 0) b = A.generate(`tiny${i}`, 5, 6).board;
    else { b = Array(25).fill(0); for (let j = 0; j < 6; j++) b[Math.floor(random() * 25)] = 1 + Math.floor(random() * 5); }
    const r = A.solve(b, 5, { maxNodes: 1000000, budgetMs: 5000 }); assert.notEqual(r.status, 'limit'); assert.equal(r.status === 'solved', oracle(b, 5));
  }
});
test('23 restore reconstructs board from validated history and validates redo', () => {
  const p = A.journey(12); const value = { version: A.VERSION, code: p.code, history: p.solution.slice(0, 3), redo: p.solution.slice(3, 5).reverse(), stats: { hints: 1, undos: 2, restarts: 0, elapsed: 9000 } };
  const r = A.validateSession(value); let expected = p.board; for (const m of value.history) expected = A.apply(expected, p.size, m); assert.deepEqual(r.board, expected);
});
test('24 corrupt histories, invalid counters and wrong versions cannot be restored', () => {
  const base = { version: A.VERSION, code: 'AZ1-J01', history: [], redo: [], stats: { hints: 0, undos: 0, restarts: 0, elapsed: 0 } };
  for (const v of [{ ...base, history: [{ from: 0, to: 1 }] }, { ...base, redo: [{ from: 0, to: 1 }] }, { ...base, stats: { ...base.stats, hints: -1 } }, { ...base, version: 'AZ0' }]) assert.throws(() => A.validateSession(v));
});
test('25 service worker installation, scope-limited cleanup and explicit update lifecycle', async () => {
  const listeners = {}, deleted = [], cached = []; let skipped = 0, claimed = 0;
  const scope = 'https://example.test/absolute-zero/';
  const ctx = { URL, console, self: { registration: { scope }, location: { origin: 'https://example.test' }, addEventListener: (type, handler) => { listeners[type] = handler; }, clients: { claim: () => { claimed++; return Promise.resolve(); } }, skipWaiting: () => skipped++ }, caches: { open: async () => ({ addAll: async files => cached.push(...files) }), keys: async () => [`absolute-zero:${scope}:0.9.0`, `absolute-zero:${scope}:1.0.0`, 'other-game:1.0', 'absolute-zero:https://example.test/elsewhere/:0.9'], delete: async k => { deleted.push(k); return true; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), ctx);
  let promise; listeners.install({ waitUntil: p => { promise = p; } }); await promise;
  assert.ok(cached.every(u => u.startsWith(scope))); assert.ok(cached.includes(scope + 'core.js')); assert.equal(skipped, 0);
  listeners.activate({ waitUntil: p => { promise = p; } }); await promise;
  assert.deepEqual(deleted, [`absolute-zero:${scope}:0.9.0`]); assert.equal(claimed, 1);
  listeners.message({ data: { type: 'SKIP_WAITING' } }); assert.equal(skipped, 1);
});
test('26 offline navigation returns cached index; external requests are not intercepted', async () => {
  const listeners = {}; const scope = 'https://example.test/absolute-zero/';
  const sentinel = { marker: 'cached-index' };
  const ctx = { URL, self: { registration: { scope }, location: { origin: 'https://example.test' }, addEventListener: (type, handler) => { listeners[type] = handler; } }, caches: { open: async () => ({ match: async u => u === scope + 'index.html' ? sentinel : null }) }, fetch: () => Promise.reject(new Error('offline')) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), ctx);
  let response; listeners.fetch({ request: { url: scope + '?p=AZ1-J03', method: 'GET', mode: 'navigate' }, respondWith: p => { response = p; }, waitUntil: () => {} }); assert.equal(await response, sentinel);
  let intercepted = false; listeners.fetch({ request: { url: 'https://other.example/game.js', method: 'GET' }, respondWith: () => { intercepted = true; } }); assert.equal(intercepted, false);
});
test('27 site packaging is relative-path only and contains no runtime dependency URLs', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal(/<(?:script|link)[^>]+(?:src|href)="https?:/.test(html), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './');
});
