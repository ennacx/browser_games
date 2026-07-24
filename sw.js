// game リポジトリ全体で共有する、唯一のサービスワーカー。
//
// 設計方針:
//   - ゲームを1本追加するたびにワーカーを増やしたり、このファイルにパスを追記したりする必要はない。
//   - 「同一オリジンのGETリクエストは、アクセスされた時点でキャッシュに積んでいく」という
//     ランタイムキャッシュ(stale-while-revalidate)方式にすることで、新しいゲームのフォルダを
//     置くだけで自動的にオフライン対応の対象になる。
//   - キャッシュの中身を作り直したい(古いバージョンを一掃したい)ときだけ CACHE_NAME の
//     バージョン番号を上げる。

const CACHE_NAME = 'game-hub-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET以外(POSTなど)や他オリジン(Googleフォントなど)はブラウザの通常キャッシュに任せる
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);

      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        // 表示は即キャッシュから、裏で最新版に更新しておく(次回アクセス時に反映)
        event.waitUntil(networkFetch);
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;

      // オフラインかつ未キャッシュのページ遷移 → そのゲーム(またはハブ)のトップに逃がす
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }

      return new Response('オフラインのため表示できません', {
        status: 504,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })
  );
});
