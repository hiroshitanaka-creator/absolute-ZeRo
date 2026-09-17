/* Absolute Zero v1.0.1 — MIT. UI, input and local-only persistence. */
(() => {
  'use strict';
  const A = window.AZ, $ = id => document.getElementById(id);
  const STORAGE_KEY = 'absolute-zero:v1';
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const defaultStore = () => ({ version: A.VERSION, current: 'AZ1-J01', lastMode: {}, sessions: {}, records: {}, dailyWins: [], settings: { sound: false, dark: false, motion: true } });
  let store = defaultStore(), state = null, known = new Map(), selected = -1, cells = [];
  let locked = false, revision = 0, hintMove = null, solver = null, searching = false, analysisResult = null;
  let toastTimer, winTimer, lastTick = Date.now(), lastSaveTick = 0, saveFailed = false, warnedStorage = false;
  let waitingWorker = null, applyUpdate = false, lastFocus = null, pendingImport = null, audioContext = null;
  const reducedMotion = () => !store.settings.motion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isHttp = /^https?:$/.test(location.protocol);
  const formatTime = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const coord = (i, n) => `${String.fromCharCode(65 + i % n)}${Math.floor(i / n) + 1}`;
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200); }
  function sanitizeStore(input, strict = false) {
    if (!input || input.version !== A.VERSION || typeof input !== 'object') throw new Error('このバージョンの保存データではありません。');
    const out = defaultStore();
    for (const k of ['sound', 'dark', 'motion']) if (typeof input.settings?.[k] === 'boolean') out.settings[k] = input.settings[k];
    if (typeof input.current === 'string') { try { A.fromCode(input.current); out.current = input.current; } catch (_) { if (strict) throw new Error('現在の問題コードが不正です。'); } }
    for (const mode of ['journey', 'daily', 'free']) { const code = input.lastMode?.[mode]; if (typeof code === 'string') { try { if (A.fromCode(code).mode === mode) out.lastMode[mode] = code; } catch (_) {} } }
    if (input.sessions && typeof input.sessions === 'object') for (const [code, val] of Object.entries(input.sessions).slice(-20)) {
      try { if (val.code !== code) throw new Error('保存コードが一致しません。'); A.validateSession(val); out.sessions[code] = val; }
      catch (err) { if (strict) throw err; }
    }
    if (input.records && typeof input.records === 'object') for (const [code, rec] of Object.entries(input.records).slice(-10000)) {
      if (!/^AZ1-(J\d{2}|D\d{8}-[123]|F[567]-[A-Z0-9]{1,12})$/.test(code)) continue;
      if (rec && Number.isInteger(rec.stars) && rec.stars >= 1 && rec.stars <= 3 && Number.isFinite(rec.bestTime) && rec.bestTime >= 0 && Number.isInteger(rec.bestMoves) && rec.bestMoves > 0 && rec.bestMoves <= 49 && Number.isInteger(rec.clears) && rec.clears > 0) {
        out.records[code] = { stars: rec.stars, bestTime: Math.min(rec.bestTime, 1e12), bestMoves: rec.bestMoves, clears: Math.min(rec.clears, 1e9) };
      } else if (strict) throw new Error('クリア記録が不正です。');
    }
    out.dailyWins = Array.isArray(input.dailyWins) ? [...new Set(input.dailyWins.filter(x => typeof x === 'string' && A.validDate(x)))].slice(-10000) : [];
    return out;
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); saveFailed = false; }
    catch (_) { saveFailed = true; if (!warnedStorage) { toast('保存領域を使えません。設定の「記録を書き出す」で保管できます。'); warnedStorage = true; } }
    $('save-status').textContent = saveFailed ? '保存不可・書き出し推奨' : 'この端末に自動保存';
  }
  function saveSession() {
    if (!state) return;
    const { puzzle, history, redo, stats, awarded } = state;
    delete store.sessions[puzzle.code];
    store.sessions[puzzle.code] = { version: A.VERSION, code: puzzle.code, history, redo, stats: { ...stats }, awarded, updatedAt: Date.now() };
    while (Object.keys(store.sessions).length > 20) delete store.sessions[Object.keys(store.sessions)[0]];
    store.current = puzzle.code; store.lastMode[puzzle.mode] = puzzle.code;
    persist();
  }
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) store = sanitizeStore(JSON.parse(raw)); }
  catch (_) { setTimeout(() => toast('保存データを読み込めなかったため、新しい盤面から始めます。'), 300); }
  function applySettings() { document.body.classList.toggle('dark', store.settings.dark); document.body.classList.toggle('no-motion', !store.settings.motion); document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue('--paper').trim(); }
  function cancelSearch() { if (solver) { solver.terminate(); solver = null; } searching = false; revision++; }
  function boardAfter(history) { let b = state.puzzle.board.slice(); for (const move of history) b = A.apply(b, state.puzzle.size, move); return b; }
  function loadPuzzle(puzzle, { fresh = false, updateURL = true } = {}) {
    saveSession(); cancelSearch(); clearTimeout(winTimer); locked = false; selected = -1; hintMove = null; analysisResult = null;
    state = { puzzle, board: puzzle.board.slice(), history: [], redo: [], stats: { hints: 0, undos: 0, restarts: 0, elapsed: 0 }, awarded: false, winShown: false };
    const saved = store.sessions[puzzle.code];
    if (!fresh && saved && !saved.awarded) {
      try { const restored = A.validateSession(saved); Object.assign(state, restored); }
      catch (_) { delete store.sessions[puzzle.code]; toast('この問題の途中データが不正なため、最初から始めます。'); }
    }
    known = A.certificate(puzzle.board, puzzle.size, puzzle.solution);
    buildBoard(); render(); lastTick = Date.now(); saveSession();
    if (updateURL) try { const url = new URL(location.href); url.searchParams.set('p', puzzle.code); history.replaceState(null, '', url.href); } catch (_) {}
    if (A.status(state.board, puzzle.size) === 'won') winTimer = setTimeout(checkEnd, 100);
  }
  function buildBoard() {
    const board = $('board'), n = state.puzzle.size;
    board.innerHTML = ''; board.style.setProperty('--n', n); board.dataset.code = state.puzzle.code;
    board.setAttribute('aria-label', `${n}行${n}列の盤面。列はAから、行は1からです。`);
    cells = state.board.map((_, i) => {
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'cell'; cell.dataset.index = i; cell.dataset.size = n;
      cell.style.setProperty('--i', Math.floor(i / n) + i % n);
      const value = document.createElement('span'); value.className = 'tile-value'; value.setAttribute('aria-hidden', 'true');
      const mark = document.createElement('span'); mark.className = 'tile-mark'; mark.setAttribute('aria-hidden', 'true');
      cell.append(value, mark); board.append(cell); return cell;
    });
  }
  function pathCells(from, to, n) {
    const dr = Math.sign(Math.floor(to / n) - Math.floor(from / n)), dc = Math.sign(to % n - from % n);
    const out = []; let x = from + dr * n + dc;
    while (x !== to && out.length < n) { out.push(x); x += dr * n + dc; }
    return out;
  }
  function render() {
    if (!state) return;
    const { puzzle: p, board: b, history, redo } = state, n = p.size;
    if (selected >= 0 && !b[selected]) selected = -1;
    const targets = selected >= 0 ? A.destinations(b, n, selected) : [];
    const path = new Set(); for (const to of targets) for (const i of pathCells(selected, to, n)) path.add(i);
    const lastMove = history[history.length - 1];
    cells.forEach((cell, i) => {
      const value = b[i], dest = value ? A.destinations(b, n, i) : [];
      cell.className = `cell ${value ? 'tile' : 'empty'}`;
      cell.classList.toggle('selected', i === selected); cell.classList.toggle('landing', targets.includes(i));
      cell.classList.toggle('anchored', value > 0 && value >= n); cell.classList.toggle('flight-path', path.has(i) && !value);
      cell.classList.toggle('hint-source', !!hintMove && hintMove.from === i); cell.classList.toggle('hint-target', !!hintMove && hintMove.to === i);
      cell.classList.toggle('last-destination', !!lastMove && lastMove.to === i);
      cell.dataset.value = value; cell.dataset.result = targets.includes(i) ? `→${Math.abs(b[selected] - value)}` : '';
      cell.children[0].textContent = value || '';
      cell.children[1].textContent = !value ? '' : value >= n ? '受け' : dest.length ? dest.map(to => Math.floor(to / n) < Math.floor(i / n) ? '↑' : Math.floor(to / n) > Math.floor(i / n) ? '↓' : to > i ? '→' : '←').join('') : '·';
      cell.setAttribute('aria-label', `${coord(i, n)}、${value ? `数字${value}、${dest.length ? `${dest.length}方向に移動可能` : '現在は移動先なし'}` : '空きマス'}${targets.includes(i) ? `、着地すると${Math.abs(b[selected] - value)}` : ''}`);
      cell.setAttribute('aria-pressed', String(i === selected)); cell.tabIndex = value ? 0 : -1;
    });
    $('board').setAttribute('aria-busy', String(locked)); $('board').classList.toggle('board-clear', A.count(b) === 0);
    $('remaining').textContent = A.count(b); $('move-count').textContent = history.length;
    $('puzzle-label').textContent = p.label; $('puzzle-title').textContent = p.title; $('puzzle-tip').textContent = p.tip;
    $('board-size').textContent = `${n} × ${n}`; $('board-number').textContent = p.mode === 'journey' ? String(p.level).padStart(2, '0') : p.mode === 'daily' ? 'DAY' : '∞';
    $('board-phase').textContent = A.count(b) === 0 ? 'ABSOLUTE ZERO' : A.status(b, n) === 'stuck' ? 'NO MORE MOVES' : 'MAKE IT ZERO';
    $('board-footer-text').textContent = hintMove ? '点滅する駒から、点線の駒へ' : '数字と同じ距離だけ、上下左右へ';
    $('undo').disabled = !history.length || locked; $('redo').disabled = !redo.length || locked;
    $('restart').disabled = locked; $('hint').disabled = searching || locked || A.count(b) === 0;
    $('hint').querySelector('span').textContent = searching ? '考え中…' : hintMove ? 'ヒント表示中' : 'ヒント';
    document.querySelectorAll('[data-mode]').forEach(el => { const active = el.dataset.mode === p.mode; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
    let text;
    if (A.count(b) === 0) text = '<strong>すべてが、ゼロになりました。</strong>';
    else if (selected >= 0) text = targets.length ? `<strong>${b[selected]}</strong> は ${b[selected]}マス先へ。枠のある駒をタップ。` : `<strong>${b[selected]}</strong> に着地先がありません。別の駒から重ねる方法を。`;
    else text = '駒を選んで、着地する駒をタップ。スワイプも使えます。';
    $('selection-info').innerHTML = icon('arrow') + `<span>${text}</span>`;
    renderStatus(); renderProgress();
  }
  function renderProgress() {
    const cleared = Object.keys(store.records).filter(k => /^AZ1-J\d{2}$/.test(k)).length;
    $('progress-text').textContent = `${cleared} / 60`; $('progress-bar').style.width = `${cleared / 60 * 100}%`;
    $('journey-note').textContent = cleared === 60 ? '60の航路、すべてがゼロに。' : cleared ? `${cleared}の盤面に、何もない場所をつくりました。` : '急がなくていい。ひとつずつ、無へ。';
  }
  function renderStatus() {
    const panel = $('status-panel'), st = A.status(state.board, state.puzzle.size);
    panel.hidden = true; panel.className = 'status-panel'; panel.innerHTML = '';
    if (st === 'won') { panel.hidden = false; panel.classList.add('success'); panel.innerHTML = `<p><strong>ZERO. 全消し達成。</strong></p><button class="small-button" data-action="result">結果を見る</button>`; }
    else if (st === 'stuck') { panel.hidden = false; panel.classList.add('warning'); panel.innerHTML = '<p><strong>これ以上、動かせる駒がありません。</strong><br>この挑戦は行き止まりです。1手戻すか、最初から再挑戦できます。</p>'; }
    else if (searching) { panel.hidden = false; panel.innerHTML = '<p>この局面から、全消しまでの経路を確認しています。</p><button class="small-button" data-action="cancel-search">探索を止める</button>'; }
    else if (hintMove) {
      panel.hidden = false; panel.classList.add('hint-panel'); const a = state.board[hintMove.from], b = state.board[hintMove.to], n = state.puzzle.size;
      panel.innerHTML = `<p><strong>${coord(hintMove.from, n)} の ${a} → ${coord(hintMove.to, n)} の ${b}</strong><br>|${a} − ${b}| = ${Math.abs(a - b)}。この一手の先に、全消しの経路があります。</p><button class="small-button" data-action="hide-hint">ヒントを隠す</button>`;
    } else if (analysisResult) {
      panel.hidden = false; panel.classList.add('warning');
      panel.innerHTML = `<p>${analysisResult === 'unsolvable' ? '<strong>この局面からの全消し経路はありません。</strong><br>探索で確認しました。戻って別の順序を試しましょう。' : '<strong>制限内では解答経路を確認できませんでした。</strong><br>解けないという判定ではありません。解答が確認済みの局面へ戻れます。'}</p><button class="small-button" data-action="rewind-safe">解答のある局面へ戻る</button>`;
    }
  }
  function selectCell(index) {
    if (locked || searching || $('modal').open || !state.board[index]) return;
    if (selected >= 0 && selected !== index && A.destinations(state.board, state.puzzle.size, selected).includes(index)) { performMove({ from: selected, to: index }); return; }
    selected = selected === index ? -1 : index; render();
  }
  function sound(kind, value = 1) {
    if (!store.settings.sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
      if (!audioContext) audioContext = new Audio(); if (audioContext.state === 'suspended') audioContext.resume();
      const base = kind === 'clear' ? 392 : kind === 'zero' ? 523.25 : 220 + value * 22;
      const notes = kind === 'clear' ? [1, 1.25, 1.5, 2] : kind === 'zero' ? [1, 1.5] : [1];
      notes.forEach((mult, i) => { const t = audioContext.currentTime + i * .10, o = audioContext.createOscillator(), gain = audioContext.createGain(); o.type = 'sine'; o.frequency.value = base * mult; gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(.055, t + .012); gain.gain.exponentialRampToValueAtTime(.001, t + .28); o.connect(gain); gain.connect(audioContext.destination); o.start(t); o.stop(t + .31); });
    } catch (_) {}
  }
  function animateMove(fromRect, toRect, a, zero) {
    if (reducedMotion()) return;
    const ghost = document.createElement('span'); ghost.className = 'ghost-tile'; ghost.textContent = a;
    Object.assign(ghost.style, { left: `${fromRect.left}px`, top: `${fromRect.top}px`, width: `${fromRect.width}px`, height: `${fromRect.height}px` });
    document.body.append(ghost); ghost.getBoundingClientRect();
    ghost.style.transform = `translate(${toRect.left - fromRect.left}px,${toRect.top - fromRect.top}px) scale(.85)`; ghost.style.opacity = '.05';
    setTimeout(() => { ghost.remove(); if (!zero) return; for (let i = 0; i < 8; i++) { const s = document.createElement('span'); s.className = 'spark'; s.style.left = `${toRect.left + toRect.width / 2}px`; s.style.top = `${toRect.top + toRect.height / 2}px`; s.style.setProperty('--dx', `${Math.cos(i * Math.PI / 4) * 36}px`); s.style.setProperty('--dy', `${Math.sin(i * Math.PI / 4) * 36}px`); document.body.append(s); setTimeout(() => s.remove(), 510); } }, 190);
  }
  function performMove(move, replay = false) {
    if (locked || $('modal').open) return false;
    const n = state.puzzle.size;
    if (!A.destinations(state.board, n, move.from).includes(move.to)) { toast('数字と同じ距離に、着地する駒が必要です。'); return false; }
    const fromRect = cells[move.from].getBoundingClientRect(), toRect = cells[move.to].getBoundingClientRect();
    const a = state.board[move.from], zero = a === state.board[move.to];
    cancelSearch(); hintMove = null; analysisResult = null;
    state.board = A.apply(state.board, n, move); state.history.push({ from: move.from, to: move.to });
    if (!replay) state.redo = []; selected = -1; locked = true; const token = revision;
    render(); saveSession(); sound(zero ? 'zero' : 'move', state.board[move.to]); animateMove(fromRect, toRect, a, zero);
    setTimeout(() => { if (token !== revision) return; locked = false; render(); checkEnd(); }, reducedMotion() ? 0 : 205);
    return true;
  }
  function undo() {
    if (locked || !state.history.length || $('modal').open) return;
    cancelSearch(); clearTimeout(winTimer); state.redo.push(state.history.pop()); state.board = boardAfter(state.history);
    state.stats.undos++; state.winShown = false; selected = -1; hintMove = null; analysisResult = null; render(); saveSession();
  }
  function redo() {
    if (locked || !state.redo.length || $('modal').open) return;
    const move = state.redo.pop(); if (!performMove(move, true)) state.redo.push(move);
  }
  function restart() {
    closeDialog(); cancelSearch(); clearTimeout(winTimer); state.board = state.puzzle.board.slice(); state.history = []; state.redo = [];
    state.stats.restarts++; state.winShown = false; selected = -1; hintMove = null; analysisResult = null; locked = false; render(); saveSession(); toast('最初の盤面に戻りました。');
  }
  function confirmRestart() {
    openDialog('最初から、考え直す？', '<p>この問題の駒を初期配置に戻します。クリア済みの記録は残ります。ヒントと戻した回数は、この挑戦の記録に引き継がれます。</p><div class="dialog-buttons"><button class="primary-button secondary-button" data-action="close">続ける</button><button class="primary-button" data-action="restart-confirm">最初から</button></div>');
  }
  function rewindSafe() {
    cancelSearch(); clearTimeout(winTimer);
    let b = state.puzzle.board.slice(), safeHistory = [], best = b, steps = 0;
    for (let i = 0; i < state.history.length; i++) { b = A.apply(b, state.puzzle.size, state.history[i]); if (known.has(A.key(b)) && i + 1 < state.history.length) { safeHistory = state.history.slice(0, i + 1); best = b; steps = i + 1; } }
    const rewound = state.history.length - steps; state.stats.undos += rewound; state.history = safeHistory; state.board = best; state.redo = [];
    selected = -1; hintMove = null; analysisResult = null; state.winShown = false; render(); saveSession(); toast(`${rewound}手戻しました。この局面からは全消しできます。`);
  }
  function showHint(path) {
    if (!path.length) return;
    if (!A.validateSolution(state.board, state.puzzle.size, path)) { analysisResult = 'limit'; render(); return; }
    const extra = A.certificate(state.board, state.puzzle.size, path); for (const [k, v] of extra) known.set(k, v);
    hintMove = path[0]; selected = -1; state.stats.hints++; analysisResult = null; render(); saveSession();
  }
  function requestHint() {
    if (locked || searching || $('modal').open || A.count(state.board) === 0) return;
    if (hintMove) { hintMove = null; render(); return; }
    const cached = known.get(A.key(state.board)); if (cached) { showHint(cached); return; }
    cancelSearch(); searching = true; selected = -1; analysisResult = null; const token = revision; render();
    try {
      // A local Blob worker keeps the single-file edition self-contained and the main UI responsive.
      const source = `const AZ=(${window.AZFactory.toString()})();self.onmessage=function(e){try{const d=e.data;self.postMessage(AZ.solve(d.board,d.size,{known:d.known,maxNodes:220000,budgetMs:4500}));}catch(e){self.postMessage({status:'error',message:String(e.message)});}};`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      solver = new Worker(url); URL.revokeObjectURL(url);
      solver.onmessage = ({ data }) => { if (revision !== token) return; solver.terminate(); solver = null; searching = false; if (data.status === 'solved') showHint(data.moves); else { analysisResult = data.status === 'unsolvable' ? 'unsolvable' : 'limit'; render(); } };
      solver.onerror = () => { if (revision !== token) return; cancelSearch(); analysisResult = 'limit'; render(); toast('このブラウザでは探索を完了できませんでした。解答のある局面へ戻せます。'); };
      solver.postMessage({ board: state.board, size: state.puzzle.size, known: [...known] });
    } catch (_) { cancelSearch(); analysisResult = 'limit'; render(); }
  }
  function starsFor(stats) { return 1 + (stats.hints === 0 ? 1 : 0) + (stats.undos === 0 && stats.restarts === 0 ? 1 : 0); }
  function checkEnd() {
    if (A.status(state.board, state.puzzle.size) !== 'won') return;
    if (!state.awarded) {
      const code = state.puzzle.code, old = store.records[code];
      store.records[code] = { stars: Math.max(starsFor(state.stats), old?.stars || 0), bestTime: Math.min(state.stats.elapsed, old?.bestTime ?? Infinity), bestMoves: Math.min(state.history.length, old?.bestMoves ?? Infinity), clears: (old?.clears || 0) + 1 };
      if (state.puzzle.mode === 'daily' && state.puzzle.date === A.tokyoDate() && !store.dailyWins.includes(state.puzzle.date)) store.dailyWins.push(state.puzzle.date);
      state.awarded = true; saveSession(); renderProgress(); sound('clear');
    }
    if (!state.winShown) { state.winShown = true; winTimer = setTimeout(showWin, reducedMotion() ? 20 : 400); }
  }
  function openDialog(title, html) { lastFocus = document.activeElement; $('modal-title').textContent = title; $('modal-body').innerHTML = html; if (!$('modal').open) $('modal').showModal(); lastTick = Date.now(); }
  function closeDialog() { if ($('modal').open) $('modal').close(); lastTick = Date.now(); }
  function showWin() {
    if (A.status(state.board, state.puzzle.size) !== 'won') return;
    const { puzzle: p, stats, history } = state, stars = starsFor(stats);
    const nextText = p.mode === 'journey' && p.level < 60 ? '次の航路へ' : p.mode === 'journey' ? '60の航路を見る' : p.mode === 'daily' ? '別の難易度へ' : '新しい盤面へ';
    openDialog('何もない。その達成感。', `<div class="win-heading"><div class="win-zero">0</div><p>${esc(p.label)} · 全消し達成</p></div><div class="win-stars" aria-label="星${stars}個">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div><div class="stats-grid"><div class="stat"><strong>${history.length}</strong><span>手で全消し</span></div><div class="stat"><strong>${formatTime(stats.elapsed)}</strong><span>考えた時間</span></div><div class="stat"><strong>${stats.hints}</strong><span>ヒント</span></div></div><div class="award-list"><span class="earned">✓ 全消し</span><span class="${stats.hints === 0 ? 'earned' : ''}">${stats.hints === 0 ? '✓' : '·'} ヒントなし</span><span class="${stats.undos + stats.restarts === 0 ? 'earned' : ''}">${stats.undos + stats.restarts === 0 ? '✓' : '·'} 戻しなし</span></div><p style="text-align:center;font-size:10px">星は解き方の記録です。手数の最小値を表すものではありません。</p><div class="dialog-buttons single"><button class="primary-button" data-action="next">${nextText}${icon('arrow')}</button></div><div class="dialog-buttons"><button class="primary-button secondary-button" data-action="replay">もう一度</button><button class="primary-button secondary-button" data-action="share-result">結果をシェア</button></div>`);
  }
  function showRules() {
    openDialog('数字で跳び、差で消す。', `<p class="dialog-intro">目標は、盤面のすべての駒を消すこと。新しい駒は増えません。時間制限もありません。</p><div class="rule-row"><span class="rule-number">01</span><div><h3>数字と同じ距離だけ、跳ぶ。</h3><p>「3」は上下左右の3マス先へ。斜め移動や、途中で止まる移動はできません。間にいる駒は飛び越えます。</p></div></div><div class="rule-row"><span class="rule-number">02</span><div><h3>別の駒にだけ、着地できる。</h3><p>駒をタップすると、着地できる駒が枠で表示されます。行き先をタップするか、動かす駒から上下左右へスワイプしてください。空きマスには着地できません。</p></div></div><div class="rule-formula">| 5 − 2 | = 3<small>着地したマスに、差の絶対値が残ります。</small></div><div class="rule-row"><span class="rule-number">03</span><div><h3>同じ数字なら、どちらも消える。</h3><p>「3」と「3」ならゼロ。最後の一組は、同じ数字の距離だけ離れた同数の駒にする必要があります。</p></div></div><div class="rule-row"><span class="rule-number">04</span><div><h3>動けなくなったら、順序を考え直す。</h3><p>駒が残り、合法手がなくなると行き止まり。「1手戻す」で戻れます。ヒントは、全消し経路を確認できた場合だけ提示します。</p></div></div><div class="rule-row"><span class="rule-number">05</span><div><h3>「受け」の駒は、着地点。</h3><p>5×5の「5〜9」、6×6の「6〜9」、7×7の「7〜9」は盤外に出てしまうため自力では動けません。他の駒を重ねて、小さな数字に変えられます。</p></div></div><p>PC：駒を選択して矢印キーで移動。U / Ctrl+Zで戻す、Shift+Ctrl+Zで再実行、Hでヒント、Escで選択解除。TabとEnterでも操作できます。</p><button class="primary-button" data-action="close">盤面へ戻る${icon('arrow')}</button>`);
  }
  function showJourney() {
    const blocks = A.CHAPTERS.map((ch, ci) => `<section class="chapter-block"><div class="chapter-title"><span>${String(ci + 1).padStart(2, '0')} / ${ch.name}</span><small>${ch.size}×${ch.size} · ${ch.word}</small></div><div class="level-grid">${Array.from({ length: 10 }, (_, j) => { const l = ci * 10 + j + 1, code = `AZ1-J${String(l).padStart(2, '0')}`, rec = store.records[code]; return `<button class="level-choice ${rec ? 'cleared' : ''} ${state.puzzle.code === code ? 'current' : ''}" data-action="level" data-level="${l}" aria-label="航路${l}${rec ? `、星${rec.stars}個でクリア済み` : '、未クリア'}">${String(l).padStart(2, '0')}<small>${rec ? '★'.repeat(rec.stars) + '·'.repeat(3 - rec.stars) : '—'}</small></button>`; }).join('')}</div></section>`).join('');
    openDialog('60の航路。ゼロへの旅。', `<p class="dialog-intro">最初の4面でルールを体験。好きな面から挑戦できます。緑色はクリア済みです。</p>${blocks}`);
  }
  function showDaily() {
    const date = A.tokyoDate();
    openDialog('今日の、ゼロ。', `<p class="dialog-intro">${date.replace(/-/g, '.')} / 日本時間 UTC+9<br>3つの盤面から選べます。同じ日・難易度・版の問題は、全員共通です。</p><div class="mode-options">${['静かな一手', '思考の散歩', '深い余白'].map((name, tier) => { const code = `AZ1-D${date.replace(/-/g, '')}-${tier + 1}`, rec = store.records[code]; return `<button class="option-button ${state.puzzle.code === code ? 'selected' : ''}" data-action="daily" data-tier="${tier}"><strong>${tier + 5}×${tier + 5}</strong><span>${name}</span><small>${rec ? '★'.repeat(rec.stars) : '未クリア'}</small></button>`; }).join('')}</div><p>更新は日本時間0時です。プレイ中の盤面は勝手に切り替わりません。更新後はデイリータブから新しい問題を選べます。</p>`);
  }
  function newSeed() {
    try { const bytes = new Uint32Array(2); crypto.getRandomValues(bytes); return (bytes[0].toString(36) + bytes[1].toString(36)).slice(0, 10).toUpperCase(); }
    catch (_) { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(-10).toUpperCase(); }
  }
  function showFree() {
    openDialog('好きなだけ、考える。', '<p class="dialog-intro">新しい盤面を生成します。すべてに検証済みの解答経路があります。途中の問題は自動保存されます。</p><div class="mode-options">' + [5, 6, 7].map((n, i) => `<button class="option-button" data-action="free" data-size="${n}"><strong>${n}×${n}</strong><span>${['ひと息', 'じっくり', '深く'][i]}</span><small>${[12, 19, 27][i]}枚を目標に生成</small></button>`).join('') + '</div><div class="dialog-divider"></div><label class="input-label" for="puzzle-code">友だちの問題コードを入力</label><input id="puzzle-code" class="code-input" maxlength="32" placeholder="AZ1-F5-ZERO" autocapitalize="characters" autocomplete="off" spellcheck="false"><div class="dialog-buttons single"><button class="primary-button" data-action="load-code">この問題を開く</button></div><p style="font-size:10px">AZ1-J01、AZ1-D20260907-2 など、航路やデイリーのコードも使えます。</p>');
  }
  function streak() {
    let d = A.tokyoDate(), n = 0; const dates = new Set(store.dailyWins);
    if (!dates.has(d)) d = new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10);
    while (dates.has(d)) { n++; d = new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10); } return n;
  }
  function showSettings() {
    const records = Object.values(store.records), cleared = Object.keys(store.records).filter(k => /^AZ1-J\d{2}$/.test(k)).length;
    openDialog('自分のペースで。', `<div class="stats-grid"><div class="stat"><strong>${cleared}</strong><span>航路クリア / 60</span></div><div class="stat"><strong>${records.reduce((s, r) => s + r.clears, 0)}</strong><span>全消し回数</span></div><div class="stat"><strong>${streak()}</strong><span>デイリー連続日数</span></div></div><label class="setting-row"><span>サウンド<small>駒が重なる、控えめな音。</small></span><input class="switch" type="checkbox" data-setting="sound" ${store.settings.sound ? 'checked' : ''}></label><label class="setting-row"><span>ダークモード<small>盤面は高コントラストのまま。</small></span><input class="switch" type="checkbox" data-setting="dark" ${store.settings.dark ? 'checked' : ''}></label><label class="setting-row"><span>アニメーション<small>端末の「視差効果を減らす」設定も尊重します。</small></span><input class="switch" type="checkbox" data-setting="motion" ${store.settings.motion ? 'checked' : ''}></label><div class="dialog-divider"></div><p>記録はこのブラウザ内に保存します。端末間の同期はありません。途中の盤面は直近20件まで保存し、クリア記録は別に保持します。</p><div class="settings-links"><button class="small-button" data-action="export">記録を書き出す</button><button class="small-button" data-action="import">記録を読み込む</button><button class="small-button" data-action="install-help">ホーム画面に追加</button><button class="small-button" data-action="resume">保存中の問題を開く</button></div>${waitingWorker ? '<p><button class="primary-button" data-action="update">新しい版を適用して再読み込み</button></p>' : ''}<button class="danger-link" data-action="reset-data">このゲームの記録を削除する</button><p style="font-size:10px">広告・解析・外部フォント・アカウント・APIキーは使用しません。デイリー連続日数は、その日の問題を当日に解いた記録です。端末時計の変更を検証するサーバーはありません。</p>`);
  }
  function showResume() {
    const sessions = Object.values(store.sessions).reverse().filter(s => !s.awarded);
    openDialog('考えかけの、続きを。', `<p class="dialog-intro">直近20件のうち、未クリアの盤面です。</p>${sessions.map(s => `<button class="primary-button secondary-button" style="margin:8px 0" data-action="resume-code" data-code="${esc(s.code)}">${esc(s.code)} · ${s.history.length}手目${icon('arrow')}</button>`).join('') || '<p>保存中の問題はありません。</p>'}`);
  }
  function showAbout() {
    openDialog('Absolute Zero', '<p>数字と同じ距離を跳び、引き算の絶対値で駒を重ねるロジックパズル。提示されたゲームルールをもとに、新規に実装したバージョン1.0.1です。</p><p><strong>実装・配布：MIT License</strong><br>Copyright (c) 2026 Absolute Zero contributors<br>第三者製のゲームコード・画像・音楽・フォントは同梱していません。効果音はブラウザ内で合成します。</p><p>市場での唯一性、商標の使用可能性、第三者権利の不存在は保証していません。タイトルを含む独自性の調査は別途必要です。</p><p>通常問題60面、デイリー3段階、自由演習。生成問題には、初期盤面を全消しできる検証済みの手順を付けています。すべての合法手が正解につながるわけではありません。</p><p style="font-size:11px">コード体系 AZ1 / 日本時間 UTC+9 / ローカル保存のみ</p><button class="primary-button" data-action="close">盤面へ戻る</button>');
  }
  function shareText(result = false) {
    const p = state.puzzle; let text = `ABSOLUTE ZERO\n${p.label}\n`;
    if (result && A.count(state.board) === 0) { const stars = starsFor(state.stats); text += `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} ${state.history.length}手で全消し\nヒント ${state.stats.hints} / 戻し ${state.stats.undos} / 再開 ${state.stats.restarts}\n`; }
    text += `問題コード：${p.code}`;
    if (isHttp && !['localhost', '127.0.0.1'].includes(location.hostname)) { const url = new URL(location.href); url.search = ''; url.searchParams.set('p', p.code); url.hash = ''; text += `\n${url.href}`; }
    return text;
  }
  function showShare(result = false) {
    const text = shareText(result);
    openDialog(result ? 'ゼロになった、記録。' : '同じ盤面で、考えよう。', `<p>コードを受け取った相手は、自由演習のコード入力から同じ問題を開けます。解答手順は含みません。</p><textarea id="share-text" class="share-area" readonly>${esc(text)}</textarea><div class="dialog-buttons"><button class="primary-button" data-action="copy">コピーする</button><button class="primary-button secondary-button" data-action="native-share">共有メニュー</button></div>`);
  }
  function exportData() {
    saveSession(); const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `absolute-zero-save-${A.tokyoDate()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); toast('記録を書き出しました。');
  }
  function importData() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('保存ファイルは2MB以内にしてください。');
        pendingImport = sanitizeStore(JSON.parse(await file.text()), true);
        openDialog('この記録に入れ替える？', `<p>読み込む記録：${Object.keys(pendingImport.records).length}問題のクリア、${Object.keys(pendingImport.sessions).length}件の途中盤面。</p><p>現在の記録に上書きします。必要なら、先に現在の記録を書き出してください。</p><div class="dialog-buttons"><button class="primary-button secondary-button" data-action="close">やめる</button><button class="primary-button" data-action="confirm-import">入れ替える</button></div>`);
      } catch (err) { pendingImport = null; toast(`読み込めません：${err.message}`); }
    }; input.click();
  }
  function changeMode(mode) {
    if (locked) return;
    if (mode === state.puzzle.mode) { if (mode === 'journey') showJourney(); else if (mode === 'daily') showDaily(); else showFree(); return; }
    if (mode === 'journey') { const code = store.lastMode.journey || 'AZ1-J01'; loadPuzzle(A.fromCode(code)); }
    else if (mode === 'daily') showDaily(); else showFree();
  }
  function nextPuzzle() {
    closeDialog(); const p = state.puzzle;
    if (p.mode === 'journey' && p.level < 60) loadPuzzle(A.journey(p.level + 1));
    else if (p.mode === 'journey') showJourney(); else if (p.mode === 'daily') showDaily(); else loadPuzzle(A.free(p.size, newSeed()));
  }
  async function handleAction(button) {
    const action = button.dataset.action;
    switch (action) {
      case 'close': closeDialog(); break;
      case 'level': closeDialog(); loadPuzzle(A.journey(Number(button.dataset.level))); break;
      case 'daily': closeDialog(); loadPuzzle(A.daily(A.tokyoDate(), Number(button.dataset.tier))); break;
      case 'free': closeDialog(); loadPuzzle(A.free(Number(button.dataset.size), newSeed())); break;
      case 'load-code': { try { const p = A.fromCode($('puzzle-code').value); closeDialog(); loadPuzzle(p); } catch (e) { toast(e.message); } break; }
      case 'restart-confirm': restart(); break;
      case 'cancel-search': cancelSearch(); render(); break;
      case 'hide-hint': hintMove = null; render(); break;
      case 'rewind-safe': rewindSafe(); break;
      case 'result': showWin(); break;
      case 'next': nextPuzzle(); break;
      case 'replay': { const p = state.puzzle; closeDialog(); loadPuzzle(p, { fresh: true }); break; }
      case 'share-result': showShare(true); break;
      case 'copy': {
        const text = $('share-text').value;
        try { if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable'); await navigator.clipboard.writeText(text); toast('コピーしました。'); }
        catch (_) { $('share-text').focus(); $('share-text').select(); toast('共有文を選択しました。ブラウザの「コピー」を使ってください。'); } break;
      }
      case 'native-share': {
        if (navigator.share) try { await navigator.share({ title: 'Absolute Zero', text: $('share-text').value }); } catch (err) { if (err.name !== 'AbortError') toast('共有できませんでした。コピーを使ってください。'); }
        else toast('この環境では共有メニューを使えません。コピーを使ってください。'); break;
      }
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'confirm-import': {
        if (!pendingImport) break;
        cancelSearch(); clearTimeout(winTimer); state = null; store = pendingImport; pendingImport = null; applySettings(); persist(); closeDialog(); loadPuzzle(A.fromCode(store.current)); toast('記録を読み込みました。'); break;
      }
      case 'resume': showResume(); break;
      case 'resume-code': closeDialog(); loadPuzzle(A.fromCode(button.dataset.code)); break;
      case 'install-help': openDialog('ホーム画面から、すぐに。', '<p>iPhone：公開URLをSafariで開き、共有メニューから「ホーム画面に追加」を選んでください。</p><p>PC：対応ブラウザで公開URLを開き、アドレスバーやブラウザメニューのインストール機能を使います。</p><p>一度オンラインで読み込み、オフライン準備が完了すると、次回から通信なしでも遊べます。単体HTML版はPCのブラウザで開けますが、ホーム画面アプリのインストールとサービスワーカーは対象外です。</p><p>現在：<strong>' + (location.protocol === 'file:' ? 'ローカルファイル版' : navigator.serviceWorker?.controller ? 'オフライン用キャッシュ準備済み' : 'Web版・キャッシュ準備を確認中') + '</strong></p><button class="primary-button" data-action="close">閉じる</button>'); break;
      case 'reset-data': openDialog('このゲームの記録を削除する？', '<p>途中盤面・クリア記録・設定を削除します。他のサイトやゲームの記録には触れません。取り消せないため、必要な記録は先に書き出してください。</p><div class="dialog-buttons"><button class="primary-button secondary-button" data-action="close">やめる</button><button class="primary-button" data-action="confirm-reset">記録を削除</button></div>'); break;
      case 'confirm-reset': cancelSearch(); clearTimeout(winTimer); state = null; store = defaultStore(); try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} applySettings(); closeDialog(); loadPuzzle(A.journey(1)); toast('このゲームの記録だけを削除しました。'); break;
      case 'update': if (waitingWorker) { saveSession(); applyUpdate = true; waitingWorker.postMessage({ type: 'SKIP_WAITING' }); } break;
    }
  }
  // Pointer and swipe input: the jump length comes from the tile, not the swipe length.
  let gesture = null, ignoreClickUntil = 0;
  $('board').addEventListener('pointerdown', e => {
    const cell = e.target.closest('[data-index]');
    if (!cell || locked || searching || e.button > 0) return;
    gesture = { id: e.pointerId, from: Number(cell.dataset.index), x: e.clientX, y: e.clientY };
    try { cell.setPointerCapture(e.pointerId); } catch (_) {}
  });
  $('board').addEventListener('pointerup', e => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const g = gesture; gesture = null; const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    ignoreClickUntil = Date.now() + 400;
    if (locked || searching || !state.board[g.from]) return;
    if (Math.min(Math.abs(dx), Math.abs(dy)) > Math.max(Math.abs(dx), Math.abs(dy)) * .8) { toast('上下左右の、いずれかにスワイプしてください。'); return; }
    const n = state.puzzle.size, a = state.board[g.from], horizontal = Math.abs(dx) > Math.abs(dy);
    const dr = horizontal ? 0 : Math.sign(dy), dc = horizontal ? Math.sign(dx) : 0;
    const row = Math.floor(g.from / n) + dr * a, col = g.from % n + dc * a;
    selected = g.from;
    if (row < 0 || row >= n || col < 0 || col >= n || !A.destinations(state.board, n, g.from).includes(row * n + col)) { render(); toast('その方向の着地点には、駒がありません。'); return; }
    performMove({ from: g.from, to: row * n + col });
  });
  $('board').addEventListener('pointercancel', () => { gesture = null; });
  $('board').addEventListener('click', e => { if (Date.now() < ignoreClickUntil) return; const cell = e.target.closest('[data-index]'); if (cell) selectCell(Number(cell.dataset.index)); });
  $('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo); $('hint').addEventListener('click', requestHint); $('restart').addEventListener('click', confirmRestart);
  $('help').addEventListener('click', showRules); $('settings').addEventListener('click', showSettings); $('about').addEventListener('click', showAbout);
  $('share').addEventListener('click', () => showShare(A.count(state.board) === 0)); $('close-modal').addEventListener('click', closeDialog);
  $('choose-puzzle').addEventListener('click', () => state.puzzle.mode === 'journey' ? showJourney() : state.puzzle.mode === 'daily' ? showDaily() : showFree());
  $('brand').addEventListener('click', e => { e.preventDefault(); showJourney(); });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.mode)));
  document.addEventListener('click', e => { const button = e.target.closest('[data-action]'); if (button) handleAction(button).catch(err => toast(`操作を完了できませんでした：${err.message}`)); });
  $('modal').addEventListener('close', () => { lastTick = Date.now(); if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); });
  $('modal').addEventListener('change', e => { const key = e.target.dataset.setting; if (key && Object.hasOwn(store.settings, key)) { store.settings[key] = e.target.checked; applySettings(); persist(); if (key === 'sound' && e.target.checked) sound('move', 2); } });
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) { if (e.key === 'Enter' && e.target.id === 'puzzle-code') { e.preventDefault(); const btn = document.querySelector('[data-action="load-code"]'); if (btn) handleAction(btn); } return; }
    if ($('modal').open) return;
    if (locked) return;
    if (e.key === 'Escape') { selected = -1; hintMove = null; cancelSearch(); render(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'u') { e.preventDefault(); undo(); }
    if (e.key.toLowerCase() === 'h') { e.preventDefault(); requestHint(); }
    if (selected >= 0 && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault(); const [dr, dc] = A.DIRS[['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].indexOf(e.key)], n = state.puzzle.size, a = state.board[selected];
      const r = Math.floor(selected / n) + dr * a, c = selected % n + dc * a;
      if (r >= 0 && r < n && c >= 0 && c < n && A.destinations(state.board, n, selected).includes(r * n + c)) performMove({ from: selected, to: r * n + c }); else toast('その方向に着地できる駒はありません。');
    }
  });
  function tick() {
    const now = Date.now(), delta = Math.max(0, Math.min(2000, now - lastTick)); lastTick = now;
    if (state && !document.hidden && !$('modal').open && A.status(state.board, state.puzzle.size) === 'playing') state.stats.elapsed += delta;
    if (now - lastSaveTick > 10000) { lastSaveTick = now; saveSession(); }
  }
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { tick(); lastTick = Date.now(); saveSession(); });
  window.addEventListener('pagehide', () => { tick(); saveSession(); });
  applySettings();
  let puzzle;
  try { const code = new URLSearchParams(location.search).get('p'); puzzle = A.fromCode(code || store.current); }
  catch (_) { puzzle = A.journey(1); setTimeout(() => toast('問題コードを読み込めなかったため、航路01を開きました。'), 200); }
  loadPuzzle(puzzle);
  if (isHttp && 'serviceWorker' in navigator && !window.AZ_STANDALONE) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => {
      if (reg.waiting) waitingWorker = reg.waiting;
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { waitingWorker = w; toast('新しい版があります。設定から、記録を保存して更新できます。'); } }); });
    }).catch(() => { $('save-status').textContent = '自動保存・オフライン準備不可'; });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (applyUpdate) location.reload(); });
  }
  // Read-only diagnostics. No automatic play, mutation, secrets or network access.
  window.AbsoluteZero = Object.freeze({ version: '1.0.1', snapshot: () => JSON.parse(JSON.stringify({ code: state.puzzle.code, size: state.puzzle.size, board: state.board, history: state.history, redo: state.redo, stats: state.stats, status: A.status(state.board, state.puzzle.size), searching, hintMove, awarded: state.awarded })) });
})();
