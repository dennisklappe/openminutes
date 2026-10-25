const CACHE_PREFIX = 'openminutes-shell-';
const CACHE = `${CACHE_PREFIX}__BUILD__`;
const SHELL = ['/', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
const NEVER_CACHE = ['/api/', '/s/'];

const sameOrigin = (url) => url.origin === self.location.origin;
const cacheable = (response) =>
  response.ok && response.type === 'basic' && !response.redirected && response.status === 200;
const excluded = (url) => NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix));

async function store(cache, url, response) {
  if (cacheable(response)) await cache.put(url, response.clone());
}

async function fetchFresh(url) {
  try {
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'follow' });
    return cacheable(response) ? response : undefined;
  } catch {
    return undefined;
  }
}

function referencedAssets(text) {
  const found = text.matchAll(/(?:src=|href=|url\()["']?(\/assets\/[^"')\s]+)/g);
  return [...new Set([...found].map((match) => match[1]))];
}

async function precache() {
  const cache = await caches.open(CACHE);
  const page = await fetchFresh('/');
  if (!page) throw new Error('shell unavailable');
  await store(cache, '/', page);
  const assets = referencedAssets(await page.text());
  const styles = [];
  for (const asset of assets) {
    const response = await fetchFresh(asset);
    if (!response) continue;
    await store(cache, asset, response);
    if (asset.endsWith('.css')) styles.push(await response.text());
  }
  const fonts = styles.flatMap(referencedAssets).filter((asset) => !assets.includes(asset));
  for (const url of [...fonts, ...SHELL.slice(1)]) {
    const response = await fetchFresh(url);
    if (response) await store(cache, url, response);
  }
}

async function navigate(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (cacheable(response) && new URL(request.url).pathname === '/') {
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    const shell = await cache.match('/');
    if (shell) return shell;
    throw new Error('offline and no cached shell');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  await store(cache, request, response);
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    await store(cache, request, response);
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    !sameOrigin(url) ||
    excluded(url) ||
    request.headers.has('range')
  ) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname !== '/sw.js') {
    event.respondWith(networkFirst(request));
  }
});
