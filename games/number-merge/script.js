(function () {
  const SIZE = 4;
  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const timeEl = document.getElementById('time');
  const overlayEl = document.getElementById('overlay');
  const overlayMsg = document.getElementById('overlay-msg');
  const overlaySub = document.getElementById('overlay-sub');
  const resetBtn = document.getElementById('reset');

  const STORAGE_KEY = 'numberMerge.save.v1';

  const TILE_COLORS = {
    2: ['--t2', '--t2-ink'], 4: ['--t4', '--t4-ink'], 8: ['--t8', '--t8-ink'],
    16: ['--t16', '--t16-ink'], 32: ['--t32', '--t32-ink'], 64: ['--t64', '--t64-ink'],
    128: ['--t128', '--t128-ink'], 256: ['--t256', '--t256-ink'], 512: ['--t512', '--t512-ink'],
    1024: ['--t1024', '--t1024-ink'], 2048: ['--t2048', '--t2048-ink']
  };

  let grid, score, best, elapsed, won, over, cellSize, gap, timerHandle;

  // localStorage を試すが、使えない環境(プライベートモードや埋め込みプレビューなど)では
  // 静かにメモリ上だけの保持にフォールバックする。
  let memoryFallback = null;

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return memoryFallback;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.grid)) return memoryFallback;
      return data;
    } catch (e) {
      return memoryFallback;
    }
  }

  function persist() {
    const data = { grid, score, best, elapsed, won, over };
    memoryFallback = data;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // 保存できない環境ではメモリ保持のみ(このタブを閉じるまで有効)
    }
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateTimeDisplay() {
    timeEl.textContent = formatTime(elapsed);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(() => {
      if (over) return;
      elapsed++;
      updateTimeDisplay();
      persist();
    }, 1000);
  }

  // 新規ゲーム: グリッドとスコア、経過時間を初期化する。ハイスコアは維持する。
  function startNewGame() {
    grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    score = 0;
    elapsed = 0;
    won = false;
    over = false;
    overlayEl.classList.remove('show');
    addRandomTile();
    addRandomTile();
    render();
    updateTimeDisplay();
    persist();
    startTimer();
  }

  // ページ読み込み時: 保存データがあれば続きから、なければ新規開始
  function restoreOrStart() {
    const saved = loadSaved();
    best = (saved && typeof saved.best === 'number') ? saved.best : 0;

    if (saved && Array.isArray(saved.grid) && saved.grid.length === SIZE) {
      grid = saved.grid;
      score = typeof saved.score === 'number' ? saved.score : 0;
      elapsed = typeof saved.elapsed === 'number' ? saved.elapsed : 0;
      won = !!saved.won;
      over = !!saved.over;
      render();
      updateTimeDisplay();
      if (over) {
        overlayMsg.textContent = won ? 'クリア!' : 'Game Over';
        overlaySub.textContent = won ? '2048を達成しました' : 'これ以上動かせません';
        overlayEl.classList.add('show');
      } else {
        startTimer();
      }
    } else {
      startNewGame();
    }
  }

  function clearTiles() {
    boardEl.querySelectorAll('.tile').forEach(t => t.remove());
  }

  function addRandomTile() {
    const empties = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (grid[r][c] === 0) empties.push([r, c]);
    if (empties.length === 0) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  function measure() {
    const rect = boardEl.getBoundingClientRect();
    gap = 10;
    cellSize = (rect.width - gap * (SIZE - 1)) / SIZE;
  }

  function tileStyle(val) {
    const key = TILE_COLORS[val] ? val : 'hi';
    const bgVar = key === 'hi' ? '--thi' : TILE_COLORS[val][0];
    const inkVar = key === 'hi' ? '--thi-ink' : TILE_COLORS[val][1];
    return { bg: `var(${bgVar})`, ink: `var(${inkVar})` };
  }

  function fontSizeFor(val) {
    const s = String(val).length;
    if (s <= 1) return cellSize * 0.42;
    if (s === 2) return cellSize * 0.38;
    if (s === 3) return cellSize * 0.32;
    return cellSize * 0.26;
  }

  function render() {
    measure();
    clearTiles();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const val = grid[r][c];
        if (!val) continue;
        const tile = document.createElement('div');
        tile.className = 'tile pop';
        const { bg, ink } = tileStyle(val);
        tile.style.background = bg;
        tile.style.color = ink;
        tile.style.width = cellSize + 'px';
        tile.style.height = cellSize + 'px';
        tile.style.left = c * (cellSize + gap) + 'px';
        tile.style.top = r * (cellSize + gap) + 'px';
        tile.style.fontSize = fontSizeFor(val) + 'px';
        tile.textContent = val;
        boardEl.appendChild(tile);
      }
    }
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
    }
    bestEl.textContent = String(best);
  }

  function slideLine(line) {
    const nums = line.filter(v => v !== 0);
    const merged = [];
    let gained = 0;
    for (let i = 0; i < nums.length; i++) {
      if (i < nums.length - 1 && nums[i] === nums[i + 1]) {
        const val = nums[i] * 2;
        merged.push(val);
        gained += val;
        if (val === 2048) won = true;
        i++;
      } else {
        merged.push(nums[i]);
      }
    }
    while (merged.length < SIZE) merged.push(0);
    return { merged, gained };
  }

  function linesEqual(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function move(dir) {
    if (over) return;
    let moved = false;
    let gained = 0;

    for (let i = 0; i < SIZE; i++) {
      let line;
      if (dir === 'left') line = grid[i].slice();
      else if (dir === 'right') line = grid[i].slice().reverse();
      else if (dir === 'up') line = [0, 1, 2, 3].map(r => grid[r][i]);
      else line = [0, 1, 2, 3].map(r => grid[r][i]).reverse();

      const { merged, gained: g } = slideLine(line);
      gained += g;
      if (!linesEqual(line, merged)) moved = true;

      let finalLine = merged;
      if (dir === 'right' || dir === 'down') finalLine = merged.slice().reverse();

      if (dir === 'left' || dir === 'right') {
        grid[i] = finalLine;
      } else {
        for (let r = 0; r < SIZE; r++) grid[r][i] = finalLine[r];
      }
    }

    if (moved) {
      score += gained;
      addRandomTile();
      render();
      checkGameOver();
      persist();
    }
  }

  function checkGameOver() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) return;
        const v = grid[r][c];
        if (c < SIZE - 1 && grid[r][c + 1] === v) return;
        if (r < SIZE - 1 && grid[r + 1][c] === v) return;
      }
    }
    over = true;
    stopTimer();
    overlayMsg.textContent = won ? 'クリア!' : 'Game Over';
    overlaySub.textContent = won ? '2048を達成しました' : 'これ以上動かせません';
    overlayEl.classList.add('show');
  }

  const keyMap = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down'
  };

  window.addEventListener('keydown', (e) => {
    const dir = keyMap[e.key];
    if (dir) {
      e.preventDefault();
      move(dir);
    }
  });

  // タッチ操作は board-wrap (グリッドの外枠) 全体で拾う。
  // passive:false + preventDefault で、下スワイプによる引っ張り更新や
  // 左右スワイプによるブラウザの「戻る/進む」ジェスチャーを確実に無効化する。
  const boardWrap = document.querySelector('.board-wrap');
  let touchStartX = 0, touchStartY = 0, tracking = false;

  boardWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    tracking = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: false });

  boardWrap.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    // ページのスクロールやブラウザのスワイプナビゲーションに渡さない
    e.preventDefault();
  }, { passive: false });

  boardWrap.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      move(dx > 0 ? 'right' : 'left');
    } else {
      move(dy > 0 ? 'down' : 'up');
    }
  }, { passive: false });

  boardWrap.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });

  resetBtn.addEventListener('click', startNewGame);
  window.addEventListener('resize', () => render());
  window.addEventListener('pagehide', persist);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });

  // サービスワーカーの登録は shared/register-sw.js が一括で行う(このファイルでは行わない)

  restoreOrStart();
})();
