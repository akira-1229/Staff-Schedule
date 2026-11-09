// ホーム画面に追加（インストール）できるようにするための最小限の Service Worker。
// キャッシュは一切しない（常に最新の予定表・プログラムを読むため）。
// GitHub など別のサイトへの通信（鍵の確認・アップロード）には一切関わらない。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req));
});
