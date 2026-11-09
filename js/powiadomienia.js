// Powiadomienia i znaczek na ikonie aplikacji.
// • Znaczek: Badging API (Windows, macOS, iPhone). Na Androidzie znaczek/kropkę na ikonie daje powiadomienie.
// • Powiadomienia push: skrypt arkusza (API v12) budzi telefon przez serwer push przeglądarki, a service worker
//   pobiera treść z API („powiadomienie”). Działa też przy zamkniętej aplikacji (zainstalowanej na ekranie głównym).
//   Grażynka: nowa paczka do wysłania. Darius/biuro: zamówienie z formularza, nowe zapotrzebowanie.

import { wywolaj, ustawienia, nazwaUzytkownika } from './api.js';
import * as db from './db.js';

export function ustawZnaczek(n) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (n > 0) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge().catch(() => {});
  } catch { /* bez znaczenia */ }
}

export const wspierane = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'brak' (telefon/przeglądarka nie obsługuje), 'zablokowane', 'wlaczone', 'wylaczone' */
export async function stan() {
  if (!wspierane()) return 'brak';
  if (Notification.permission === 'denied') return 'zablokowane';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'wlaczone' : 'wylaczone';
}

const naBajty = b64 => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

/** Service worker musi znać adres API i token, żeby po „budziku” pobrać treść powiadomienia. */
async function przekazDaneSW() {
  const { url, token } = ustawienia();
  await db.metaZapisz('push-api', { url, token });
}

/** Wywołaj z kliknięcia (przeglądarka pyta o zgodę tylko po dotknięciu przycisku). */
export async function wlacz() {
  if (!wspierane()) throw new Error('Ten telefon albo przeglądarka nie obsługuje powiadomień. Na Androidzie użyj Chrome i zainstaluj Stoisko na ekranie głównym.');
  const zgoda = await Notification.requestPermission();
  if (zgoda !== 'granted') throw new Error('Powiadomienia są zablokowane. Włącz je w ustawieniach telefonu: Aplikacje → Stoisko (albo Chrome) → Powiadomienia.');
  const reg = await navigator.serviceWorker.ready;
  const { klucz } = await wywolaj('kluczPush', {}, 60000);
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const stary = sub.options?.applicationServerKey;
    const nowy = naBajty(klucz);
    if (stary && new Uint8Array(stary).join() !== nowy.join()) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: naBajty(klucz) });
  await przekazDaneSW();
  await wywolaj('subskrybuj', { sub: sub.toJSON(), urzadzenie: ustawienia().kto || '' });
  try { localStorage.setItem('or-stoisko-push', new Date().toISOString().slice(0, 10) + '|' + nazwaUzytkownika()); } catch { /* bez znaczenia */ }
  return true;
}

export async function wylacz() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await wywolaj('subskrybuj', { sub: sub.toJSON(), wylacz: true }); } catch { /* i tak wyłączamy */ }
  await sub.unsubscribe();
  try { localStorage.removeItem('or-stoisko-push'); } catch { /* bez znaczenia */ }
}

export const testuj = () => wywolaj('testPowiadomienia', {}, 60000);

/** Raz dziennie odświeża zapis urządzenia w arkuszu (subskrypcje potrafią się zmienić), bez pytania o zgodę. */
export async function odswiezCichutko() {
  try {
    if (!wspierane() || Notification.permission !== 'granted') return;
    // urządzenie zapisane w arkuszu dziś i na tę samą osobę (po zmianie tokenu – zapis od nowa na nową osobę)
    const dzis = new Date().toISOString().slice(0, 10) + '|' + nazwaUzytkownika();
    if (localStorage.getItem('or-stoisko-push') === dzis) { await przekazDaneSW(); return; }
    if (await stan() !== 'wlaczone' && !localStorage.getItem('or-stoisko-push')) return;
    await wlacz();
  } catch { /* spróbujemy jutro */ }
}

export const opisDlaUzytkownika = () => (nazwaUzytkownika() === 'Grażynka' || !nazwaUzytkownika()
  ? 'Gdy dostaniesz paczkę do wysłania, telefon pokaże powiadomienie, a na ikonie Stoiska pojawi się kropka.'
  : 'Powiadomienie przy zamówieniu z formularza i przy nowym zapotrzebowaniu od Grażynki.');

// ───────────── panel „Powiadomienia” (Ustawienia, „Do wysłania”) ─────────────

const htmlStanu = (st, prosty) => {
  if (st === 'brak') return '<p>Ta przeglądarka nie obsługuje powiadomień. Na Androidzie otwórz Stoisko w Chrome i zainstaluj na ekranie głównym.</p>';
  if (st === 'zablokowane') return '<p class="blad">Powiadomienia są zablokowane. Włącz je w telefonie: Ustawienia → Aplikacje → Stoisko (lub Chrome) → Powiadomienia, potem wróć tutaj.</p>';
  if (st === 'wlaczone') return `<p>🔔 Powiadomienia są włączone na tym telefonie. ${esc(opisDlaUzytkownika())}</p>
    <div class="przyciski"><button type="button" class="${prosty ? 'pr-drugi' : 'drugorzedny'}" data-akcja="push-test">Wyślij próbne powiadomienie</button>
    ${prosty ? '' : '<button type="button" class="drugorzedny" data-akcja="push-wylacz">Wyłącz</button>'}</div>`;
  return `<p>${esc(opisDlaUzytkownika())}</p>
    ${prosty ? '' : '<div class="przyciski">'}<button type="button" class="${prosty ? 'pr-glowny' : ''}" data-akcja="push-wlacz">🔔 Włącz powiadomienia</button>${prosty ? '' : '</div>'}`;
};
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Wypełnia elementy [data-push] na ekranie. ukryjGdyWlaczone – w „Do wysłania” panel znika, gdy wszystko działa. */
export async function wypelnijPanele(prosty = false) {
  const el = document.querySelectorAll('[data-push]');
  if (!el.length) return;
  const st = await stan().catch(() => 'brak');
  el.forEach(p => {
    if (p.dataset.push === 'baner' && st === 'wlaczone') { p.hidden = true; return; }
    p.hidden = false;
    p.innerHTML = (p.dataset.push === 'baner' ? '<h2>Powiadomienia o paczkach</h2>' : '<h2>Powiadomienia</h2>') + htmlStanu(st, prosty);
  });
}

/** Obsługa przycisków panelu; zwraca true, gdy kliknięcie dotyczyło powiadomień. */
export async function klikPanelu(b, toast, prosty = false) {
  const a = b?.dataset.akcja;
  if (!['push-wlacz', 'push-wylacz', 'push-test'].includes(a)) return false;
  b.disabled = true;
  try {
    if (a === 'push-wlacz') { await wlacz(); toast('Powiadomienia włączone. Za chwilę przyjdzie próbne.', 'ok', 6000); await testuj().catch(() => {}); }
    else if (a === 'push-wylacz') { await wylacz(); toast('Powiadomienia wyłączone na tym urządzeniu.', 'ok'); }
    else {
      let w = await testuj();
      if (!w.wyslano) { await wlacz(); w = await testuj(); }   // np. telefon był zapisany na innym tokenie
      toast(w.wyslano ? 'Wysłano – powiadomienie powinno przyjść za kilka sekund.' : 'Nie udało się wysłać. Dotknij „Wyłącz”, potem „Włącz powiadomienia” i spróbuj jeszcze raz.', w.wyslano ? 'ok' : 'blad', 9000);
    }
  } catch (e) {
    toast(e.message, 'blad', 9000);
  } finally {
    b.disabled = false;
    await wypelnijPanele(prosty);
  }
  return true;
}
