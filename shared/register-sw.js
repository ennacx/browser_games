/*
 * どのゲームのページからも、このファイルを1回 <script src="…/shared/register-sw.js"> するだけでよい。
 * ルート直下の sw.js を、サイト全体(ハブ + すべてのゲーム)をカバーする scope で1回だけ登録する。
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

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(swUrl, { scope }).catch(() => {
            // 登録に失敗してもゲーム自体は通常どおり遊べる(オフライン対応が効かないだけ)
        });
    });
})();
