// „Do wysłania” (tryb Grażynki): zamówienia z wysyłką przypisane do Grażynki. Pokazuje produkty, dokąd i kod nadania;
// można dodać zdjęcie paczki (zapisuje się na Dysku Google przez API) i oznaczyć zamówienie jako wysłane.

import { $, esc, kwotaTxt, iloscTxt, num, dataKrotko, dataLok, toast, okno, uuid } from './util.js';
import { dane, zamowienie, pozycjeZamowienia, klient } from './dane.js';
import { wywolaj, nazwaUzytkownika, trybProsty } from './api.js';
import { STATUSY, czyTransport, linkSledzeniaPrzewoznika } from './konfiguracja.js';
import * as sync from './sync.js';

const osoba = () => nazwaUzytkownika() || 'Grażynka';
const czyMoje = z => (trybProsty() ? z.realizuje === osoba() : true);
const doWyslania = () => dane.zamowienia.filter(z => z.status !== STATUSY.anulowane && (z.typ === 'wysylka' || z.dostawa) && z.realizuje && czyMoje(z) && !z.wyslano)
  .sort((a, b) => String(a.data).localeCompare(String(b.data)));
const wyslane = () => dane.zamowienia.filter(z => z.wyslano && czyMoje(z) && z.realizuje).sort((a, b) => String(b.wyslano).localeCompare(String(a.wyslano))).slice(0, 15);
export const ileDoWyslania = () => (trybProsty() ? doWyslania().length : 0);

let wysylaZdjecie = '';

function karta(z) {
  const k = klient(z.klient_id);
  const poz = pozycjeZamowienia(z.id).filter(p => !czyTransport(p.symbol));
  const link = linkSledzeniaPrzewoznika(z.przewoznik || 'InPost', z.nr_przesylki);
  return `<li class="wy-karta" data-id="${esc(z.id)}">
    <div class="wy-gora"><b class="wy-numer">${esc(z.id)}</b><span>${esc(dataKrotko(String(z.data || '').slice(0, 10)))}</span></div>
    <p class="wy-klient">Dla: <b>${esc(k?.nazwa || '—')}</b></p>
    <p class="wy-dokad">${esc(z.przewoznik && z.przewoznik !== 'InPost' ? z.przewoznik : (z.dostawa || 'InPost'))}${z.adres_dostawy ? `<br>${esc(z.adres_dostawy)}` : ''}</p>
    <ul class="wy-produkty">${poz.map(p => `<li><span>${esc(p.nazwa)}</span><b>× ${esc(iloscTxt(num(p.ilosc)))}</b></li>`).join('')}</ul>
    ${z.kod_nadania ? `<p class="wy-kod">Kod nadania:<br><b>${esc(String(z.kod_nadania).replace(/(\d{3})(?=\d)/g, '$1 '))}</b></p>` : ''}
    ${z.uwagi ? `<p class="wy-uwagi">Uwagi: ${esc(z.uwagi)}</p>` : ''}
    ${z.zdjecie_wysylki ? `<p class="wy-zdj-ok">📷 Zdjęcie dodane – <a href="${esc(z.zdjecie_wysylki)}" target="_blank" rel="noopener">zobacz</a></p>` : ''}
    ${z.wyslano ? `<p class="wy-wyslano">✓ Wysłano ${esc(String(z.wyslano).slice(0, 16).replace('T', ' '))}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">śledź</a>` : ''}</p>` : `
    <label class="wy-przycisk wy-foto${wysylaZdjecie === z.id ? ' trwa' : ''}">
      <input type="file" accept="image/*" capture="environment" data-pole="zdjecie" hidden>
      ${wysylaZdjecie === z.id ? 'Wysyłam zdjęcie…' : (z.zdjecie_wysylki ? '📷 Zmień zdjęcie paczki' : '📷 Zrób zdjęcie paczki')}
    </label>
    <button type="button" class="wy-przycisk wy-wyslij" data-akcja="wyslane">✓ Oznacz jako wysłane</button>`}
  </li>`;
}

function render() {
  const lista = doWyslania();
  const licznik = $('.nawigacja [data-widok="wysylki"] .licznik');
  if (licznik) { licznik.textContent = lista.length || ''; licznik.hidden = !lista.length; }
  const zrob = wyslane();
  $('#widok').innerHTML = `<section class="ekran prosty-ekran wysylki-ekran">
    <h1 class="pr-tytul">Do wysłania${lista.length ? ` (${lista.length})` : ''}</h1>
    ${lista.length ? `<ul class="wy-lista">${lista.map(karta).join('')}</ul>` : '<p class="pr-info">Nie ma nic do wysłania. 🎉</p>'}
    ${zrob.length ? `<h2 class="wy-pod">Ostatnio wysłane</h2><ul class="wy-lista wy-zrobione">${zrob.map(karta).join('')}</ul>` : ''}
  </section>`;
}

/** Zmniejsza zdjęcie (dłuższy bok 1600 px, JPEG) – szybciej się wysyła przez telefon. */
function zmniejsz(plik) {
  return new Promise((ok, blad) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.onerror = () => blad(new Error('Nie udało się odczytać zdjęcia.'));
    img.src = URL.createObjectURL(plik);
  });
}

async function dodajZdjecie(z, plik) {
  if (!navigator.onLine) { toast('Brak internetu – zdjęcie można dodać, gdy telefon będzie online.', 'blad', 7000); return; }
  wysylaZdjecie = z.id; render();
  try {
    const dane64 = await zmniejsz(plik);
    const w = await wywolaj('zalacznik', { plik_id: 'paczka-' + uuid().slice(0, 12), dane: dane64, nazwa: `Paczka ${z.id}.jpg`, mime: 'image/jpeg', data: dataLok() }, 120000);
    await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [{ ...zamowienie(z.id), zdjecie_wysylki: w.url }] }]);
    toast('Zdjęcie paczki zapisane.', 'ok');
  } catch (err) {
    toast('Nie udało się wysłać zdjęcia: ' + err.message + '. Spróbuj jeszcze raz.', 'blad', 9000);
  } finally {
    wysylaZdjecie = ''; render();
  }
}

async function oznaczWyslane(z) {
  const tak = await okno(`Wysłane: ${z.id}?`, `<p>Potwierdź, że paczka dla <b>${esc(klient(z.klient_id)?.nazwa || 'klienta')}</b> jest nadana.</p>${z.zdjecie_wysylki ? '' : '<p>Nie ma jeszcze zdjęcia paczki – możesz je dodać teraz albo później.</p>'}`,
    [{ etykieta: 'Jeszcze nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Tak, wysłane', wartosc: true, autofocus: true }]);
  if (!tak) return;
  const teraz = new Date();
  const p = n => String(n).padStart(2, '0');
  const kiedy = `${dataLok(teraz)} ${p(teraz.getHours())}:${p(teraz.getMinutes())}`;
  await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [{ ...zamowienie(z.id), wyslano: kiedy, nadano: zamowienie(z.id).nadano || dataLok() }] }]);
  toast(`Zamówienie ${z.id} oznaczone jako wysłane.`, 'ok');
  render();
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const z = zamowienie(b.closest('[data-id]')?.dataset.id);
  if (!z) return;
  if (b.dataset.akcja === 'wyslane') await oznaczWyslane(z);
}

function zmiana(e) {
  if (e.target.dataset.pole !== 'zdjecie' || !e.target.files?.[0]) return;
  const z = zamowienie(e.target.closest('[data-id]')?.dataset.id);
  if (z) dodajZdjecie(z, e.target.files[0]);
}

export const ekran = { render, klik, zmiana };
