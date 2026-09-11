/* AI加词 Service Worker：只缓存带内容哈希的静态资源，页面与 API 一律走网络（基础 PWA，需求 4.1） */
// 改站点图标 / manifest 后要能让老用户看到新版：版本号跟着发布走，
// 并且只有带内容哈希的 /_next/static/ 才缓存优先（审计 F130）。
// 页面不进缓存：首屏数据已经服务端直出，HTML 里带的是当前用户的数据，
// 存进 Cache Storage 会被同一台设备上换账号后的人读到（性能优化 P1-1）。
// 反正接口本来就不缓存，页面缓存也换不来可用的离线体验。
const VERSION = "aiword-v3";
const STATIC = /\/_next\/static\//;
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(req)) ?? fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })));
    return;
  }
  // 其余（页面、接口、图标、manifest）一律交给浏览器自己按响应头处理，不进 Cache Storage
});
