// Połączenie z API arkusza „One River – Finanse” (ten sam skrypt Apps Script co aplikacja Finanse).
// Adres, token i ustawienia stoiska są zapisane tylko na tym urządzeniu.

import { PLATNOSC_DOMYSLNA } from './konfiguracja.js';

const KLUCZ = 'or-stoisko-ustawienia';

export function ustawienia() {
  let u = {};
  try { u = JSON.parse(localStorage.getItem(KLUCZ)) || {}; } catch { /* puste */ }
  return {
    url: '', token: '', kto: '', kod: '', podmiot: 'INCO', magazyn: '', wydarzenie: '', wydarzenie_id: '',
    ...u,
    platnosc: { ...PLATNOSC_DOMYSLNA, ...(u.platnosc || {}) },
  };
}

export function zapiszUstawienia(zmiana) {
  const u = { ...ustawienia(), ...zmiana };
  localStorage.setItem(KLUCZ, JSON.stringify(u));
  return u;
}

/** Adres API zapisany przez aplikację Finanse na tym samym urządzeniu (podpowiedź przy pierwszym uruchomieniu). */
export function adresZFinansow() {
  try { return JSON.parse(localStorage.getItem('or-finanse-ustawienia'))?.url || ''; } catch { return ''; }
}

export const polaczone = () => { const u = ustawienia(); return Boolean(u.url && u.token); };
export const gotowe = () => polaczone() && Boolean(ustawienia().kod);

export class BladApi extends Error {}

export async function wywolaj(akcja, dane = {}, limitMs = 45000) {
  const { url, token } = ustawienia();
  if (!url || !token) throw new BladApi('Brak adresu API lub tokenu. Uzupełnij je w Ustawieniach.');
  const przerwij = new AbortController();
  const zegar = setTimeout(() => przerwij.abort(), limitMs);
  let odp;
  try {
    odp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // bez zapytania wstępnego CORS
      body: JSON.stringify({ ...dane, token, akcja }),
      redirect: 'follow',
      signal: przerwij.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Arkusz nie odpowiedział w ciągu ' + Math.round(limitMs / 1000) + ' s.');
    throw new Error('Brak połączenia z arkuszem.');
  } finally {
    clearTimeout(zegar);
  }
  if (!odp.ok) throw new Error('Arkusz odpowiedział błędem ' + odp.status + '.');
  let json;
  try { json = await odp.json(); } catch { throw new BladApi('Odpowiedź nie pochodzi z API aplikacji. Sprawdź adres w Ustawieniach.'); }
  if (json.wersja) { try { localStorage.setItem('or-stoisko-wersja-api', String(json.wersja)); } catch { /* bez znaczenia */ } }
  if (json.uzytkownik) {
    try {
      const rola = String(json.uzytkownik.rola || '');
      const nazwa = String(json.uzytkownik.nazwa || '');
      const innaOsoba = localStorage.getItem('or-stoisko-uzytkownik') !== nazwa;
      if (innaOsoba) localStorage.setItem('or-stoisko-uzytkownik', nazwa);
      if (localStorage.getItem('or-stoisko-rola') !== rola) {
        localStorage.setItem('or-stoisko-rola', rola);
        window.dispatchEvent(new Event('or-zmiana-roli'));
      }
      if (innaOsoba) window.dispatchEvent(new Event('or-zmiana-uzytkownika'));
    } catch { /* bez znaczenia */ }
  }
  if (!json.ok) throw new BladApi(json.blad || 'Nieznany błąd API.');
  return json.dane;
}

/** Tryb prosty (token z rolą „stoisko-prosty”, np. Grażynka): tylko sprzedaż krok po kroku i wysyłki do zrobienia. */
export function trybProsty() {
  try { return localStorage.getItem('or-stoisko-rola') === 'stoisko-prosty'; } catch { return false; }
}
export function nazwaUzytkownika() {
  try { return localStorage.getItem('or-stoisko-uzytkownik') || ''; } catch { return ''; }
}

export function wersjaApi() {
  try { return Number(localStorage.getItem('or-stoisko-wersja-api')) || 0; } catch { return 0; }
}
