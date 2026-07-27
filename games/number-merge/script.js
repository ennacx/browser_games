(function () {
    const SIZE = 5;
    const CELL_GAP = 10; // px

    const CLEAR_SCORE = 2048;

    const boardEl     = document.getElementById('board');
    const scoreEl     = document.getElementById('score');
    const bestEl      = document.getElementById('best');
    const timeEl      = document.getElementById('time');
    const overlayEl   = document.getElementById('overlay');
    const overlayMsg  = document.getElementById('overlay-msg');
    const overlaySub  = document.getElementById('overlay-sub');
    const continueBtn = document.getElementById('continue');
    const resetBtn    = document.getElementById('reset');

    const keyMap = {
        // 十字キー
        ArrowLeft: 'left', ArrowRight: 'right',
        ArrowUp: 'up', ArrowDown: 'down',

        // WASD でも
        a: 'left', d: 'right',
        w: 'up', s: 'down'
    };

    // LocalStorageのキー名
    const STORAGE_KEY = 'numberMerge.save.v1';

    const TILE_COLORS = {};
    for (let i = 2; i <= CLEAR_SCORE; i *= 2) {
        TILE_COLORS[i] = [`--t${i}`, `--t${i}-ink`];
    }

    // セルの描画に関するCSS設定周りを反映
    document.documentElement.style.setProperty('--board-size', String(SIZE));
    document.documentElement.style.setProperty('--cell-gap', `${CELL_GAP}px`);

    // マージ時に列を変換
    const LINE_MAP_BASE = [];
    for (let i = 0; i < SIZE; i++) {
        LINE_MAP_BASE.push(i);
    }

    for (let i = 0; i < (SIZE * SIZE); i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');

        boardEl.append(cell);
    }

    // グリッド周り
    let grid, cellSize;
    // スコア周り
    let score, best;
    // 経過時間とタイマーのハンドラーID
    let elapsed, timerHandle;
    // クリア・ゲームオーバーのフラグ
    let won, over;

    // クリア後にゲームを続行できるようにするための独立フラグ
    let clearReachedThisMove = false;

    // localStorage を試すが、使えない環境(プライベートモードや埋め込みプレビューなど)では
    // 静かにメモリ上だけの保持にフォールバックする。
    let memoryFallback = null;

    function loadSaved() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return memoryFallback;
            }

            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.grid)) {
                return memoryFallback;
            }

            return data;
        } catch (e) {
            return memoryFallback;
        }
    }

    function persist() {
        const data = { grid, score, best, elapsed, won, over, clearCanContinue: true };
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
            if (over) {
                return;
            }

            elapsed++;

            updateTimeDisplay();
            persist();
        }, 1000);
    }

    function initGrid() {
        grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    }

    /**
     * 新規ゲーム
     * グリッドとスコア、経過時間を初期化する。ハイスコアは維持する。
     */
    function startNewGame() {
        initGrid();

        score   = 0;
        elapsed = 0;

        won  = false;
        over = false;
        clearReachedThisMove = false;

        overlayEl.classList.remove('show');

        addRandomTile();
        addRandomTile();

        render();
        updateTimeDisplay();

        persist();

        startTimer();
    }

    /**
     * ページ読み込み時
     * 保存データがあれば続きから、なければ新規開始
     */
    function restoreOrStart() {
        const saved = loadSaved();
        best = (saved && typeof saved.best === 'number') ? saved.best : 0;

        if (saved && Array.isArray(saved.grid) && saved.grid.length === SIZE) {
            grid = saved.grid;
            score   = (typeof saved.score   === 'number') ? saved.score   : 0;
            elapsed = (typeof saved.elapsed === 'number') ? saved.elapsed : 0;

            won  = !!saved.won;
            over = !!saved.over;

            clearReachedThisMove = won && over && (saved.clearCanContinue !== true);
            if (clearReachedThisMove) {
                over = false;
            }

            render();
            updateTimeDisplay();

            if (over) {
                showOverlay('over');
            } else {
                startTimer();
                if (clearReachedThisMove) {
                    checkGameOver();
                }
            }
        } else {
            startNewGame();
        }
    }

    function clearTiles() {
        boardEl.querySelectorAll('.tile').forEach((t) => t.remove());
    }

    function addRandomTile() {
        const empties = [];

        // 数値の入っていないセルのアドレスを抽出
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (grid[r][c] === 0) {
                    empties.push([r, c]);
                }
            }
        }

        // 全部数値で埋まっている場合は何もしない
        if (empties.length === 0) {
            return;
        }

        // 空きセルからランダムに選択し、90%の確率で`2`、10%の確率で`4`を配置
        const [r, c] = empties[Math.floor(Math.random() * empties.length)];
        grid[r][c] = (Math.random() < 0.9) ? 2 : 4;
    }

    function measure() {
        const rect = boardEl.getBoundingClientRect();

        cellSize = (rect.width - CELL_GAP * (SIZE - 1)) / SIZE;
    }

    function tileStyle(val) {
        const key    = (TILE_COLORS[val]) ? val : 'hi';
        const bgVar  = (key === 'hi') ? '--thi'     : TILE_COLORS[val][0];
        const inkVar = (key === 'hi') ? '--thi-ink' : TILE_COLORS[val][1];

        return { bg: `var(${bgVar})`, ink: `var(${inkVar})` };
    }

    function fontSizeFor(val) {
        const s = String(val).length;

        if (s <= 1) {
            return cellSize * 0.42;
        } else if (s === 2) {
            return cellSize * 0.38;
        } else if (s === 3) {
            return cellSize * 0.32;
        }

        return cellSize * 0.26;
    }

    function render() {
        measure();
        clearTiles();

        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const val = grid[r][c];
                if (!val) {
                    continue;
                }

                const tile = document.createElement('div');
                const { bg, ink } = tileStyle(val);

                tile.className = 'tile pop';

                tile.style.background = bg;
                tile.style.color      = ink;
                tile.style.width      = cellSize + 'px';
                tile.style.height     = cellSize + 'px';
                tile.style.left       = c * (cellSize + CELL_GAP) + 'px';
                tile.style.top        = r * (cellSize + CELL_GAP) + 'px';
                tile.style.fontSize   = fontSizeFor(val) + 'px';
                tile.textContent = val;

                boardEl.appendChild(tile);
            }
        }

        if (score > best) {
            best = score;
        }

        scoreEl.textContent = String(score);
        bestEl.textContent  = String(best);
    }

    function convertLineFromGrid(dir, i) {
        let line;

        switch (dir) {
            case 'left':
                line = grid[i].slice(); // 左移動時はそのまま代入
                break;
            case 'right':
                line = grid[i].slice().reverse(); // 右移動時は共通処理のため反転
                break;
            case 'up':
                line = LINE_MAP_BASE.map((r) => grid[r][i]); // 上移動時は列からラインに変換
                break;
            case 'down':
                line = LINE_MAP_BASE.map((r) => grid[r][i]).reverse(); // 下移動時は列からラインに変換後反転
                break;
            default:
                return null;
        }

        return line;
    }

    function slideLine(line) {
        const nums   = line.filter((v) => (v !== 0));
        const merged = [];

        // スコア加算得点
        let gained = 0;

        // 数値をスライド方向に寄せ、同値が隣り合っていればマージする
        for (let i = 0; i < nums.length; i++) {
            if (i < nums.length - 1 && nums[i] === nums[i + 1]) {
                const val = nums[i] * 2;
                merged.push(val);
                gained += val;

                if (val === CLEAR_SCORE && !won) {
                    won = true;
                    clearReachedThisMove = true;
                }

                i++;
            } else {
                merged.push(nums[i]);
            }
        }

        // 足りない分は0埋め
        while (merged.length < SIZE) {
            merged.push(0);
        }

        return { merged, gained };
    }

    function linesEqual(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }

        return true;
    }

    function convertGridFromLine(dir, line, i) {

        // 右もしくは下移動は逆転させて元に戻す
        if (dir === 'right' || dir === 'down') {
            line = line.slice().reverse();
        }

        // 左右移動時はラインをグリッドにそのまま代入
        if (dir === 'left' || dir === 'right') {
            grid[i] = line;
        }
        // 上下移動時はラインを列に変換して代入
        else {
            for (let r = 0; r < SIZE; r++) {
                grid[r][i] = line[r];
            }
        }
    }

    function move(dir) {
        if (over) {
            return;
        }
        if (overlayEl.classList.contains('show')) {
            return;
        }

        let moved  = false;
        let gained = 0; // スコア加算分
        clearReachedThisMove = false;

        for (let i = 0; i < SIZE; i++) {
            // グリッド→ライン変換
            const line = convertLineFromGrid(dir, i);
            if (line === null) {
                continue;
            }

            const { merged, gained: g } = slideLine(line);
            if (!linesEqual(line, merged)) {
                moved = true;

                if(g > 0) {
                    gained += g;
                }
            }

            // ライン→グリッド変換
            convertGridFromLine(dir, merged.slice(), i);
        }

        if (moved) {
            if(gained > 0) {
                score += gained;
            }

            addRandomTile();
            render();
            checkGameOver();
            persist();
        }
    }

    function checkGameOver() {
        if (clearReachedThisMove) {
            clearReachedThisMove = false;

            stopTimer();
            showOverlay('clear');
            persist();

            return;
        }

        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                // 空きセルがある場合は続行可能
                if (grid[r][c] === 0) {
                    return;
                }

                const v = grid[r][c];

                // 空きセルがない場合、隣接するセルと値が同じ場合に続行可能
                if (c < SIZE - 1 && grid[r][c + 1] === v) { // 横方向
                    return;
                }
                if (r < SIZE - 1 && grid[r + 1][c] === v) { // 縦方向
                    return;
                }
            }
        }

        // 全てのセルが埋まっている場合、ゲームオーバー
        over = true;

        stopTimer();
        showOverlay('over');
    }

    function showOverlay(type) {
        const isClear = (type === 'clear');

        overlayMsg.textContent = (isClear) ? "クリア!" : "Game Over";
        overlaySub.textContent = (isClear) ? `${CLEAR_SCORE}を達成しました` : "これ以上動かせません";
        continueBtn.hidden = (!isClear);

        overlayEl.classList.add('show');
    }

    function hideOverlay() {
        overlayEl.classList.remove('show');

        checkGameOver();
    }

    /*
     * キー操作
     */
    window.addEventListener('keydown', (e) => {
        const dir = keyMap[e.key];
        if (dir) {
            e.preventDefault();
            move(dir);
        }
    });

    /*
     * タッチ操作は board-wrap (グリッドの外枠から) 全体で拾う。
     * passive:false + preventDefault で、下スワイプによる引っ張り更新や
     * 左右スワイプによるブラウザの「戻る/進む」ジェスチャーを無効化する。
     */
    {
        const boardWrap = document.querySelector('.board-wrap');
        let touchStartX = 0, touchStartY = 0, tracking = false;

        boardWrap.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) {
                return;
            }

            tracking = true;

            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, {passive: false});

        boardWrap.addEventListener('touchmove', (e) => {
            if (!tracking) {
                return;
            }

            // ページのスクロールやブラウザのスワイプナビゲーションに渡さない
            e.preventDefault();
        }, {passive: false});

        boardWrap.addEventListener('touchend', (e) => {
            if (!tracking) {
                return;
            }

            tracking = false;

            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;

            // スワイプ量が小さすぎる場合は無視
            if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
                return;
            }
            // 縦横判別不能な斜めの移動も無視
            else {
                let ratio = Math.abs(dx) / Math.abs(dy);
                if (ratio > 1) {
                    ratio = 1 / ratio;
                }

                if (ratio > 0.8) {
                    return;
                }
            }

            if (Math.abs(dx) > Math.abs(dy)) {
                move((dx > 0) ? 'right' : 'left');
            } else {
                move((dy > 0) ? 'down' : 'up');
            }
        }, {passive: false});

        boardWrap.addEventListener('touchcancel', () => {
            tracking = false;
        }, {passive: true});
    }

    // はじめからボタン押下
    resetBtn.addEventListener('click', startNewGame);
    // つづけるボタン押下
    continueBtn.addEventListener('click', () => {
        hideOverlay();

        // タイマー再開
        if (!over && timerHandle === null) {
            startTimer();
        }
    });

    // リサイズ時のレンダリング
    window.addEventListener('resize', () => render());

    // ページ非表示時の状態保存
    window.addEventListener('pagehide', persist);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            persist();
        }
    });

    // サービスワーカーの登録は shared/register-sw.js が一括で行う(このファイルでは行わない)

    restoreOrStart();
})();
