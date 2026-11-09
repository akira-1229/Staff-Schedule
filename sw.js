// ホーム画面に追加（インストール）できるようにするための最小限の Service Worker。
// キャッシュは一切しない（常に最新の予定表・プログラムを読むため）。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // アップロードなどはそのまま
  e.respondWith(fetch(e.request));
});
