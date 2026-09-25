/* 随身理财 · Service Worker
 * 目标：让应用可离线打开（壳与静态资源缓存）。
 * 原则：只缓存同源 GET 静态资源，绝不拦截 /api/*（数据始终走网络，保证账本最新）。
 * 升级：版本号变化时自动清理旧缓存。 */

const CACHE = "wo-shell-v1";
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 跨域（行情等）一律不缓存
  if (url.pathname.startsWith("/api/")) return; // API 永不缓存

  // 静态资源：stale-while-revalidate（命中即返回，同时后台刷新缓存）
  event.respondWith(
    caches.match(request).then((hit) => {
      const refresh = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});
