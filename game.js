(() => {
  'use strict';

  // ============== 난이도 / 캐릭터 ==============
  const DIFFICULTIES = {
    easy:   { rows: 10, cols: 10, mines: 12, cellSize: 44, minGap: 3, maxWolves: 3 },
    normal: { rows: 16, cols: 16, mines: 40, cellSize: 36, minGap: 5, maxWolves: 4 },
    hard:   { rows: 20, cols: 20, mines: 75, cellSize: 30, minGap: 7, maxWolves: 5 },
  };

  const RESCUERS = ['🧑\u200D🚒', '👨\u200D🚒', '👩\u200D🚒', '🧑', '🙋\u200D♀️', '🙋\u200D♂️'];
  const WOLF = '🐺';
  const SPARKS = ['✨', '💖', '🌟', '💫', '💞'];
  const FOOTPRINTS = ['🐾'];

  // ============== DOM ==============
  const boardEl = document.getElementById('board');
  const mineCountEl = document.getElementById('mineCount');
  const timerEl = document.getElementById('timer');
  const difficultyEl = document.getElementById('difficulty');
  const wolvesEl = document.getElementById('wolves');
  const resetBtn = document.getElementById('resetBtn');
  const muteBtn = document.getElementById('muteBtn');
  const overlayEl = document.getElementById('overlay');
  const overlayIcon = document.getElementById('overlayIcon');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayMsg = document.getElementById('overlayMsg');
  const overlayBtn = document.getElementById('overlayBtn');

  // ============== 사운드 (Web Audio API로 생성, 외부 파일 없음) ==============
  const Sound = (() => {
    let ctx = null;
    let muted = false;

    const getCtx = () => {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    };

    const tone = ({
      freq = 440, type = 'sine', duration = 0.1, gain = 0.15,
      attack = 0.005, release = 0.08, freqEnd = null, delay = 0,
    }) => {
      if (muted) return;
      const ac = getCtx(); if (!ac) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
      }
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + release);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + duration + release + 0.05);
    };

    const noise = ({ duration = 0.3, gain = 0.3, filterFreq = 1200, delay = 0 }) => {
      if (muted) return;
      const ac = getCtx(); if (!ac) return;
      const t0 = ac.currentTime + delay;
      const len = Math.max(1, Math.floor(ac.sampleRate * duration));
      const buffer = ac.createBuffer(1, len, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter).connect(g).connect(ac.destination);
      src.start(t0);
      src.stop(t0 + duration + 0.05);
    };

    return {
      toggle() { muted = !muted; return muted; },
      isMuted: () => muted,
      // 첫 사용자 상호작용 시 오디오 컨텍스트 활성화
      warmup() { getCtx(); },

      click() { tone({ freq: 720, type: 'triangle', duration: 0.05, gain: 0.08, freqEnd: 920 }); },
      open()  { tone({ freq: 420, type: 'sine',     duration: 0.06, gain: 0.07, freqEnd: 620 }); },
      flag()  { tone({ freq: 540, type: 'square',   duration: 0.07, gain: 0.06, freqEnd: 760 }); },
      unflag(){ tone({ freq: 540, type: 'square',   duration: 0.07, gain: 0.06, freqEnd: 340 }); },
      step()  { tone({ freq: 260, type: 'sine',     duration: 0.05, gain: 0.05, freqEnd: 200 }); },

      boom() {
        noise({ duration: 0.7, gain: 0.55, filterFreq: 700 });
        tone ({ freq: 140, type: 'sawtooth', duration: 0.55, gain: 0.28, freqEnd: 35 });
        tone ({ freq: 80,  type: 'square',   duration: 0.35, gain: 0.18, freqEnd: 20, delay: 0.05 });
      },

      // 승리 팡파르 (C5 E5 G5 C6)
      win() {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => tone({
          freq: f, type: 'triangle', duration: 0.22, gain: 0.12, delay: i * 0.12,
        }));
      },

      // 늑대 울음: 저→고→저 글라이드 두 번
      howl() {
        tone({ freq: 520, type: 'sine', duration: 0.35, gain: 0.14, freqEnd: 820, delay: 0.00 });
        tone({ freq: 820, type: 'sine', duration: 0.55, gain: 0.14, freqEnd: 360, delay: 0.35 });
      },

      start() { tone({ freq: 440, type: 'triangle', duration: 0.1, gain: 0.08 }); },
    };
  })();

  // ============== 상태 ==============
  let state = null;

  const rand = n => Math.floor(Math.random() * n);
  const choice = arr => arr[rand(arr.length)];

  function createState(difficulty, wolfCount) {
    const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    const { rows, cols, mines, cellSize } = cfg;
    const numWolves = Math.max(1, Math.min(cfg.maxWolves, wolfCount | 0 || 1));

    // 유효한 보드가 나올 때까지 "시작점 재선정 + 재구성"을 반복한다.
    // (어떤 경우에도 초기부터 연결된 상태로 시작되지 않도록 외부 재시도 루프로 보증)
    const MAX_OUTER_RETRY = 30;
    let positions, posHuman, posWolves, forbid, board, mineCount;
    for (let attempt = 0; attempt < MAX_OUTER_RETRY; attempt++) {
      positions = pickStartPositions(rows, cols, numWolves + 1, cfg.minGap);
      posHuman = positions[0];
      posWolves = positions.slice(1);
      forbid = computeForbidSet(rows, cols, positions);

      board = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push({ mine: false, n: 0, open: false, flag: false });
        board.push(row);
      }

      mineCount = placeMines(rows, cols, board, forbid, mines);
      computeNumbers(rows, cols, board);

      const res = ensureInitialGap(rows, cols, board, forbid, mineCount, positions, mines, cfg.minGap);
      mineCount = res.mineCount;
      if (res.ok) break;
    }

    return {
      cfg, rows, cols, mines: mineCount, cellSize,
      numWolves,
      board, flags: 0,
      posHuman,
      posWolves,
      humanEmoji: choice(RESCUERS),
      wolfEmoji: WOLF,
      gameOver: false,
      won: false,
      timerStarted: false,
      timerId: null,
      seconds: 0,
      cellEls: [],
      humanEl: null,
      wolfEls: [],
      // 순차 구조 큐 상태
      rescued: new Array(numWolves).fill(false),
      inQueue: new Array(numWolves).fill(false),
      rescueQueue: [],
      rescuing: false,
      gap: 0,
    };
  }

  function computeForbidSet(rows, cols, positions) {
    const forbid = new Set();
    for (const [r, c] of positions) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) forbid.add(nr * cols + nc);
        }
      }
    }
    return forbid;
  }

  function placeMines(rows, cols, board, forbid, mineCount) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) board[r][c].mine = false;
    const available = [];
    for (let i = 0; i < rows * cols; i++) if (!forbid.has(i)) available.push(i);
    for (let i = available.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [available[i], available[j]] = [available[j], available[i]];
    }
    const count = Math.min(mineCount, available.length);
    for (let i = 0; i < count; i++) {
      const idx = available[i];
      board[Math.floor(idx / cols)][idx % cols].mine = true;
    }
    return count;
  }

  function computeNumbers(rows, cols, board) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c].mine) { board[r][c].n = 0; continue; }
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].mine) n++;
          }
        }
        board[r][c].n = n;
      }
    }
  }

  // 실제 게임 규칙(8방향 flood)대로 시작점에서 열리게 될 셀 집합을 계산한다.
  function simulateOpenSet(rows, cols, board, sr, sc) {
    const opened = Array.from({ length: rows }, () => new Array(cols).fill(false));
    if (board[sr][sc].mine) return opened;
    const stack = [[sr, sc]];
    while (stack.length) {
      const [r, c] = stack.pop();
      if (opened[r][c] || board[r][c].mine) continue;
      opened[r][c] = true;
      if (board[r][c].n === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (!opened[nr][nc] && !board[nr][nc].mine) stack.push([nr, nc]);
          }
        }
      }
    }
    return opened;
  }

  // 게임의 연결 판정(열린 셀 4방향 BFS)과 동일한 척도로 "영역 간 갭"을 측정한다.
  //   dist 0  => 두 열린 영역이 이미 4방향 인접/겹침 (= 시작하자마자 연결)
  //   dist k  => 4방향으로 닫힌 비지뢰 셀 k개를 열어야만 연결 가능
  //   dist ∞  => 지뢰 벽 때문에 연결 불가
  // 반환 path 는 "닫힌 비지뢰 셀"들의 4방향 경로 (지뢰 심기 후보).
  function closedGapBetween(rows, cols, board, openedA, openedB) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // 1) 이미 연결되어 있으면 dist 0.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (openedA[r][c] && openedB[r][c]) return { dist: 0, path: [] };
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!openedA[r][c]) continue;
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (openedB[nr][nc]) return { dist: 0, path: [] };
        }
      }
    }

    // 2) 닫힌 비지뢰 셀만 4방향으로 이동, openedA 경계 → openedB 경계 최단 거리.
    const dist = Array.from({ length: rows }, () => new Array(cols).fill(-1));
    const parent = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const isClosedSafe = (r, c) => !openedA[r][c] && !openedB[r][c] && !board[r][c].mine;
    const adjacent = (r, c, set) => dirs.some(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      return nr >= 0 && nr < rows && nc >= 0 && nc < cols && set[nr][nc];
    });

    const q = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isClosedSafe(r, c)) continue;
        if (adjacent(r, c, openedA)) { dist[r][c] = 1; q.push([r, c]); }
      }
    }
    while (q.length) {
      const [r, c] = q.shift();
      if (adjacent(r, c, openedB)) {
        const path = [];
        let cur = [r, c];
        while (cur) { path.push(cur); cur = parent[cur[0]][cur[1]]; }
        path.reverse();
        return { dist: dist[r][c], path };
      }
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (dist[nr][nc] !== -1) continue;
        if (!isClosedSafe(nr, nc)) continue;
        dist[nr][nc] = dist[r][c] + 1;
        parent[nr][nc] = [r, c];
        q.push([nr, nc]);
      }
    }
    return { dist: Infinity, path: null };
  }

  // 모든 시작점 쌍 중 worst 한 쌍을 반환한다.
  //   차단된 쌍(dist = Infinity)이 하나라도 있으면 그 쌍을 최우선으로 반환한다.
  //   그래야 "한 쌍을 잇느라 다른 쌍을 끊어먹는" 상황을 탐지해 롤백/재시도할 수 있다.
  //   차단 쌍이 없으면 dist 최소인 쌍을 반환한다.
  function findWorstPair(rows, cols, board, positions) {
    const opens = positions.map(([r, c]) => simulateOpenSet(rows, cols, board, r, c));
    let blocked = null;
    let best = { dist: Infinity, path: null, a: 0, b: 0 };
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const r = closedGapBetween(rows, cols, board, opens[i], opens[j]);
        if (r.dist === Infinity) {
          if (!blocked) blocked = { ...r, a: i, b: j };
        } else if (r.dist < best.dist) {
          best = { ...r, a: i, b: j };
        }
      }
    }
    return blocked || best;
  }

  // 모든 시작 영역 쌍의 "4방향 연결까지 닫힌 셀 거리"가 minGap 이상이 되도록 보정한다.
  //   dist < minGap && path 있음 → 경로 중간(닫힌 비지뢰 셀)에 지뢰 심기
  //   dist === 0 → 심을 닫힌 셀이 없음 → 지뢰 재배치
  //   dist === Infinity (벽으로 완전 차단) → 해당 변경 롤백
  // 반환: { mineCount, ok } — ok === true 면 minGap 조건 달성.
  function ensureInitialGap(rows, cols, board, forbid, mineCount, positions, targetMines, minGap) {
    const evaluate = () => findWorstPair(rows, cols, board, positions);

    // 1) 지뢰 재배치를 통한 해결
    const MAX_RESHUFFLE = 60;
    for (let i = 0; i < MAX_RESHUFFLE; i++) {
      const info = evaluate();
      if (info.dist !== Infinity && info.dist >= minGap) return { mineCount, ok: true };
      mineCount = placeMines(rows, cols, board, forbid, targetMines);
      computeNumbers(rows, cols, board);
    }

    // 2) 경로 중간에 지뢰를 심어 간격을 벌린다 (완전 분리 방지 위해 롤백 지원)
    const MAX_GUARD = 600;
    let reshuffleBudget = 40;
    for (let g = 0; g < MAX_GUARD; g++) {
      const info = evaluate();
      if (info.dist === Infinity) return { mineCount, ok: false };
      if (info.dist >= minGap) return { mineCount, ok: true };

      // dist === 0 이거나 path가 비어있다면 심을 후보가 없음 → 재배치
      if (!info.path || info.path.length === 0) {
        if (reshuffleBudget-- <= 0) return { mineCount, ok: false };
        mineCount = placeMines(rows, cols, board, forbid, targetMines);
        computeNumbers(rows, cols, board);
        continue;
      }

      const path = info.path;
      const mid = Math.floor(path.length / 2);
      let planted = false;
      for (let off = 0; off < path.length && !planted; off++) {
        for (const sign of [0, -1, 1]) {
          const idx = mid + sign * off;
          if (idx < 0 || idx >= path.length) continue;
          const [r, c] = path[idx];
          if (forbid.has(r * cols + c)) continue;
          if (board[r][c].mine) continue;

          board[r][c].mine = true;
          computeNumbers(rows, cols, board);
          const recheck = evaluate();
          if (recheck.dist === Infinity) {
            board[r][c].mine = false;
            computeNumbers(rows, cols, board);
            continue;
          }
          mineCount++;
          planted = true;
          break;
        }
      }
      if (!planted) {
        if (reshuffleBudget-- <= 0) return { mineCount, ok: false };
        mineCount = placeMines(rows, cols, board, forbid, targetMines);
        computeNumbers(rows, cols, board);
      }
    }
    return { mineCount, ok: false };
  }

  // 사람 + 늑구 N마리의 시작 위치를 서로 충분히 떨어뜨려 고른다.
  // 8이웃 forbid 영역이 겹치지 않도록 맨해튼 거리 최소 3 이상을 강제한다(완화 불가).
  // 이상적으로는 minGap 이상을 노리며 시도, 실패 시 점차 완화.
  function pickStartPositions(rows, cols, count, minGap) {
    const maxAttempts = 600;
    const minAllowed = 3;
    let minD = Math.max(minAllowed, Math.min(Math.floor(Math.min(rows, cols) / 2), (minGap | 0) + 1));

    while (minD >= minAllowed) {
      const positions = [];
      let ok = true;
      for (let i = 0; i < count; i++) {
        let placed = false;
        for (let a = 0; a < maxAttempts; a++) {
          const r = 1 + rand(rows - 2);
          const c = 1 + rand(cols - 2);
          if (positions.every(([pr, pc]) => Math.abs(pr - r) + Math.abs(pc - c) >= minD)) {
            positions.push([r, c]);
            placed = true;
            break;
          }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return positions;
      minD--;
    }

    // 완화 한계(= minAllowed)로도 전부 배치 못하면 그 제약 하에서 채운다.
    const positions = [];
    let safety = 5000;
    while (positions.length < count && safety-- > 0) {
      const r = 1 + rand(rows - 2);
      const c = 1 + rand(cols - 2);
      if (positions.every(([pr, pc]) => Math.abs(pr - r) + Math.abs(pc - c) >= minAllowed)) {
        positions.push([r, c]);
      }
    }
    return positions;
  }

  // ============== 렌더링 ==============
  function render() {
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--cell-size', state.cellSize + 'px');
    boardEl.style.gridTemplateColumns = `repeat(${state.cols}, var(--cell-size))`;
    boardEl.style.gridTemplateRows = `repeat(${state.rows}, var(--cell-size))`;

    state.cellEls = [];
    for (let r = 0; r < state.rows; r++) {
      const rowEls = [];
      for (let c = 0; c < state.cols; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.r = r;
        el.dataset.c = c;
        el.addEventListener('click', onLeftClick);
        el.addEventListener('contextmenu', onRightClick);
        boardEl.appendChild(el);
        rowEls.push(el);
      }
      state.cellEls.push(rowEls);
    }

    state.humanEl = makeActor(state.humanEmoji, 'human');
    boardEl.appendChild(state.humanEl);
    placeActor(state.humanEl, state.posHuman[0], state.posHuman[1]);

    state.wolfEls = state.posWolves.map(([r, c]) => {
      const el = makeActor(state.wolfEmoji, 'wolf');
      boardEl.appendChild(el);
      placeActor(el, r, c);
      return el;
    });

    floodOpen(state.posHuman[0], state.posHuman[1]);
    for (const [r, c] of state.posWolves) floodOpen(r, c);

    updateMineCount();
    updateTimer();
  }

  function makeActor(emoji, kind) {
    const d = document.createElement('div');
    d.className = `actor bounce ${kind}`;
    const halo = document.createElement('span');
    halo.className = 'halo';
    d.appendChild(halo);
    const em = document.createElement('span');
    em.className = 'emoji';
    em.textContent = emoji;
    d.appendChild(em);
    return d;
  }

  function cellPx(r, c) {
    const step = state.cellSize + state.gap;
    return { x: c * step, y: r * step };
  }

  function placeActor(el, r, c) {
    const { x, y } = cellPx(r, c);
    const t = `translate(${x}px, ${y}px)`;
    el.style.setProperty('--t', t);
    el.style.transform = t;
  }

  // ============== 입력 ==============
  function onLeftClick(e) {
    if (state.gameOver) return;
    Sound.warmup();
    const r = +e.currentTarget.dataset.r;
    const c = +e.currentTarget.dataset.c;
    const cell = state.board[r][c];
    startTimerIfNeeded();

    if (cell.flag) return;

    if (cell.open) {
      if (cell.n > 0) tryChord(r, c);
      return;
    }

    Sound.click();
    openCell(r, c);
    afterAction();
  }

  function onRightClick(e) {
    e.preventDefault();
    if (state.gameOver) return;
    Sound.warmup();
    const r = +e.currentTarget.dataset.r;
    const c = +e.currentTarget.dataset.c;
    const cell = state.board[r][c];
    startTimerIfNeeded();

    if (cell.open) return;
    cell.flag = !cell.flag;
    state.flags += cell.flag ? 1 : -1;
    if (cell.flag) Sound.flag(); else Sound.unflag();
    renderCell(r, c);
    updateMineCount();
  }

  function tryChord(r, c) {
    const cell = state.board[r][c];
    let flags = 0;
    const toOpen = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= state.rows || nc < 0 || nc >= state.cols) continue;
        const nb = state.board[nr][nc];
        if (nb.flag) flags++;
        else if (!nb.open) toOpen.push([nr, nc]);
      }
    }
    if (flags === cell.n && toOpen.length > 0) {
      Sound.click();
      for (const [nr, nc] of toOpen) {
        if (state.gameOver) break;
        openCell(nr, nc);
      }
      afterAction();
    }
  }

  // ============== 셀 열기 ==============
  function openCell(r, c) {
    const cell = state.board[r][c];
    if (cell.open || cell.flag) return;
    if (cell.mine) { triggerLose(r, c); return; }
    const opened = floodOpen(r, c);
    if (opened > 0) Sound.open();
  }

  function floodOpen(r, c) {
    let opened = 0;
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const cell = state.board[cr][cc];
      if (cell.open || cell.flag || cell.mine) continue;
      cell.open = true;
      opened++;
      renderCell(cr, cc);
      if (cell.n === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
              const nb = state.board[nr][nc];
              if (!nb.open && !nb.mine && !nb.flag) stack.push([nr, nc]);
            }
          }
        }
      }
    }
    return opened;
  }

  function renderCell(r, c) {
    const el = state.cellEls[r][c];
    const cell = state.board[r][c];
    el.className = 'cell';
    el.innerHTML = '';
    if (cell.open) {
      el.classList.add('open');
      if (cell.n > 0 && !cell.mine) {
        const s = document.createElement('span');
        s.className = 'num num-' + cell.n;
        s.textContent = cell.n;
        el.appendChild(s);
      }
    } else if (cell.flag) {
      el.classList.add('flag');
    }
  }

  function afterAction() {
    if (state.gameOver) return;
    scanAndQueueRescues();
    if (!state.rescuing) startNextRescue();
  }

  // ============== 연결 검사 & 구조 큐 ==============
  // 사람에서 BFS, 각 미구조 늑구가 연결되어 있으면 큐에 추가한다.
  function scanAndQueueRescues() {
    if (state.rescued.every(Boolean)) return;
    const [sr, sc] = state.posHuman;
    const rows = state.rows, cols = state.cols;
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const parent = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const q = [[sr, sc]];
    visited[sr][sc] = true;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (q.length) {
      const [r, c] = q.shift();
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (visited[nr][nc]) continue;
        const nb = state.board[nr][nc];
        if (!nb.open || nb.mine) continue;
        visited[nr][nc] = true;
        parent[nr][nc] = [r, c];
        q.push([nr, nc]);
      }
    }
    state.posWolves.forEach(([wr, wc], i) => {
      if (state.rescued[i] || state.inQueue[i]) return;
      if (!visited[wr][wc]) return;
      const path = [];
      let cur = [wr, wc];
      while (cur) { path.push(cur); cur = parent[cur[0]][cur[1]]; }
      path.reverse(); // 사람 → 늑구
      state.inQueue[i] = true;
      state.rescueQueue.push({ wolfIdx: i, path });
    });
    // 한 번에 여러 마리가 연결된 경우 짧은 경로(= 먼저 길이 열린 느낌)부터 구조한다.
    state.rescueQueue.sort((a, b) => a.path.length - b.path.length);
  }

  function startNextRescue() {
    if (state.gameOver) return;
    if (state.rescueQueue.length === 0) {
      if (state.rescued.every(Boolean)) finalizeWin();
      return;
    }
    const { wolfIdx, path } = state.rescueQueue.shift();
    state.rescuing = true;
    for (const [r, c] of path) state.cellEls[r][c].classList.add('path');
    animateWolfRescue(wolfIdx, path, () => {
      state.rescued[wolfIdx] = true;
      state.rescuing = false;
      onOneRescued(wolfIdx);
      startNextRescue();
    });
  }

  // 한 마리가 사람에게 도착하는 애니메이션
  function animateWolfRescue(wolfIdx, path, onDone) {
    const wolfPath = path.slice().reverse(); // 늑구 시작점 → 사람
    const stepMs = Math.max(95, 260 - wolfPath.length * 7);
    let i = 1; // 0은 현재 위치
    const tick = () => {
      if (state.gameOver) { onDone(); return; }
      if (i >= wolfPath.length) { onDone(); return; }
      const [r, c] = wolfPath[i];
      placeActor(state.wolfEls[wolfIdx], r, c);
      spawnFootprint(r, c);
      Sound.step();
      i++;
      setTimeout(tick, stepMs);
    };
    setTimeout(tick, stepMs);
  }

  // 한 마리 구조 완료 시의 연출
  function onOneRescued(wolfIdx) {
    Sound.howl();
    const [hr, hc] = state.posHuman;
    for (let i = 0; i < 4; i++) setTimeout(() => spawnSpark(hr, hc), i * 70);
    state.wolfEls[wolfIdx].classList.remove('bounce');
    state.wolfEls[wolfIdx].classList.add('meet');
  }

  function finalizeWin() {
    state.gameOver = true;
    state.won = true;
    stopTimer();
    Sound.win();

    state.humanEl.classList.remove('bounce');
    state.humanEl.classList.add('meet');

    const [hr, hc] = state.posHuman;
    const sparkCount = 6 + state.numWolves * 2;
    for (let i = 0; i < sparkCount; i++) setTimeout(() => spawnSpark(hr, hc), i * 60);

    const N = state.numWolves;
    const title = N > 1 ? `늑구 ${N}마리 모두 구조 성공!` : '늑구 구조 성공!';
    const msg = N > 1
      ? `${state.humanEmoji} 가 ${state.wolfEmoji}×${N} 를 모두 무사히 구출했어요! (${state.seconds}초)`
      : `${state.humanEmoji} 가 ${state.wolfEmoji} 를 무사히 구출했어요! (${state.seconds}초)`;

    setTimeout(() => showOverlay({ icon: '💖', title, msg }), 900);
  }

  // ============== 패배 ==============
  function triggerLose(r, c) {
    state.gameOver = true;
    stopTimer();
    Sound.boom();

    for (let rr = 0; rr < state.rows; rr++) {
      for (let cc = 0; cc < state.cols; cc++) {
        const cell = state.board[rr][cc];
        const el = state.cellEls[rr][cc];
        if (cell.mine) {
          if (cell.flag) continue;
          el.className = 'cell mine-reveal';
          el.textContent = '💣';
        } else if (cell.flag) {
          el.className = 'cell wrong-flag';
          el.textContent = '❌';
        }
      }
    }
    const boomEl = state.cellEls[r][c];
    boomEl.className = 'cell mine-boom';
    boomEl.textContent = '💥';

    setTimeout(() => {
      showOverlay({
        icon: '💥',
        title: '구조 실패…',
        msg: '지뢰를 밟았어요. 다시 시도해볼까요?',
      });
    }, 950);
  }

  function spawnFootprint(r, c) {
    const f = document.createElement('div');
    f.className = 'footprint';
    f.textContent = choice(FOOTPRINTS);
    const { x, y } = cellPx(r, c);
    f.style.left = (x + state.cellSize * 0.15) + 'px';
    f.style.top  = (y + state.cellSize * 0.15) + 'px';
    f.style.width = state.cellSize + 'px';
    f.style.height = state.cellSize + 'px';
    boardEl.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  }

  function spawnSpark(r, c) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.textContent = choice(SPARKS);
    const { x, y } = cellPx(r, c);
    const ox = (Math.random() - 0.5) * state.cellSize * 0.7;
    const oy = (Math.random() - 0.5) * state.cellSize * 0.7;
    s.style.left = (x + state.cellSize * 0.1 + ox) + 'px';
    s.style.top  = (y + state.cellSize * 0.1 + oy) + 'px';
    boardEl.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }

  // ============== UI ==============
  function showOverlay({ icon, title, msg }) {
    overlayIcon.textContent = icon;
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlayEl.classList.remove('hidden');
  }
  function hideOverlay() { overlayEl.classList.add('hidden'); }

  function updateMineCount() {
    mineCountEl.textContent = Math.max(0, state.mines - state.flags);
  }
  function updateTimer() { timerEl.textContent = state.seconds; }

  function startTimerIfNeeded() {
    if (state.timerStarted || state.gameOver) return;
    state.timerStarted = true;
    state.timerId = setInterval(() => {
      state.seconds++;
      updateTimer();
    }, 1000);
  }
  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  // 난이도에 따라 선택 가능한 늑구 수를 제한(초과 옵션 비활성화).
  function syncWolfOptions() {
    const cfg = DIFFICULTIES[difficultyEl.value] || DIFFICULTIES.normal;
    const maxW = cfg.maxWolves;
    for (const opt of wolvesEl.options) {
      const v = parseInt(opt.value, 10);
      opt.disabled = v > maxW;
    }
    if (parseInt(wolvesEl.value, 10) > maxW) wolvesEl.value = String(maxW);
  }

  function newGame() {
    if (state) stopTimer();
    hideOverlay();
    syncWolfOptions();
    const numWolves = parseInt(wolvesEl.value, 10) || 1;
    state = createState(difficultyEl.value, numWolves);
    render();
    Sound.start();
  }

  // ============== 이벤트 바인딩 ==============
  resetBtn.addEventListener('click', () => { Sound.warmup(); newGame(); });
  overlayBtn.addEventListener('click', () => { Sound.warmup(); newGame(); });
  difficultyEl.addEventListener('change', newGame);
  wolvesEl.addEventListener('change', newGame);
  muteBtn.addEventListener('click', () => {
    Sound.warmup();
    const muted = Sound.toggle();
    muteBtn.textContent = muted ? '🔈' : '🔊';
    muteBtn.title = muted ? '효과음 켜기' : '효과음 끄기';
  });

  // 첫 시작
  newGame();
})();
