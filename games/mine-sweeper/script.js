(function () {
    const SECTORS = {
        small:  { rows:  9, cols:  9, mines: 10, label: "狭域" },
        medium: { rows: 16, cols: 16, mines: 40, label: "中域" },
        large:  { rows: 24, cols: 16, mines: 80, label: "広域" }
    };
    const HOLD_MS        = 480;
    const MOVE_CANCEL_PX = 10;

    const STORAGE_KEY    = 'mineSweeper.save.v1';

    /**
     * Mine Sweeper のゲーム結果
     * @typedef {'dead'|'clear'} MineSweeperResult
     */

    /**
     * 行・列のタプルアドレス
     *
     * @typedef {[number, number]} CellAddress
     */

    /**
     * 盤面上の1セルの状態
     *
     * @typedef {object} MineSweeperCell
     * @property {boolean} mine 地雷セルかのフラグ
     * @property {number} count 周囲8マスの地雷数
     * @property {boolean} open 開封済みかどうかのフラグ
     * @property {boolean} flag フラッグが立っているかのフラグ
     * @property {boolean=} trigger 踏んだ地雷セルかのフラグ
     */

    /**
     * Mine Sweeper の盤面データ
     *
     * @typedef {MineSweeperCell[][]} MineSweeperGrid
     */

    /**
     * localStorage に保存するセル状態。復元しやすいようアドレスも含める。
     *
     * @typedef {MineSweeperCell & {r: number, c: number}} SavedMineSweeperCell
     */

    /**
     * localStorage に保存するゲーム状態
     *
     * @typedef {object} MineSweeperSaveData
     * @property {string} sector
     * @property {SavedMineSweeperCell[]} cells
     * @property {boolean} firstClickDone
     * @property {boolean} gameOver
     * @property {number} opened
     * @property {number} flags
     * @property {number} seconds
     * @property {MineSweeperResult|null} result
     */

    /**
     * マウス押下状態
     *
     * @typedef {object} MousePressState
     * @property {number} r
     * @property {number} c
     * @property {boolean} chordPress
     */

    let sectorKey      = 'small';
    let selectedSector = SECTORS[sectorKey];

    /** @type {MineSweeperGrid} */
    let grid = [];

    let firstClickDone = false;
    let gameOver       = false;
    let opened         = 0;
    let flags          = 0;
    let elapsed        = null;
    let seconds        = 0;

    let result = null;

    /** @type {MineSweeperSaveData|null} */
    let memoryFallback = null;

    const boardEl     = document.getElementById('board');
    const mineCountEl = document.getElementById('mineCount');
    const timerEl     = document.getElementById('timer');
    const statusDot   = document.getElementById('statusDot');
    const sectorSelEl = document.getElementById('sectorSelect');
    const bannerEl    = document.getElementById('banner');
    const resetBtn    = document.getElementById('resetBtn');

    /**
     * 3桁で0埋めする。 (負数はマイナス記号付き2桁)
     *
     * @param {number} n
     * @return {string}
     */
    function pad3(n) {
        const neg = (n < 0);
        const v   = Math.min(999, Math.abs(n)); // 999が最大値
        const s   = String(v).padStart(3, '0');

        return (neg) ? `-${s.slice(1)}` : s;
    }

    /**
     * 指定アドレスセルの周囲セルすべてのアドレスを配列で取得する。
     *
     * @param {number} r
     * @param {number} c
     * @return {CellAddress[]}
     */
    function neighbors(r, c) {
        const res = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                // `0, 0`は指定元アドレスを指すため無視
                if (dr === 0 && dc === 0) {
                    continue;
                }

                const nr = r + dr;
                const nc = c + dc;

                // 盤面外のアドレスは無視
                if (nr >= 0 && nr < selectedSector.rows && nc >= 0 && nc < selectedSector.cols) {
                    res.push([nr, nc]);
                }
            }
        }

        return res;
    }

    /**
     * 全セルを走査する。
     * 引数のコールバックが true または void を返した場合は次のセルへ進み、false を返した場合は走査を中断する。
     *
     * @param {(row: number, col: number) => boolean|void} callback
     * @return {boolean} 最後まで走査した場合は true、中断した場合は false
     */
    function processAllCells(callback) {
        for (let row = 0; row < selectedSector.rows; row++) {
            for (let col = 0; col < selectedSector.cols; col++) {
                const result = callback(row, col);
                if (result === false) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * 初期セルデータをセットしたグリッドを構築する。
     */
    function buildGrid() {
        grid = [];
        for (let r = 0; r < selectedSector.rows; r++) {
            const row = [];
            for (let c = 0; c < selectedSector.cols; c++) {
                row.push({ mine: false, count: 0, open: false, flag: false });
            }

            grid.push(row);
        }
    }

    /**
     * localStorageからセーブデータを読み込む。
     * ※失敗時はメモリ上から取得。
     *
     * @return {MineSweeperSaveData|null}
     */
    function loadSaved() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return memoryFallback;
            }

            const data = JSON.parse(raw);
            if (!data || !SECTORS[data.sector] || !Array.isArray(data.cells)) {
                return memoryFallback;
            }

            return data;
        } catch (e) {
            console.error('localStorage restore error.', e);

            return memoryFallback;
        }
    }

    /**
     * 現在のグリッドから各セルの状態をクローンする。
     *
     * @return {SavedMineSweeperCell[]}
     */
    function createCellStates() {
        const cells = [];

        processAllCells((r, c) => {
            const data = getCellData(r, c);
            cells.push({
                r,
                c,
                mine: !!data.mine,
                count: data.count,
                open: !!data.open,
                flag: !!data.flag,
                trigger: !!data.trigger
            });
        });

        return cells;
    }

    /**
     * localStorageにセーブデータを保存する。
     * ※失敗時はメモリ上に保持。
     */
    function persist() {
        /** @type {MineSweeperSaveData} */
        const data = {
            sector: sectorKey,
            cells: createCellStates(),
            firstClickDone,
            gameOver,
            opened,
            flags,
            seconds,
            result
        };

        memoryFallback = data;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('localStorage persist error.', e);

            // 保存できない環境ではメモリ保持のみ (このタブを閉じるまで有効)
        }
    }

    /**
     * localStorageから復元した隠せるデータをグリッドに復元する。
     *
     * @param {SavedMineSweeperCell[]} cells
     */
    function restoreCells(cells) {
        buildGrid();

        for (const cell of cells) {
            if (
                typeof cell.r !== 'number'
                || typeof cell.c !== 'number'
                || cell.r < 0
                || cell.r >= selectedSector.rows
                || cell.c < 0
                || cell.c >= selectedSector.cols
            ) {
                continue;
            }

            setCellData(cell.r, cell.c, {
                mine: !!cell.mine,
                count: (typeof cell.count === 'number') ? cell.count : 0,
                open: !!cell.open,
                flag: !!cell.flag,
                trigger: !!cell.trigger
            });
        }
    }

    /**
     * セクターセレクトボタンを配置する。
     */
    function initSectorButtons() {
        // 定数から動的にボタンを配置
        Object.keys(SECTORS).forEach((k, i) => {
            const selBtn = document.createElement('button');

            selBtn.classList.add('sector-select-button');
            if (i === 0) {
                selBtn.classList.add('active');
            }

            selBtn.dataset.sector = k;
            selBtn.textContent = `${SECTORS[k].label} ${SECTORS[k].cols}×${SECTORS[k].rows}`;

            // セクターセレクトボタンのクリックイベント登録
            selBtn.addEventListener('click', () => {
                // セクター切り替え
                sectorKey      = k;
                selectedSector = SECTORS[k];

                // セクターボタンに反映
                syncSectorButtons();

                // ニューゲーム開始
                newGame();
            });

            sectorSelEl.appendChild(selBtn);
        });
    }

    /**
     * セクターセレクトボタンの状態を同期する。
     */
    function syncSectorButtons() {
        document.querySelectorAll('.sector-select-button').forEach((btn) => {
            btn.classList.toggle('active', (btn.dataset.sector === sectorKey));
        });
    }

    /**
     * グリッドから指定アドレスのセルデータを取得する。
     *
     * @param {number} r
     * @param {number} c
     * @return {MineSweeperCell|undefined}
     */
    function getCellData(r, c) {
        return grid[r][c] ?? undefined;
    }

    /**
     * グリッド内の指定アドレスのセルデータをセットする。
     *
     * @param {number} r
     * @param {number} c
     * @param {MineSweeperCell} data
     */
    function setCellData(r, c, data) {
        grid[r][c] = data;
    }

    /**
     * グリッド内の指定アドレスの指定セル要素を更新する。
     *
     * @param {number} r
     * @param {number} c
     * @param {string} element
     * @param {boolean|number} value
     */
    function updateCellElement(r, c, element, value) {
        grid[r][c][element] = value;
    }

    /**
     * ランダムに地雷を配置し、地雷ではないセルすべての周囲の地雷数を算出する。
     *
     * @param safeR
     * @param safeC
     */
    function placeMines(safeR, safeC) {
        // クリックした箇所とその周囲は必ず安全地帯にする
        const safeSet = new Set(neighbors(safeR, safeC).map(([r, c]) => `${r}_${c}`));
        safeSet.add(`${safeR}_${safeC}`);

        // 選択セクターの地雷上限値に達するまでランダムに地雷配置
        let placed = 0;
        while (placed < selectedSector.mines) {
            const r   = Math.floor(Math.random() * selectedSector.rows);
            const c   = Math.floor(Math.random() * selectedSector.cols);
            const key = `${r}_${c}`;

            // 既に設置済みの場所だったり安全地帯に配置しようとした場合はやり直し
            if (getCellData(r, c).mine || safeSet.has(key)) {
                continue;
            }

            updateCellElement(r, c, 'mine', true);
            placed++;
        }

        // 全セルを走査し周囲の地雷数を算出、数字セルを作成
        processAllCells((r, c) => {
            const data = getCellData(r, c);
            if (data.mine) {
                return true;
            }

            const cnt = neighbors(r, c).filter(([nr, nc]) => getCellData(nr, nc).mine).length;
            updateCellElement(r, c, 'count', cnt);
        });
    }

    /**
     * ステータスドットのCSSクラスを更新する。
     *
     * @param {MineSweeperResult|null} state
     */
    function updateStatusDotCssClass(state) {
        statusDot.className = `status-dot${(state) ? ` ${state}` : ''}`;
    }

    /**
     * 経過時間タイマーを停止する。
     */
    function stopTimer() {
        if (elapsed) {
            clearInterval(elapsed);
            elapsed = null;
        }
    }

    /**
     * 経過時間タイマーを開始する。
     */
    function startTimer() {
        stopTimer();

        elapsed = setInterval(() => {
            if (gameOver) {
                return;
            }

            seconds++;
            timerEl.textContent = pad3(seconds);
            persist();
        }, 1000);
    }

    /**
     * 残りの地雷数表示を更新する。
     */
    function updateMineCounter() {
        mineCountEl.textContent = pad3(selectedSector.mines - flags);
    }

    /**
     * 1セルあたりのサイズを動的に算出する。 (最大40px)
     *
     * @return {number}
     */
    function cellSize() {
        const wrap       = document.querySelector('.board-wrap');
        const style      = getComputedStyle(wrap);
        const padX       = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const wrapWidth  = Math.min(wrap.clientWidth - padX, 560);
        const boardStyle = getComputedStyle(boardEl);
        const cellGap    = parseFloat(boardStyle.columnGap) || 0;
        const gapWidth   = cellGap * (selectedSector.cols - 1);
        const raw        = Math.floor((wrapWidth - gapWidth) / selectedSector.cols);

        return Math.max(1, Math.min(40, raw));
    }

    /**
     * ボードサイズを更新する。
     */
    function updateBoardSize() {
        boardEl.style.setProperty('--cell', `${cellSize()}px`);
    }

    /**
     * 画面へ描画する。
     */
    function render() {
        updateBoardSize();
        boardEl.style.gridTemplateColumns = `repeat(${selectedSector.cols}, var(--cell))`;
        boardEl.innerHTML = '';

        // セルの描画
        processAllCells((r, c) => {
            const cell = document.createElement('div');
            cell.className = 'cell covered';
            cell.dataset.r = String(r);
            cell.dataset.c = String(c);

            boardEl.appendChild(cell);
        });

        requestAnimationFrame(updateBoardSize);
    }

    /**
     * 指定アドレスセルのHTMLElementを取得する。
     *
     * @param {number} r
     * @param {number} c
     * @return {HTMLElement}
     */
    function getCellElement(r, c) {
        const idx = r * selectedSector.cols + c;

        return boardEl.children[idx];
    }

    /**
     * フラッグのSVGタグを返却する。
     *
     * @return {string}
     */
    function flagSVG() {
        return `<svg class="flag-icon" viewBox="0 0 24 24" fill="none"><path d="M6 21V4" stroke="#6b6259" stroke-width="2" stroke-linecap="round"/><path d="M6 4h12l-3 4 3 4H6" fill="#c98a7d"/></svg>`;
    }

    /**
     * 地雷のSVGタグを返却する。
     *
     * @return {string}
     */
    function mineSVG(){
        return `<svg class="mine-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6" fill="#5b5248"/><g stroke="#5b5248" stroke-width="2" stroke-linecap="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M19 5l-2.8 2.8M7.8 16.2L5 19"/></g></svg>`;
    }

    /**
     * 指定アドレスセルのElementを描画する。
     *
     * @param {number} r
     * @param {number} c
     */
    function drawCell(r, c) {
        const data = getCellData(r, c);
        const el   = getCellElement(r, c);

        // 開放済みのセルの場合
        if (data.open) {
            el.className = 'cell open';

            // 地雷表示
            if (data.mine) {
                el.classList.add((data.trigger) ? 'mine-trigger' : 'mine');
                el.innerHTML = mineSVG();
            }
            // 周囲の地雷数を表示
            else if (data.count > 0) {
                el.classList.add(`n${data.count}`);
                el.textContent = String(data.count);
            }
            // それ以外は何もしない
            else {
                el.innerHTML = '';
            }
        }
        // 閉じたセルの場合
        else {
            el.className = 'cell covered';
            el.innerHTML = (data.flag) ? flagSVG() : '';

            // 失敗時
            if (result === 'dead') {
                // 隠されている地雷を表示
                if (!data.flag && data.mine) {
                    el.classList.add('open', 'mine');
                    el.innerHTML = mineSVG();
                }
                // 間違えて立てているフラグをアウトラインでハイライト
                else if (data.flag && !data.mine) {
                    el.style.outline = '2px solid var(--t16-ink)';
                }
            }
        }
    }

    /**
     * 全セルを描画する。
     */
    function drawAllCells() {
        processAllCells(drawCell);
    }

    /**
     * 指定アドレスのセルを開ける。
     *
     * @param {number} r
     * @param {number} c
     */
    function openCell(r, c) {
        // ゲームオーバーまたはクリア後は何もしない
        if (gameOver) {
            return;
        }

        // セルが開封済みかフラッグが立てられている場合は何もしない
        const data = getCellData(r, c);
        if (data.open || data.flag) {
            return;
        }

        // 最初の穴開け時の動作
        if (!firstClickDone) {
            // 最初の穴開け時に爆弾を配置する
            placeMines(r, c);

            firstClickDone = true;

            // タイマー開始
            startTimer();
            // ステータスドットは初期状態に
            updateStatusDotCssClass(null);
        }

        // 開封対象を積んでいくスタック配列
        const stack = [[r, c]];

        // 開封箇所を起点に周囲に地雷がないセルを連続して開封していく
        while (stack.length > 0) {
            const [cr, cc] = stack.pop();
            const d = getCellData(cr, cc);

            // 既に開封済みであったりフラッグが立てられていれば無視
            if (d.open || d.flag) {
                continue;
            }

            // 開封済みにする
            d.open = true;
            opened++;

            // 地雷を開封してしまったら負け
            if (d.mine) {
                d.trigger = true;

                return deadGame();
            }

            // 開封したセルを描画
            drawCell(cr, cc);

            // 開封したセルの周囲に地雷が無い場合
            if (d.count === 0) {
                // 周囲のセルを走査
                for (const [nr, nc] of neighbors(cr, cc)) {
                    const nData = getCellData(nr, nc);

                    // 周囲のセルが未開封かつフラッグが立てられていなければスタックに積み再帰的に開封
                    if (!nData.open && !nData.flag) {
                        stack.push([nr, nc]);
                    }
                }
            }
        }

        // クリア判定
        checkClear();
    }

    /**
     * 指定アドレスセルの周囲の隠されたセルを一括で開く。
     * ※周囲に地雷が1つ以上の数字セルが対象。
     *
     * @param {number} r
     * @param {number} c
     */
    function chord(r, c) {
        const data = getCellData(r, c);

        // クリック箇所が未開封または周囲に地雷がない場合は何もしない
        if (!data.open || data.count === 0) {
            return;
        }

        // 周囲のセル情報を取得
        const nbrs = neighbors(r, c);
        // 周囲のフラッグ立てセル数を取得
        const flaggedCellCount = nbrs.filter(([nr, nc]) => getCellData(nr, nc).flag).length;

        // 周囲のフラッグ立てセル数が周囲の数字セルの値と一致しない場合は何もしない
        if (flaggedCellCount !== data.count) {
            return;
        }

        // 周囲のセルを1つずつ操作
        for (const [nr, nc] of nbrs) {
            const nData = getCellData(nr, nc);
            // セルが開封済みもしくはフラッグ立てされている場合は何もしない
            if (nData.open || nData.flag) {
                continue;
            }

            // セルを開封
            openCell(nr, nc);

            // openCell() でクリア判定が入るので判定された場合は中断
            if (gameOver) {
                return;
            }
        }
    }

    /**
     * 指定アドレスセルのフラッグを上げ下げ (トグル) する。
     *
     * @param {number} r
     * @param {number} c
     */
    function toggleFlag(r, c) {
        // ゲームオーバー状態の場合は何もしない
        if (gameOver) {
            return;
        }

        const data = getCellData(r, c);

        // セルが開封済みの場合は何もしない
        if (data.open) {
            return;
        }

        // フラグ切り替え
        data.flag = !data.flag;
        // 立てているフラッグ数の更新
        flags += (data.flag) ? 1 : -1;

        // 残地雷数の再描画
        updateMineCounter();
        // セルの再描画
        drawCell(r, c);

        // スマホのバイブレーション
        if (navigator.vibrate && typeof navigator.vibrate === 'function') {
            navigator.vibrate(15);
        }
    }

    /**
     * 指定アドレスセルの周囲の未確定マスを一括で開く際にどこが開くかをCSSクラス付与で表示制御する。
     *
     * @param {number} r
     * @param {number} c
     * @param {boolean} on
     */
    function previewChord(r, c, on) {
        // グリッドのインデックスチェック
        if (!grid[r] || !grid[r][c]) {
            return;
        }

        // 自身を含めた周囲セル
        const cells = [[r, c], ...neighbors(r, c)];
        cells.forEach(([nr, nc]) => {
            const nData = getCellData(nr, nc);
            // 未開封でフラッグが立っていないセルが対象
            if (!nData.open && !nData.flag) {
                getCellElement(nr, nc).classList.toggle('combo-preview', on);
            }
        });
    }

    /**
     * バナー制御。
     * ゲームオーバー時に表示され、プレイ時は非表示。
     *
     * @param {string} result
     * @param {string} message
     */
    function refreshBanner(result, message) {
        bannerEl.className = `banner ${result}`;
        bannerEl.textContent = message;
    }

    /**
     * 地雷を踏んでしまったときのバナーを表示する。
     */
    function deadBanner() {
        refreshBanner('dead', "爆発 — 地雷を踏みました");
    }

    /**
     * ゲームクリア時のバナーを表示する。
     */
    function clearBanner() {
        refreshBanner('clear', "探知完了 — フィールドは安全です");
    }

    /**
     * バナーを非表示にする。
     */
    function hideBanner() {
        refreshBanner('hidden', '');
    }

    /**
     * 地雷を踏んでしまったときの処理。
     */
    function deadGame() {
        gameOver = true;
        result   = 'dead';

        stopTimer();
        updateStatusDotCssClass(result);
        drawAllCells();

        deadBanner();
    }

    /**
     * ゲームクリア判定とゲームクリア処理。
     */
    function checkClear() {
        const total = selectedSector.rows * selectedSector.cols;

        // 開封済みのセル数が `全セル - 地雷数` と等しい場合にゲームクリア
        if(opened === (total - selectedSector.mines)){
            gameOver = true;
            result   = 'clear';

            // タイマー停止
            stopTimer();

            // 立てたフラッグ数を地雷数に合わせる
            flags = selectedSector.mines;
            // 表示されている残地雷数は `flags` 基準で算出しているので表示も 0 になる
            updateMineCounter();

            // ゲームクリアのドット
            updateStatusDotCssClass(result);
            // ゲームクリアのバナー表示
            clearBanner();
        }
    }

    /**
     * ニューゲーム開始。
     */
    function newGame() {
        // グリッド初期化
        buildGrid();

        // 各変数初期化
        firstClickDone = false;
        gameOver       = false;
        opened         = 0;
        flags          = 0;
        result         = null;

        // タイマー停止
        stopTimer();
        // 経過時間初期化
        seconds = 0;
        timerEl.textContent = pad3(0);

        // 残地雷数初期化
        updateMineCounter();

        // ステータスドット初期化
        updateStatusDotCssClass(null);

        // バナー非表示
        hideBanner();
        // 画面描画
        render();

        // localStorageも初期状態で保存
        persist();
    }

    /**
     * 復元データから再開かニューゲームか制御。
     */
    function restoreOrStart() {
        // 保存データが存在しなかったりデータ復元に失敗した場合はニューゲーム
        const saved = loadSaved();
        if (!saved) {
            newGame();

            return;
        }

        // 保存されているセクター
        sectorKey      = saved.sector;
        selectedSector = SECTORS[sectorKey];

        // セルをグリッドに復元
        restoreCells(saved.cells);

        // 各変数を復元
        firstClickDone = !!saved.firstClickDone;
        gameOver       = !!saved.gameOver;
        seconds        = (typeof saved.seconds === 'number') ? saved.seconds : 0;
        opened         = (typeof saved.opened  === 'number') ? saved.opened  : 0;
        flags          = (typeof saved.flags   === 'number') ? saved.flags   : 0;
        result         = (saved.result === 'clear' || saved.result === 'dead') ? saved.result : null;

        // ゲームオーバーから result を復元
        if (gameOver && result === null) {
            result = (opened === selectedSector.rows * selectedSector.cols - selectedSector.mines) ? 'clear' : 'dead';
        }

        // セクターボタン更新
        syncSectorButtons();
        // ステータスドット更新
        updateStatusDotCssClass(result);
        // 画面描画
        render();
        // すべてのセルを再描画
        drawAllCells();

        // タイマー表示更新
        timerEl.textContent = pad3(seconds);
        // 残地雷数更新
        updateMineCounter();

        // バナー更新
        if (result === 'dead') {
            deadBanner();
        } else if (result === 'clear') {
            clearBanner();
        } else {
            hideBanner();

            // 中断時はタイマー再開
            if (firstClickDone) {
                startTimer();
            }
        }
    }

    /*
     * リセットボタンのクリックイベント登録
     */
    resetBtn.addEventListener('click', newGame);

    /* ---------- タッチ / ペン用: タップ=開く, 長押し=旗 ---------- */
    let press = null;

    /**
     * セルの押下処理。
     *
     * @param {Element} cell
     * @param {number} r
     * @param {number} c
     */
    function startPress(cell, r, c){
        if (gameOver || cell.classList.contains('open')) {
            return;
        }

        const ring = document.createElement('div');
        ring.className = 'press-ring';
        cell.appendChild(ring);

        const start = performance.now();
        press = { r, c, cell, ring, startX: 0, startY: 0, fired: false, cancelled: false };

        const loop = (now) => {
            if (!press || press.cancelled) {
                return;
            }

            const diff = now - start;

            ring.style.setProperty('--p', String(Math.min(100, (diff / HOLD_MS) * 100)));

            if (diff >= HOLD_MS) {
                press.fired = true;

                toggleFlag(r, c);
                persist();
                cleanupPress();

                return;
            }

            press.raf = requestAnimationFrame(loop);
        };

        press.raf = requestAnimationFrame(loop);
    }

    /**
     * セルの押下状態を初期化。
     */
    function cleanupPress() {
        if (press) {
            if (press.raf) {
                cancelAnimationFrame(press.raf);
            }
            if (press.ring && press.ring.parentNode) {
                press.ring.parentNode.removeChild(press.ring);
            }
        }

        press = null;
    }

    /**
     * セル押下イベントの離脱処理。
     *
     * @param {Event} e
     */
    function endPress(e) {
        const cellDiv = e.target.closest('.cell');

        if (press && !press.fired && !press.cancelled && cellDiv) {
            const r    = press.r;
            const c    = press.c;
            const data = getCellData(r, c);

            if (data.open) {
                chord(r, c);
            } else if (!data.flag) {
                openCell(r, c);
            }
        }

        cleanupPress();
    }

    /* ---------- マウス用: 左クリック=開く, 右クリック=旗, 左右同時=一括で開く ---------- */
    /** @type {MousePressState|null} */
    let mousePress = null;

    boardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    /**
     * 【マウス操作時】押下したセルの情報を取得する。
     *
     * @param {Event} e
     * @return {{cellDiv: Element, r: number, c: number}|null}
     */
    function cellAddressFromEvent(e) {
        const cellDiv = e.target.closest('.cell');
        if (!cellDiv) {
            return null;
        }

        return {
            cellDiv,
            r: +(cellDiv.dataset.r),
            c: +(cellDiv.dataset.c)
        };
    }

    /**
     * 【マウス操作時】押下状態を初期化する。
     */
    function resetMousePress() {
        if (mousePress) {
            previewChord(mousePress.r, mousePress.c, false);
            mousePress = null;
        }
    }

    /*
     * 【マウス操作時】クリック押下
     */
    boardEl.addEventListener('mousedown', (e) => {
        const addr = cellAddressFromEvent(e);
        if (!addr || gameOver) {
            return;
        }

        e.preventDefault();

        const { r, c } = addr;

        if (!mousePress || mousePress.r !== r || mousePress.c !== c) {
            resetMousePress();
            mousePress = { r, c, chordPress: false };
        }

        if (e.buttons === 3) {
            mousePress.chordPress = true;
            previewChord(r, c, true);
        }
    });

    /*
     * 【マウス操作時】クリック離し
     */
    boardEl.addEventListener('mouseup', (e) => {
        if (!mousePress) {
            return;
        }

        const addr = cellAddressFromEvent(e);
        const { r, c, chordPress } = mousePress;
        const sameCell = (addr && addr.r === r && addr.c === c);

        // 片方のボタンがまだ押されたままなら、もう片方が離れるまで待つ
        if (e.buttons !== 0) {
            return;
        }

        previewChord(r, c, false);

        if (sameCell && !gameOver) {
            if (chordPress) {
                chord(r, c);
            } else if (e.button === 2) {
                toggleFlag(r, c);
            } else if (e.button === 0) {
                const data = getCellData(r, c);
                if (data.open) {
                    chord(r, c);
                } else if (!data.flag) {
                    openCell(r, c);
                }
            }

            persist();
        }

        mousePress = null;
    });

    boardEl.addEventListener('mouseleave', resetMousePress);

    /*
     * 【スマホ操作時】タップ開始
     */
    boardEl.addEventListener('pointerdown', (e) => {
        const cellDiv = e.target.closest('.cell');
        if (!cellDiv) {
            return;
        }
        const r = +(cellDiv.dataset.r);
        const c = +(cellDiv.dataset.c);

        if (e.pointerType === 'mouse') {
            return;
        }

        // タッチ / ペン
        startPress(cellDiv, r, c);
        if (press) {
            press.startX = e.clientX;
            press.startY = e.clientY;
        }
    });

    /*
     * 【スマホ操作時】タップ移動
     */
    boardEl.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') {
            return;
        }
        if (!press) {
            return;
        }

        const dx = e.clientX - press.startX;
        const dy = e.clientY - press.startY;

        if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) {
            press.cancelled = true;
            cleanupPress();
        }
    });

    /*
     * 【スマホ操作時】タップ離し
     */
    boardEl.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse') {
            return;
        }

        endPress(e);
        persist();
    });

    /*
     * 【スマホ操作時】タップキャンセル
     */
    boardEl.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'mouse') {
            resetMousePress();

            return;
        }
        cleanupPress();
    });

    /*
     * ページリサイズ
     */
    window.addEventListener('resize', () => {
        // ボードサイズ更新
        updateBoardSize();
    });

    // サービスワーカーの登録は shared/register-sw.js が一括で行う (このファイルでは行わない)

    /*
     * ページ非表示時は状態をlocalStorageに保存
     */
    window.addEventListener('pagehide', persist);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            persist();
        }
    });

    // セクターセレクトボタンの配置
    initSectorButtons();

    // ゲーム開始
    restoreOrStart();
})();
