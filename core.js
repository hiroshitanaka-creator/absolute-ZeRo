/* Absolute Zero v1.0.0 — MIT. Pure, deterministic puzzle rules and generation. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AZ = factory(); root.AZFactory = factory; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'AZ1';
  const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const CHAPTERS = [
    { name: 'はじまりの一手', word: 'ORIGIN', size: 5, start: 6, end: 10, text: '数字が、そのまま移動する距離になる。' },
    { name: '距離を読む', word: 'DISTANCE', size: 5, start: 10, end: 14, text: '目の前ではなく、着地する場所を見る。' },
    { name: '変化をつくる', word: 'TRANSFORM', size: 6, start: 12, end: 17, text: '引き算は、次の一手の設計図。' },
    { name: '最後から考える', word: 'REVERSE', size: 6, start: 17, end: 21, text: '最後に消える二枚は、どの二枚だろう。' },
    { name: '余白をつなぐ', word: 'SPACE', size: 7, start: 20, end: 25, text: '残した一枚が、遠くの一枚を迎えにいく。' },
    { name: '零への旅', word: 'ABSOLUTE', size: 7, start: 25, end: 30, text: 'すべてをつないで、何もない場所へ。' }
  ];
  function assertBoard(board, n) {
    if (!Number.isInteger(n) || n < 5 || n > 7 || !Array.isArray(board) || board.length !== n * n ||
        board.some(x => !Number.isInteger(x) || x < 0 || x > 9)) throw new Error('不正な盤面です。');
    return true;
  }
  const key = board => board.join('');
  const count = board => board.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
  const sum = board => board.reduce((s, v) => s + v, 0);
  function destinations(board, n, from) {
    const a = board[from];
    if (!a || !Number.isInteger(from) || from < 0 || from >= board.length) return [];
    const r = Math.floor(from / n), c = from % n, out = [];
    for (const [dr, dc] of DIRS) {
      const rr = r + dr * a, cc = c + dc * a;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr * n + cc]) out.push(rr * n + cc);
    }
    return out;
  }
  function moves(board, n) {
    const out = [];
    board.forEach((v, from) => { if (v) for (const to of destinations(board, n, from)) out.push({ from, to }); });
    return out;
  }
  function apply(board, n, move) {
    if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to) || !destinations(board, n, move.from).includes(move.to))
      throw new Error('その移動はできません。数字と同じ距離にある駒を選んでください。');
    const next = board.slice();
    next[move.to] = Math.abs(board[move.from] - board[move.to]); next[move.from] = 0;
    return next;
  }
  function status(board, n) { return count(board) === 0 ? 'won' : moves(board, n).length === 0 ? 'stuck' : 'playing'; }
  function validateSolution(board, n, solution) {
    try { assertBoard(board, n); let b = board.slice(); for (const m of solution) b = apply(b, n, m); return count(b) === 0; }
    catch (_) { return false; }
  }
  function certificate(board, n, solution) {
    if (!validateSolution(board, n, solution)) throw new Error('解答証明の検証に失敗しました。');
    const map = new Map(); let b = board.slice();
    for (let i = 0; i <= solution.length; i++) { map.set(key(b), solution.slice(i)); if (i < solution.length) b = apply(b, n, solution[i]); }
    return map;
  }
  function hash(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = hash(String(seed));
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const choose = (arr, random) => arr[Math.floor(random() * arr.length)];
  function reverseOptions(board, n, maxValue) {
    const splits = [], pairs = [];
    for (let to = 0; to < n * n; to++) {
      const c = board[to], r = Math.floor(to / n), col = to % n;
      for (let a = 1; a < n && a <= maxValue; a++) {
        for (const [dr, dc] of DIRS) {
          const rr = r + dr * a, cc = col + dc * a;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          const from = rr * n + cc;
          if (board[from]) continue;
          if (!c) { if (from < to) pairs.push({ from, to, a, b: a }); }
          else {
            if (a + c <= maxValue) splits.push({ from, to, a, b: a + c });
            if (a - c > 0) splits.push({ from, to, a, b: a - c });
          }
        }
      }
    }
    return { splits, pairs };
  }
  /* Each inverse step has a legal forward witness; no random, unverified board is returned. */
  function generate(seed, n, tiles, options = {}) {
    if (![5, 6, 7].includes(n) || !Number.isInteger(tiles) || tiles < 2 || tiles > n * n) throw new Error('生成条件が不正です。');
    const random = rng(`${VERSION}|${seed}|${n}|${tiles}`), maxValue = options.maxValue || 9;
    let best = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      let board = Array(n * n).fill(0); const reverse = []; let additions = 0;
      while (count(board) < tiles) {
        const opts = reverseOptions(board, n, maxValue);
        const remaining = tiles - count(board);
        let pool;
        if (count(board) === 0) pool = opts.pairs;
        else if (opts.splits.length && !(remaining >= 2 && additions < 3 && random() < 0.035)) pool = opts.splits;
        else if (remaining >= 2) pool = opts.pairs;
        else break;
        if (!pool.length) break;
        const s = choose(pool, random);
        if (!board[s.to]) additions++;
        board[s.from] = s.a; board[s.to] = s.b; reverse.push({ from: s.from, to: s.to });
      }
      const solution = reverse.slice().reverse(), legal = moves(board, n);
      // Favor spatial spread and several plausible first choices, without claiming a solved difficulty rating.
      const rows = new Set(), cols = new Set(); board.forEach((v, i) => { if (v) { rows.add(Math.floor(i / n)); cols.add(i % n); } });
      const score = count(board) * 100 + Math.min(legal.length, 12) * 4 + rows.size + cols.size + Math.min(Math.max(...board), 9);
      if (!best || score > best.score) best = { size: n, board, solution, score };
      if (count(board) === tiles && legal.length >= Math.min(tiles / 2, 10) && rows.size >= n - 1 && cols.size >= n - 1) break;
    }
    if (!best || !validateSolution(best.board, n, best.solution)) throw new Error('解ける問題を生成できませんでした。');
    delete best.score;
    return best;
  }
  function fixed(entries, solution, title, tip) {
    const board = Array(25).fill(0); for (const [i, v] of entries) board[i] = v;
    return { size: 5, board, solution: solution.map(([from, to]) => ({ from, to })), title, tip };
  }
  const TUTORIALS = [
    () => fixed([[11, 1], [12, 1]], [[11, 12]], '同じ数字を、重ねる', '「1」を選んで、隣の「1」へ。同じ数字はゼロになり、二枚とも消えます。'),
    () => fixed([[10, 2], [12, 2], [11, 1], [16, 1]], [[10, 12], [11, 16]], '途中の駒は、飛び越える', '「2」は必ず2マス先へ。途中の「1」がいても、そのまま飛び越えられます。'),
    () => fixed([[11, 1], [12, 3], [14, 2]], [[11, 12], [14, 12]], '差が、次の移動力になる', '「1」を「3」に重ねると「2」に。着地した場所で、新しい距離が生まれます。'),
    () => fixed([[10, 4], [14, 5], [19, 1]], [[10, 14], [19, 14]], '動けない駒にも、役割がある', '5×5の「5」は自分から動けません。でも「4」の着地点にすれば「1」へ変わります。')
  ];
  function journey(level) {
    if (!Number.isInteger(level) || level < 1 || level > 60) throw new Error('問題番号は1〜60です。');
    const chapter = CHAPTERS[Math.floor((level - 1) / 10)], step = (level - 1) % 10;
    let p;
    if (level <= TUTORIALS.length) p = TUTORIALS[level - 1]();
    else p = { ...generate(`journey-${level}`, chapter.size, Math.round(chapter.start + (chapter.end - chapter.start) * step / 9), { maxValue: level <= 7 ? 5 : 9 }), title: `${chapter.name} ${String(step + 1).padStart(2, '0')}`, tip: chapter.text };
    return { ...p, mode: 'journey', level, code: `AZ1-J${String(level).padStart(2, '0')}`, label: `航路 ${String(level).padStart(2, '0')} / 60`, chapter: Math.floor((level - 1) / 10) };
  }
  function tokyoDate(now = Date.now()) { return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s; }
  function daily(date = tokyoDate(), tier = 1) {
    if (!validDate(date) || ![0, 1, 2].includes(tier)) throw new Error('日付または難易度が不正です。');
    const size = tier + 5, tiles = [10, 17, 25][tier], names = ['静かな一手', '思考の散歩', '深い余白'];
    return { ...generate(`daily-${date}-${tier}`, size, tiles), mode: 'daily', date, tier, code: `AZ1-D${date.replace(/-/g, '')}-${tier + 1}`, label: `DAILY / ${date.replace(/-/g, '.')}`, title: names[tier], tip: '毎日、日本時間0時に更新。同じコードなら、世界のどこでも同じ盤面です。' };
  }
  function free(size = 5, seed = 'ZERO') {
    if (![5, 6, 7].includes(size) || !/^[A-Z0-9]{1,12}$/.test(seed)) throw new Error('問題コードが不正です。');
    return { ...generate(`free-${seed}`, size, [12, 19, 27][size - 5]), mode: 'free', seed, code: `AZ1-F${size}-${seed}`, label: 'FREE PLAY / 自由演習', title: 'ひとつずつ、ゼロへ。', tip: '時間制限はありません。戻りながら、自分だけの解き方を。' };
  }
  function fromCode(raw) {
    const code = String(raw).trim().toUpperCase(); let m;
    if ((m = /^AZ1-J(\d{2})$/.exec(code))) return journey(Number(m[1]));
    if ((m = /^AZ1-D(\d{4})(\d{2})(\d{2})-([123])$/.exec(code))) return daily(`${m[1]}-${m[2]}-${m[3]}`, Number(m[4]) - 1);
    if ((m = /^AZ1-F([567])-([A-Z0-9]{1,12})$/.exec(code))) return free(Number(m[1]), m[2]);
    throw new Error('AZ1- で始まる正しい問題コードを入力してください。');
  }
  /* Bounded exact DFS. A limit is UNKNOWN, never a proof of impossibility. */
  function solve(board, n, options = {}) {
    assertBoard(board, n);
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const start = now(), maxNodes = options.maxNodes ?? 200000, budgetMs = options.budgetMs ?? 4000;
    const known = options.known instanceof Map ? options.known : new Map(options.known || []);
    const dead = new Set(); let nodes = 0, limited = false;
    const ordering = b => moves(b, n).sort((x, y) => {
      const rank = m => (b[m.from] === b[m.to] ? 100 : 0) + (b[m.to] >= n ? 8 : 0) - Math.abs(b[m.from] - b[m.to]);
      return rank(y) - rank(x);
    });
    function visit(b) {
      const k = key(b);
      if (known.has(k)) {
        const path = known.get(k);
        if (validateSolution(b, n, path)) return path.slice();
        // Never trust an invalid external certificate.
        known.delete(k);
      }
      if (count(b) === 0) return [];
      if (sum(b) % 2 || count(b) === 1 || dead.has(k)) return null;
      if (nodes >= maxNodes || (nodes % 128 === 0 && now() - start >= budgetMs)) { limited = true; return null; }
      nodes++;
      const unique = new Set();
      for (const m of ordering(b)) {
        const next = apply(b, n, m), nk = key(next);
        if (unique.has(nk)) continue;
        unique.add(nk);
        const tail = visit(next);
        if (tail) return [m, ...tail];
        if (limited) return null;
      }
      dead.add(k); return null;
    }
    const result = visit(board);
    return { status: result ? 'solved' : limited ? 'limit' : 'unsolvable', moves: result || [], nodes, elapsedMs: Math.round(now() - start) };
  }
  function validateSession(value) {
    if (!value || value.version !== VERSION || typeof value.code !== 'string') throw new Error('保存形式が異なります。');
    const puzzle = fromCode(value.code);
    if (!Array.isArray(value.history) || value.history.length > 49 || !Array.isArray(value.redo) || value.redo.length > 49) throw new Error('履歴が不正です。');
    let board = puzzle.board.slice();
    for (const m of value.history) board = apply(board, puzzle.size, m);
    let redoBoard = board.slice(); for (let i = value.redo.length - 1; i >= 0; i--) redoBoard = apply(redoBoard, puzzle.size, value.redo[i]);
    const stats = value.stats || {};
    for (const name of ['hints', 'undos', 'restarts', 'elapsed']) if (!Number.isFinite(stats[name]) || stats[name] < 0 || stats[name] > 1e12) throw new Error('保存記録が不正です。');
    return { puzzle, board, history: value.history, redo: value.redo, stats, awarded: !!value.awarded };
  }
  return { VERSION, CHAPTERS, DIRS, assertBoard, key, count, sum, destinations, moves, apply, status, validateSolution, certificate, hash, rng, generate, journey, daily, free, fromCode, tokyoDate, validDate, solve, validateSession };
});
