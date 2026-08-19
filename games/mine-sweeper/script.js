(function () {
    const SECTORS = {
        small:  { rows:  9, cols:  9, mines: 10, label: "狭域" },
        medium: { rows: 16, cols: 16, mines: 40, label: "中域" },
        large:  { rows: 24, cols: 16, mines: 80, label: "広域" }
    };
    const HOLD_MS        = 480;
    const MOVE_CANCEL_PX = 10;

    const STORAGE_KEY    = 'mineSweeper.save.v1';

    let sectorKey      = 'small';
    let cfg            = SECTORS[sectorKey];
    let grid           = [];
    let firstClickDone = false;
    let gameOver       = false;
    let opened         = 0;
    let flags          = 0;
    let timerId        = null;
    let seconds        = 0;

    let result          = null;
    let memoryFallback  = null;

    const boardEl     = document.getElementById('board');
    const mineCountEl = document.getElementById('mineCount');
    const timerEl     = document.getElementById('timer');
    const statusDot   = document.getElementById('statusDot');
    const sectorSelEl = document.getElementById('sectorSelect');
    const bannerEl    = document.getElementById('banner');
    const resetBtn    = document.getElementById('resetBtn');

    function pad3(n) {
        const neg = (n < 0);
        const v   = Math.min(999, Math.abs(n)); // 999が最大値
        const s   = String(v).padStart(3, '0');

        return (neg) ? `-${s.slice(1)}` : s;
    }

    function neighbors(r, c) {
        const res = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) {
                    continue;
                }

                const nr = r + dr;
                const nc = c + dc;

                if (nr >= 0 && nr < cfg.rows && nc >= 0 && nc < cfg.cols) {
                    res.push([nr, nc]);
                }
            }
        }

        return res;
    }

    function buildGrid() {
        grid = [];
        for (let r = 0; r < cfg.rows; r++) {
            const row = [];
            for (let c = 0; c < cfg.cols; c++) {
                row.push({ mine: false, count: 0, open: false, flag: false });
            }

            grid.push(row);
        }
    }

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
            return memoryFallback;
        }
    }

    function createCellStates() {
        const cells = [];

        for (let r = 0; r < cfg.rows; r++) {
            for (let c = 0; c < cfg.cols; c++) {
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
            }
        }

        return cells;
    }

    function persist() {
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
            // 保存できない環境ではメモリ保持のみ (このタブを閉じるまで有効)
        }
    }

    function restoreCells(cells) {
        buildGrid();

        for (const cell of cells) {
            if (
                typeof cell.r !== 'number'
                || typeof cell.c !== 'number'
                || cell.r < 0
                || cell.r >= cfg.rows
                || cell.c < 0
                || cell.c >= cfg.cols
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

    function syncSectorButtons() {
        document.querySelectorAll('.chip').forEach((chip) => {
            chip.classList.toggle('active', chip.dataset.sector === sectorKey);
        });
    }

    function getCellData(r, c) {
        return grid[r][c] ?? undefined;
    }


    function setCellData(r, c, data) {
        grid[r][c] = data;
    }

    function updateCellElement(r, c, element, value) {
        grid[r][c][element] = value;
    }

    function placeMines(safeR, safeC) {
        const safeSet = new Set(neighbors(safeR, safeC).map(([r, c]) => `${r}_${c}`));
        safeSet.add(`${safeR}_${safeC}`);

        let placed = 0;
        while (placed < cfg.mines) {
            const r = Math.floor(Math.random() * cfg.rows);
            const c = Math.floor(Math.random() * cfg.cols);
            const key = `${r}_${c}`;

            if (getCellData(r, c).mine || safeSet.has(key)) {
                continue;
            }

            updateCellElement(r, c, 'mine', true);
            placed++;
        }

        for (let r = 0; r < cfg.rows; r++) {
            for (let c = 0; c < cfg.cols; c++) {
                if(getCellData(r, c).mine) {
                    continue;
                }

                const cnt = neighbors(r, c).filter(([nr, nc]) => getCellData(nr, nc).mine).length;
                updateCellElement(r, c, 'count', cnt);
            }
        }
    }

    function setStatus(state) {
        statusDot.className = `status-dot${(state) ? ` ${state}` : ''}`;
    }

    function stopTimer() {
        if (timerId) {
            clearInterval(timerId);
            timerId = null;
        }
    }

    function startTimer() {
        stopTimer();

        timerId = setInterval(() => {
            if (gameOver) {
                return;
            }

            seconds++;
            timerEl.textContent = pad3(seconds);
            persist();
        }, 1000);
    }

    function updateMineCounter() {
        mineCountEl.textContent = pad3(cfg.mines - flags);
    }

    function cellSize() {
        const wrap       = document.querySelector('.board-wrap');
        const style      = getComputedStyle(wrap);
        const padX       = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const wrapWidth  = Math.min(wrap.clientWidth - padX, 560);
        const boardStyle = getComputedStyle(boardEl);
        const cellGap    = parseFloat(boardStyle.columnGap) || 0;
        const gapWidth   = cellGap * (cfg.cols - 1);
        const raw        = Math.floor((wrapWidth - gapWidth) / cfg.cols);

        return Math.max(1, Math.min(40, raw));
    }

    function updateBoardSize() {
        boardEl.style.setProperty('--cell', `${cellSize()}px`);
    }

    function render() {
        updateBoardSize();
        boardEl.style.gridTemplateColumns = `repeat(${cfg.cols}, var(--cell))`;
        boardEl.innerHTML = '';

        for (let r = 0; r < cfg.rows; r++) {
            for (let c = 0; c < cfg.cols; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell covered';
                cell.dataset.r = String(r);
                cell.dataset.c = String(c);

                boardEl.appendChild(cell);
            }
        }

        requestAnimationFrame(updateBoardSize);
    }

    function cellEl(r, c) {
        const idx = r * cfg.cols + c;

        return boardEl.children[idx];
    }

    function flagSVG() {
        return `<svg class="flag-icon" viewBox="0 0 24 24" fill="none"><path d="M6 21V4" stroke="#6b6259" stroke-width="2" stroke-linecap="round"/><path d="M6 4h12l-3 4 3 4H6" fill="#c98a7d"/></svg>`;
    }
    function mineSVG(){
        return `<svg class="mine-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6" fill="#5b5248"/><g stroke="#5b5248" stroke-width="2" stroke-linecap="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M19 5l-2.8 2.8M7.8 16.2L5 19"/></g></svg>`;
    }

    function drawCell(r, c) {
        const data = getCellData(r, c);
        const el   = cellEl(r, c);

        if (data.open) {
            el.className = 'cell open';

            if (data.mine) {
                el.classList.add((data.trigger) ? 'mine-trigger' : 'mine');
                el.innerHTML = mineSVG();
            } else if (data.count > 0) {
                el.classList.add(`n${data.count}`);
                el.textContent = data.count;
            } else {
                el.innerHTML = '';
            }
        } else {
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

    function drawAll() {
        for (let r = 0; r < cfg.rows; r++) {
            for (let c = 0; c < cfg.cols; c++) {
                drawCell(r, c);
            }
        }
    }

    function openCell(r, c) {
        if (gameOver) {
            return;
        }

        const data = getCellData(r, c);
        if (data.open || data.flag) {
            return;
        }

        // 最初の穴開け時の動作
        if (!firstClickDone) {
            placeMines(r, c);

            firstClickDone = true;
            startTimer();

            setStatus(null);
        }

        const stack = [[r, c]];
        while (stack.length) {
            const [cr, cc] = stack.pop();
            const d = getCellData(cr, cc);

            if (d.open || d.flag) {
                continue;
            }

            d.open = true;
            opened++;

            if (d.mine) {
                d.trigger = true;

                return deadGame();
            }

            drawCell(cr, cc);

            if (d.count === 0) {
                for (const [nr, nc] of neighbors(cr, cc)) {
                    const nData = getCellData(nr, nc);
                    if (!nData.open && !nData.flag) {
                        stack.push([nr, nc]);
                    }
                }
            }
        }

        checkClear();
    }

    function chord(r, c) {
        const data = getCellData(r, c);
        if (!data.open || data.count === 0) {
            return;
        }

        const nbrs    = neighbors(r, c);
        const flagged = nbrs.filter(([nr, nc]) => getCellData(nr, nc).flag).length;

        if (flagged !== data.count) {
            return;
        }

        for (const [nr, nc] of nbrs) {
            const nData = getCellData(nr, nc);
            if (!nData.open && !nData.flag) {
                openCell(nr, nc);

                if (gameOver) {
                    return;
                }
            }
        }
    }

    function toggleFlag(r, c) {
        if (gameOver) {
            return;
        }

        const data = getCellData(r, c);
        if (data.open) {
            return;
        }

        data.flag = !data.flag;
        flags += (data.flag) ? 1 : -1;

        updateMineCounter();
        drawCell(r, c);

        if (navigator.vibrate) {
            navigator.vibrate(15);
        }
    }

    function previewChord(r, c, on) {
        if (!grid[r] || !grid[r][c]) {
            return;
        }

        const cells = [[r, c], ...neighbors(r, c)];
        cells.forEach(([nr, nc]) => {
            const nData = getCellData(nr, nc);
            if (!nData.open && !nData.flag) {
                cellEl(nr, nc).classList.toggle('combo-preview', on);
            }
        });
    }

    function refreshBanner(result, message) {
        bannerEl.className = `banner ${result}`;
        bannerEl.textContent = message;
    }

    function deadBanner() {
        refreshBanner('dead', "爆発 — 地雷を踏みました");
    }

    function clearBanner() {
        refreshBanner('clear', "探知完了 — フィールドは安全です");
    }

    function hideBanner() {
        refreshBanner('hidden', '');
    }

    function deadGame() {
        gameOver = true;
        result   = 'dead';

        stopTimer();
        setStatus(result);
        drawAll();

        deadBanner();
    }

    function checkClear() {
        const total = cfg.rows * cfg.cols;
        if(opened === (total - cfg.mines)){
            gameOver = true;
            result   = 'clear';

            stopTimer();
            setStatus(result);

            flags = cfg.mines;
            updateMineCounter();

            clearBanner();
        }
    }

    function newGame() {
        buildGrid();

        firstClickDone = false;
        gameOver       = false;
        opened         = 0;
        flags          = 0;
        result         = null;

        stopTimer();
        seconds = 0;
        timerEl.textContent = pad3(0);

        updateMineCounter();
        setStatus(null);

        hideBanner();
        render();
        persist();
    }

    function restoreOrStart() {
        const saved = loadSaved();
        if (!saved) {
            newGame();

            return;
        }

        sectorKey = saved.sector;
        cfg       = SECTORS[sectorKey];

        restoreCells(saved.cells);

        firstClickDone = !!saved.firstClickDone;
        gameOver       = !!saved.gameOver;
        seconds        = (typeof saved.seconds === 'number') ? saved.seconds : 0;
        opened         = (typeof saved.opened === 'number') ? saved.opened : 0;
        flags          = (typeof saved.flags === 'number') ? saved.flags : 0;
        result         = (saved.result === 'clear' || saved.result === 'dead') ? saved.result : null;

        if (gameOver && result === null) {
            result = (opened === cfg.rows * cfg.cols - cfg.mines) ? 'clear' : 'dead';
        }

        syncSectorButtons();
        setStatus(result);
        render();
        drawAll();

        timerEl.textContent = pad3(seconds);
        updateMineCounter();

        if (result === 'dead') {
            deadBanner();
        } else if (result === 'clear') {
            clearBanner();
        } else {
            hideBanner();

            if (firstClickDone) {
                startTimer();
            }
        }

    }

    /*
     * フィールドセレクトボタンの配置
     */
    Object.keys(SECTORS).forEach((k, i) => {
        const selBtn = document.createElement('button');

        selBtn.classList.add('chip');
        if (i === 0) {
            selBtn.classList.add('active');
        }

        selBtn.dataset.sector = k;
        selBtn.textContent = `${SECTORS[k].label} ${SECTORS[k].cols}×${SECTORS[k].rows}`;

        sectorSelEl.appendChild(selBtn);
    });

    /*
     * フィールドセレクトボタンのクリックイベント登録
     */
    document.querySelectorAll('.chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            sectorKey = chip.dataset.sector;
            cfg       = SECTORS[sectorKey];

            syncSectorButtons();

            newGame();
        });
    });

    resetBtn.addEventListener('click', newGame);

    /* ---------- タッチ / ペン用: タップ=開く, 長押し=旗 ---------- */
    let press = null;

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

            const elapsed = now - start;

            ring.style.setProperty('--p', String(Math.min(100, (elapsed / HOLD_MS) * 100)));

            if (elapsed >= HOLD_MS) {
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
    let mouseDown = null; // { r, c, combo }

    boardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    boardEl.addEventListener('pointerdown', (e) => {
        const cellDiv = e.target.closest('.cell');
        if (!cellDiv) {
            return;
        }
        const r = +(cellDiv.dataset.r);
        const c = +(cellDiv.dataset.c);

        if (e.pointerType === 'mouse') {
            if(gameOver) {
                return;
            }

            e.preventDefault();

            if (!mouseDown || mouseDown.r !== r || mouseDown.c !== c) {
                if (mouseDown) {
                    previewChord(mouseDown.r, mouseDown.c, false);
                }

                mouseDown = { r, c, combo: false };
            }
            if (e.buttons === 3) {
                mouseDown.combo = true;
                previewChord(r, c, true);
            }

            return;
        }

        // タッチ / ペン
        startPress(cellDiv, r, c);
        if (press) {
            press.startX = e.clientX;
            press.startY = e.clientY;
        }
    });

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

    boardEl.addEventListener('pointerup', (e) => {
        const cellDiv = e.target.closest('.cell');

        if(e.pointerType === 'mouse'){
            if(!mouseDown) {
                return;
            }

            const { r, c, combo } = mouseDown;
            const sameCell = cellDiv && (+(cellDiv.dataset.r) === r && +(cellDiv.dataset.c) === c);

            // 片方のボタンはまだ押されたまま → もう片方が離れるまで待つ
            if (e.buttons !== 0) {
                return;
            }

            previewChord(r, c, false);

            if (sameCell && !gameOver) {
                if (combo) {
                    chord(r, c);
                } else if (e.button === 2) {
                    toggleFlag(r, c);
                } else if( e.button === 0) {
                    const data = getCellData(r, c);
                    if(data.open) {
                        chord(r, c);
                    } else if (!data.flag) {
                        openCell(r, c);
                    }
                }

                persist();
            }

            mouseDown = null;

            return;
        }

        endPress(e);
        persist();
    });

    boardEl.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'mouse') {
            if (mouseDown) {
                previewChord(mouseDown.r, mouseDown.c, false);
            }

            mouseDown = null;

            return;
        }
        cleanupPress();
    });

    window.addEventListener('resize', () => {
        updateBoardSize();
    });

    // サービスワーカーの登録は shared/register-sw.js が一括で行う (このファイルでは行わない)

    window.addEventListener('pagehide', persist);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            persist();
        }
    });

    restoreOrStart();
})();
