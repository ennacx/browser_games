/*
 * どのゲームのページからも、このファイルを1回読む (`<script src="…/shared/register-sw.js">` を登録する) だけでよい。
 * ルート直下の sw.js を、サイト全体(ハブ + すべてのゲーム)をカバーする scope で1回だけ登録し、
 * 新しいバージョンが降ってきたときは「更新する」バナーを出す(オンライン時のみ)。
 * ゲームを増やしても、このファイルやsw.js自体を書き換える必要はない。
 */
(function () {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
        // file:// で直接開いた場合はサービスワーカーを使わない(ゲーム自体は普通に遊べる)
        return;
    }

    const thisScript = document.currentScript;
    if (!thisScript) {
        return;
    }

    /*
     * このスクリプトは "<サイトルート>/shared/register-sw.js" に置く前提。
     * 1つ上の階層(shared/の親)が「サイトルート」= すべてのゲームを含むディレクトリ。
     */
    const siteRoot = new URL('../', thisScript.src);
    const swUrl = new URL('sw.js', siteRoot).href;
    const scope = siteRoot.pathname;

    function injectBannerStyles() {
        if (document.getElementById('pwa-update-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'pwa-update-style';
        style.textContent = `
            #pwa-update-banner {
                position: fixed;
                left: 50%;
                bottom: 18px;
                transform: translateX(-50%);
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 10px;
                background: #fffdfb;
                color: #6b6259;
                border-radius: 14px;
                padding: 10px 10px 10px 16px;
                box-shadow: 0 8px 24px rgba(107, 98, 89, 0.22);
                font-family: 'Quicksand', sans-serif;
                font-size: 13px;
                max-width: calc(100vw - 32px);
                animation: pwa-update-in 0.18s ease;
            }
            #pwa-update-banner button {
                font-family: 'Quicksand', sans-serif;
                font-weight: 600;
                font-size: 12px;
                border: none;
                border-radius: 8px;
                padding: 6px 12px;
                cursor: pointer;
                line-height: 1;
            }
            #pwa-update-banner .pwa-update-refresh {
                background: #c98a7d;
                color: #fff;
            }
            #pwa-update-banner .pwa-update-refresh:hover { filter: brightness(1.06); }
            #pwa-update-banner .pwa-update-dismiss {
                background: transparent;
                color: #a89e92;
                padding: 6px 8px;
            }
            @media (prefers-reduced-motion: reduce) {
                #pwa-update-banner { animation: none; }
            }
            @keyframes pwa-update-in {
                from { opacity: 0; transform: translate(-50%, 8px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
        `;
        document.head.appendChild(style);
    }

    function showUpdateBanner() {
        if (document.getElementById('pwa-update-banner')) {
            return;
        }

        injectBannerStyles();

        const banner = document.createElement('div');
        banner.id = 'pwa-update-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML =
            '<span>新しいバージョンがあります</span>' +
            '<button type="button" class="pwa-update-refresh">更新する</button>' +
            '<button type="button" class="pwa-update-dismiss" aria-label="閉じる">\u00D7</button>';
        document.body.appendChild(banner);

        banner.querySelector('.pwa-update-refresh').addEventListener('click', () => {
            window.location.reload();
        });
        banner.querySelector('.pwa-update-dismiss').addEventListener('click', () => {
            banner.remove();
        });
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(swUrl, { scope }).then((registration) => {
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) {
                    return;
                }

                /*
                 * すでに controller がいる状態で新しいワーカーが 'installed' になった
                 * = 初回インストールではなく「更新」が来たということ。
                 */
                newWorker.addEventListener('statechange', () => {
                    const isUpdate = newWorker.state === 'installed' && navigator.serviceWorker.controller;
                    if (isUpdate && navigator.onLine) {
                        showUpdateBanner();
                    }
                });
            });
        }).catch(() => {
            // 登録に失敗してもゲーム自体は通常どおり遊べる (オフライン対応や更新通知が効かないだけ)
        });
    });
})();
