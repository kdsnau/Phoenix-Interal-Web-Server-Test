/* Phoenix Portal service worker.
 *
 * Deliberately conservative. The rules, in order of how much they matter:
 *
 *   1. /api and /uploads are NEVER touched. Responses there are per-user and
 *      authenticated; caching them would leak one user's data to the next and
 *      show stale tickets. Those requests aren't intercepted at all.
 *   2. Navigations are network-first. index.html names the content-hashed asset
 *      bundles, so a stale copy would point at files that no longer exist. The
 *      cached copy is only used as an offline fallback.
 *   3. /assets/* is cache-first. Vite content-hashes those filenames, so a given
 *      URL can never change meaning — this is where the speed comes from.
 *
 * Bump SW_VERSION to force every client to drop its caches on next load.
 */

const SW_VERSION  = 'v1';
const SHELL_CACHE = `phoenix-shell-${SW_VERSION}`;
const ASSET_CACHE = `phoenix-assets-${SW_VERSION}`;
const MAX_ASSETS  = 60;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = [SHELL_CACHE, ASSET_CACHE];
        const names = await caches.keys();
        await Promise.all(names.filter(n => !keep.includes(n)).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

/* Hashed bundles are immutable, so old ones are never requested again after a
   deploy — they'd just accumulate. Keep the cache to a sane number of entries,
   evicting oldest-first (cache.keys() returns insertion order). */
async function trimAssetCache() {
    const cache = await caches.open(ASSET_CACHE);
    const keys  = await cache.keys();
    if (keys.length <= MAX_ASSETS) return;
    await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map(k => cache.delete(k)));
}

async function handleNavigation(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) cache.put('/index.html', fresh.clone());
        return fresh;
    } catch {
        const cached = await cache.match('/index.html');
        if (cached) return cached;
        return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
            '<body style="background:#0d0f11;color:#c9d4e0;font-family:sans-serif;' +
            'display:flex;align-items:center;justify-content:center;height:100vh">' +
            '<p>Offline — reconnect to load the portal.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

async function handleAsset(request) {
    const cache  = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
        await cache.put(request, fresh.clone());
        trimAssetCache();
    }
    return fresh;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;          /* fonts, etc. */
    if (url.pathname.startsWith('/api/')) return;             /* never cache */
    if (url.pathname.startsWith('/uploads/')) return;         /* never cache */
    if (url.pathname === '/sw.js') return;

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request));
        return;
    }
    if (url.pathname.startsWith('/assets/')) {
        event.respondWith(handleAsset(request));
    }
});
