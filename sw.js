// Service worker stoiska: trzyma pliki aplikacji w pamięci urządzenia, żeby działała bez internetu.
// Przy każdej nowej wersji zmień WERSJA (i WERSJA w js/konfiguracja.js).
const WERSJA = 'or-stoisko-0.12.0';
const OCR = 'or-stoisko-ocr';   // pliki rozpoznawania tekstu – pobierane przy pierwszym użyciu, potem z pamięci
const PLIKI = [
  './', './index.html', './css/stoisko.css', './manifest.webmanifest',
  './js/app.js', './js/api.js', './js/db.js', './js/sync.js', './js/util.js', './js/dane.js', './js/konfiguracja.js',
  './js/nowe.js', './js/lista.js', './js/zamowienie.js', './js/ustawienia.js', './js/wiadomosc.js', './js/klienci.js', './js/sklep.js', './js/poziomy.js', './js/inpost.js', './js/epp.js', './js/eksport-epp.js', './js/prosty.js', './js/wysylki.js', './js/potrzebuje.js', './js/instrukcje.js', './js/powiadomienia.js', './js/mailing.js', './lista.html', './vendor/qrcode.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/icon-maskable-512.png',
];
const CZCIONKI = 'or-stoisko-czcionki';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(klucze => Promise.all(klucze.filter(k => k.startsWith('or-stoisko') && k !== WERSJA && k !== CZCIONKI && k !== OCR).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CZCIONKI).then(async c => {
      const z = await c.match(req);
      const siec = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => z);
      return z || siec;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;
  // manifest zawsze z sieci (gdy jest internet) – telefon musi widzieć aktualny identyfikator i zakres aplikacji
  if (url.pathname.endsWith('/manifest.webmanifest')) {
    e.respondWith(fetch(req).catch(() => caches.open(WERSJA).then(c => c.match(req, { ignoreSearch: true }))));
    return;
  }
  if (url.pathname.includes('/vendor/ocr/')) {
    e.respondWith(caches.open(OCR).then(async c => {
      const z = await c.match(req, { ignoreSearch: true });
      if (z) return z;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    }));
    return;
  }
  // strona „Dane do płatności” dla klientów – zawsze z sieci, nie podmieniamy jej na Stoisko
  if (req.mode === 'navigate' && /\/zaplata\.html$/.test(url.pathname)) return;
  // formularz listy mailingowej (tablet na stoisku) – z sieci, a bez internetu z pamięci urządzenia
  if (req.mode === 'navigate' && /\/lista\.html$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const kopia = r.clone(); caches.open(WERSJA).then(c => c.put('./lista.html', kopia)); } return r; })
      .catch(() => caches.open(WERSJA).then(c => c.match('./lista.html'))));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(WERSJA).then(c => c.match('./index.html')).then(z => z || fetch(req)));
    return;
  }
  e.respondWith(caches.open(WERSJA).then(c => c.match(req, { ignoreSearch: true })).then(z => z || fetch(req)));
});

// ───────────── powiadomienia push ─────────────
// Serwer push budzi service worker bez treści; treść i licznik pobieramy z API (adres i token zapisała aplikacja).
function daneApi() {
  return new Promise(ok => {
    const r = indexedDB.open('oneriver-stoisko');
    r.onerror = () => ok(null);
    r.onsuccess = () => {
      try {
        const g = r.result.transaction('meta', 'readonly').objectStore('meta').get('push-api');
        g.onsuccess = () => ok(g.result || null);
        g.onerror = () => ok(null);
      } catch { ok(null); }
    };
  });
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let w = null, licznik = 0;
    try {
      const api = await daneApi();
      if (api && api.url && api.token) {
        const odp = await fetch(api.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ akcja: 'powiadomienie', token: api.token }), redirect: 'follow' });
        const j = await odp.json();
        if (j.ok && j.dane) { w = j.dane.wiadomosc; licznik = j.dane.licznik || 0; }
      }
    } catch { /* pokażemy ogólne powiadomienie */ }
    w = w || { tytul: 'One River Stoisko', tresc: 'Masz nową sprawę w Stoisku – otwórz aplikację.', url: '#', tag: 'stoisko' };
    try { if (self.navigator.setAppBadge) await (licznik ? self.navigator.setAppBadge(licznik) : self.navigator.clearAppBadge()); } catch { /* bez znaczenia */ }
    await self.registration.showNotification(w.tytul, {
      body: w.tresc, tag: w.tag || 'stoisko', renotify: true,
      icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: w.url || '#' }, vibrate: [200, 100, 200],
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const cel = new URL('./' + (e.notification.data?.url || '#'), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(okna => {
    const okno = okna.find(o => o.url.startsWith(self.registration.scope));
    if (okno) return okno.focus().then(o => o.navigate ? o.navigate(cel) : o);
    return self.clients.openWindow(cel);
  }));
});
