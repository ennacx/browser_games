(function () {
    // 盤面サイズ
    const SIZE = 5;

    // セル間の隙間
    const CELL_GAP_BASE = 12; // 基数
    const CELL_GAP_COEFFICIENT = 1.2; // 係数
    const CELL_GAP = CELL_GAP_BASE - Math.ceil((SIZE - 4) * CELL_GAP_COEFFICIENT); // px

    // クリアスコア
    const CLEAR_SCORE = 2048; // 2の指数であること

    /**
     * 盤面セルの値
     * ※ 0 は空セル、それ以外はタイルの数値
     *
     * @typedef {number} NumberMergeCell
     */

    /**
     * Number Merge の盤面データ
     *
     * @typedef {NumberMergeCell[][]} NumberMergeGrid
     */

    /**
     * ゲーム結果
     *
     * @typedef {'clear'|'over'} NumberMergeOverlayType
     */

    /**
     * アンドゥ・リドゥで保持する1手分の状態
     *
     * @typedef {object} NumberMergeHistoryState
     * @property {NumberMergeGrid} grid
     * @property {number} score
     * @property {boolean} won
     * @property {boolean} over
     * @property {NumberMergeOverlayType|null} overlayType
     */

    /**
     * localStorage に保存するゲーム状態
     *
     * @typedef {object} NumberMergeSaveData
     * @property {NumberMergeGrid} grid
     * @property {number} score
     * @property {number} best
     * @property {number} elapsed
     * @property {boolean} won
     * @property {boolean} over
     * @property {NumberMergeHistoryState|null} undoState
     * @property {NumberMergeHistoryState|null} redoState
     * @property {NumberMergeOverlayType|null} overlayType
     * @property {boolean} clearCanContinue
     */

    const boardEl     = document.getElementById('board');
    const scoreEl     = document.getElementById('score');
    const bestEl      = document.getElementById('best');
    const timeEl      = document.getElementById('time');
    const overlayEl   = document.getElementById('overlay');

    const overlayMsg  = document.getElementById('overlay-msg');
    const overlaySub  = document.getElementById('overlay-sub');

    const continueBtn = document.getElementById('continue');
    const undoBtn     = document.getElementById('undo');
    const redoBtn     = document.getElementById('redo');
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

    for (let i = 0; i < (SIZE ** 2); i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');

        boardEl.append(cell);
    }

    /** @type {NumberMergeGrid} */
    let grid;
    // セルサイズ
    let cellSize;
    // スコア周り
    let score, best;
    // 経過時間とタイマーのハンドラーID
    let elapsed, timerHandle;
    // クリア・ゲームオーバーのフラグ
    let won, over;

    // クリア後にゲームを続行できるようにするための独立フラグ
    let clearReachedThisMove = false;

    // アンドゥ・リドゥの状態
    let undoState = null;
    let redoState = null;

    // localStorage を試すが、使えない環境 (プライベートモードや埋め込みプレビューなど) では
    // 静かにメモリ上だけの保持にフォールバックする。
    let memoryFallback = null;

    /**
     * localStorageまたはメモリ上からゲーム状態を読み込む
     *
     * @return {NumberMergeSaveData|null}
     */
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
            console.error('localStorage restore error.', e);

            return memoryFallback;
        }
    }

    /**
     * ゲーム状態をlocalStorageに保存する (フォールバックとしてメモリ上にも保持)
     */
    function persist() {
        const data = { grid, score, best, elapsed, won, over, undoState, redoState, overlayType: getOverlayType(), clearCanContinue: true };

        // フォールバック用にメモリ上にも保持
        memoryFallback = data;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('localStorage persist error.', e);

            // 保存できない環境ではメモリ保持のみ (このタブを閉じるまで有効)
        }
    }

    /**
     * 秒数を `m:ss` 形式にフォーマットする
     * @param {number} sec
     * @return {string}
     */
    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;

        return m + ':' + String(s).padStart(2, '0');
    }

    /**
     * 経過時間を表示する
     */
    function updateTimeDisplay() {
        timeEl.textContent = formatTime(elapsed);
    }

    /**
     * タイマーを停止する
     */
    function stopTimer() {
        if (timerHandle) {
            clearInterval(timerHandle);
            timerHandle = null;
        }
    }

    /**
     * タイマーを開始する
     */
    function startTimer() {
        stopTimer();

        timerHandle = setInterval(() => {
            // ゲームオーバー状態なら経過時間を更新しない
            if (over) {
                return;
            }

            elapsed++;

            // 経過時間を更新
            updateTimeDisplay();
            // ストレージに状態を保存
            persist();
        }, 1000);
    }

    /**
     * グリッドの初期化
     */
    function initGrid() {
        grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    }

    /**
     * グリッドのディープコピー (clone)
     *
     * @param {NumberMergeGrid} src
     * @return {NumberMergeGrid}
     */
    function cloneGrid(src) {
        return src.map((row) => row.slice());
    }

    /**
     * アンドゥ・リドゥで管理するオブジェクトの生成
     *
     * @return {NumberMergeHistoryState}
     */
    function createHistoryState() {
        return {
            grid: cloneGrid(grid),
            score,
            won,
            over,
            overlayType: getOverlayType()
        };
    }

    /**
     * オーバーレイ表示時にどの種類のオーバーレイが表示されているかを判定
     *
     * @return {string|null}
     */
    function getOverlayType() {
        if (!overlayEl.classList.contains('show')) {
            return null;
        }

        return (continueBtn.hidden) ? 'over' : 'clear';
    }

    /**
     * アンドゥ・リドゥの状態判定
     *
     * @param {*} state
     * @return {boolean}
     */
    function isValidHistoryState(state) {
        return (
            !!state
            && Array.isArray(state.grid)
            && state.grid.length === SIZE
            && state.grid.every((row) => Array.isArray(row) && row.length === SIZE)
        );
    }

    /**
     * アンドゥ・リドゥボタンの有効化/無効化
     */
    function updateHistoryButtons() {
        undoBtn.disabled = !undoState;
        redoBtn.disabled = !redoState;
    }

    /**
     * アンドゥ・リドゥ時のタイマー同期
     *
     * ゲームオーバー時やオーバーレイ表示中はタイマーを停止する。
     * プレイ可能な状態でタイマーが止まっていれば再開する。
     */
    function syncTimerAfterRestore() {
        if (over || overlayEl.classList.contains('show')) {
            stopTimer();
        } else if (timerHandle === null) {
            startTimer();
        }
    }

    /**
     * アンドゥ・リドゥボタン押下時の状態復元
     *
     * @param {NumberMergeHistoryState} state
     */
    function restoreHistoryState(state) {
        grid  = cloneGrid(state.grid);
        score = (typeof state.score === 'number') ? state.score : 0;
        won   = !!state.won;
        over  = !!state.over;
        clearReachedThisMove = false;

        // 画面に反映
        render();

        if (state.overlayType === 'clear') {
            showOverlay('clear');
        } else if (over || state.overlayType === 'over') {
            showOverlay('over');
        } else {
            overlayEl.classList.remove('show');
        }

        // タイマー同期
        syncTimerAfterRestore();
        // アンドゥ・リドゥボタンの有効化/無効化
        updateHistoryButtons();
        // ストレージに状態を保存
        persist();
    }

    /**
     * 新規ゲーム
     *
     * グリッドとスコア、経過時間を初期化する。
     * ハイスコアは維持する。
     */
    function startNewGame() {
        initGrid();

        score   = 0;
        elapsed = 0;

        won  = false;
        over = false;
        clearReachedThisMove = false;

        undoState = null;
        redoState = null;

        overlayEl.classList.remove('show');

        // タイルをランダム位置に追加
        for (let i = 0; i < 2; i++) {
            addRandomTile();
        }

        // 画面に反映
        render();
        // 経過時間を表示
        updateTimeDisplay();
        // ストレージに状態を保存
        persist();
        // アンドゥ・リドゥボタンの有効化/無効化
        updateHistoryButtons();

        startTimer();
    }

    /**
     * ページ読み込み時
     *
     * 保存データがあれば続きから、なければ新規開始する。
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

            // アンドゥ・リドゥの状態を復元
            undoState = (isValidHistoryState(saved.undoState)) ? saved.undoState : null;
            redoState = (isValidHistoryState(saved.redoState)) ? saved.redoState : null;

            // オーバーレイの状態を復元
            const savedOverlayType = (saved.overlayType === 'clear' || saved.overlayType === 'over') ? saved.overlayType : null;

            // 画面に反映
            render();
            // 経過時間を表示
            updateTimeDisplay();
            // アンドゥ・リドゥボタンの有効化/無効化
            updateHistoryButtons();

            // ゲームオーバー判定またはゲームオーバーのオーバーレイが有効
            if (over || savedOverlayType === 'over') {
                showOverlay('over');
                stopTimer();
            }
            // ゲームクリアのオーバーレイが有効
            else if (savedOverlayType === 'clear') {
                showOverlay('clear');
                stopTimer();
            }
            // その他 (ゲーム続行可能)
            else {
                startTimer();

                if (clearReachedThisMove) {
                    // ゲームオーバー判定
                    checkGameOver();
                }
            }
        } else {
            startNewGame();
        }
    }

    /**
     * 描画済みの数値タイルを削除する
     */
    function clearTiles() {
        boardEl.querySelectorAll('.tile').forEach((t) => t.remove());
    }

    /**
     * 数値の入っていないセルへランダムに数値タイルを配置
     */
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

    /**
     * 盤面のサイズを測定し、各セルのサイズを計算
     */
    function measure() {
        const rect = boardEl.getBoundingClientRect();

        cellSize = (rect.width - CELL_GAP * (SIZE - 1)) / SIZE;
    }

    /**
     * 引数の値に対応するタイル色を返す
     *
     * @param {number} val - タイルの数値
     * @return {{bg: string, ink: string}} - 数値に応じた背景色と文字色
     */
    function tileStyle(val) {
        const key    = (TILE_COLORS[val]) ? val : 'hi';
        const bgVar  = (key === 'hi') ? '--thi'     : TILE_COLORS[val][0];
        const inkVar = (key === 'hi') ? '--thi-ink' : TILE_COLORS[val][1];

        return { bg: `var(${bgVar})`, ink: `var(${inkVar})` };
    }

    /**
     * 桁数に応じたタイル数値のフォントサイズ調整
     *
     * @param {number} val
     * @return {number}
     */
    function fontSizeFor(val) {
        switch (String(val).length) {
            case 0:
            case 1:
                return cellSize * 0.42;
            case 2:
                return cellSize * 0.38;
            case 3:
                return cellSize * 0.32;
            default:
                return cellSize * 0.26;
        }
    }

    /**
     * 現在のグリッド・スコア・ベストスコアを画面に反映する
     */
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

    /**
     * 移動した方向に応じて行または列のタイルを変換
     *
     * @param {string} dir - 移動方向 ('left', 'right', 'up', or 'down').
     * @param {number} i - 変換対象の行または列のインデックス
     * @return {Array|null} 変換後の配列 (指定外操作の場合は`null`)
     */
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

    /**
     * 移動に応じた行又は列内の数値の移動と合算
     *
     * @param {number[]} line
     * @return {{merged: number[], gained: number}}
     */
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

    /**
     * 移動に応じた行または列内の合致判定
     *
     * @param {number[]} a
     * @param {number[]} b
     * @return {boolean}
     */
    function linesEqual(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * ラインからグリッドへの変換
     *
     * @param {string} dir
     * @param {number[]} line
     * @param {number} i
     */
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

    /**
     * 移動操作時の処理
     *
     * @param {string} dir
     */
    function move(dir) {
        if (over) {
            return;
        }
        if (overlayEl.classList.contains('show')) {
            return;
        }

        let moved  = false;
        let gained = 0; // スコア加算分

        // 移動判定前に状態を保持
        const previousState = createHistoryState();

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
            // 移動成功時には直前をアンドゥに保持させ、リドゥを初期化
            undoState = previousState;
            redoState = null;

            if(gained > 0) {
                score += gained;
            }

            // タイルをランダム位置に追加
            addRandomTile();
            // 画面に反映
            render();
            // ゲームオーバー判定
            checkGameOver();
            // ストレージに状態を保存
            persist();
            // アンドゥ・リドゥボタンの有効化/無効化
            updateHistoryButtons();
        }
    }

    /**
     * クリア通知またはゲームオーバーを判定する
     */
    function checkGameOver() {
        if (clearReachedThisMove) {
            clearReachedThisMove = false;

            stopTimer();
            showOverlay('clear');
            // ストレージに状態を保存
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

    /**
     * オーバーレイ表示
     *
     * @param {'clear'|'over'} type
     */
    function showOverlay(type) {
        const isClear = (type === 'clear');

        overlayMsg.textContent = (isClear) ? "クリア!" : "Game Over";
        overlaySub.textContent = (isClear) ? `${CLEAR_SCORE}を達成しました` : "これ以上動かせません";
        continueBtn.hidden = (!isClear);

        overlayEl.classList.add('show');
    }

    /**
     * オーバーレイ非表示
     */
    function hideOverlay() {
        overlayEl.classList.remove('show');

        // ゲームオーバー判定
        checkGameOver();
    }

    /**
     * アンドゥ時の処理
     */
    function undoMove() {
        if (!undoState) {
            return;
        }

        const state = undoState;
        undoState = null;

        redoState = createHistoryState();

        restoreHistoryState(state);
    }

    /**
     * リドゥ時の処理
     */
    function redoMove() {
        if (!redoState) {
            return;
        }

        const state = redoState;
        redoState = null;

        undoState = createHistoryState();

        restoreHistoryState(state);
    }

    /*
     * キー操作
     */
    window.addEventListener('keydown', (e) => {
        // 入力キー判定と小文字変換
        const key = e.key.toLowerCase();

        // Ctrl/Cmd + Z
        if ((e.ctrlKey || e.metaKey) && key === 'z') {
            e.preventDefault();

            // Ctrl/Cmd + Shift + Z
            if (e.shiftKey) {
                redoMove();
            } else {
                undoMove();
            }

            return;
        }

        // Ctrl/Cmd + Y
        if ((e.ctrlKey || e.metaKey) && key === 'y') {
            e.preventDefault();

            redoMove();

            return;
        }

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

        /*
         * タッチ操作開始
         */
        boardWrap.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) {
                return;
            }

            tracking = true;

            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: false });

        /*
         * タッチ操作中
         */
        boardWrap.addEventListener('touchmove', (e) => {
            if (!tracking) {
                return;
            }

            // ページのスクロールやブラウザのスワイプナビゲーションに渡さない
            e.preventDefault();
        }, { passive: false });

        /*
         * タッチ操作終了
         */
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
        }, { passive: false });

        /*
         * タッチ操作中断 (タッチ操作が取り消される可能性のあるハードウェアに対するフォールバック)
         */
        boardWrap.addEventListener('touchcancel', () => {
            tracking = false;
        }, { passive: true });
    }

    // はじめからボタン押下
    resetBtn.addEventListener('click', startNewGame);
    // アンドゥボタン押下
    undoBtn.addEventListener('click', undoMove);
    // リドゥボタン押下
    redoBtn.addEventListener('click', redoMove);
    // つづけるボタン押下
    continueBtn.addEventListener('click', () => {
        hideOverlay();

        // タイマー再開
        if (!over && timerHandle === null) {
            startTimer();
        }
    });

    // リサイズ時のレンダリング
    window.addEventListener('resize', render);

    // ページ非表示時の状態保存
    window.addEventListener('pagehide', persist);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // ストレージに状態を保存
            persist();
        }
    });

    // サービスワーカーの登録は shared/register-sw.js が一括で行う (このファイルでは行わない)

    restoreOrStart();
})();
