// „Do wysłania”: zamówienia z wysyłką. Grażynka widzi swoje, Darius/biuro wszystkie (filtr: kto wysyła).
// Zakładki „Do wysłania” / „Wysłane”; „Przyjmuję do realizacji”, zdjęcie paczki (Dysk Google), „Wysłane”
// i cofnięcie „wysłane” (kliknięte przez pomyłkę). Biuro może wysłać osobie wysyłającej przypomnienie (powiadomienie push).

import { $, esc, kwotaTxt, iloscTxt, num, dataKrotko, dataLok, toast, okno, uuid } from './util.js';
import { dane, zamowienie, pozycjeZamowienia, klient } from './dane.js';
import { wywolaj, nazwaUzytkownika, trybProsty } from './api.js';
import { STATUSY, czyTransport, linkSledzeniaPrzewoznika } from './konfiguracja.js';
import * as sync from './sync.js';
import { wypelnijPanele, klikPanelu } from './powiadomienia.js';

const osoba = () => nazwaUzytkownika() || 'Grażynka';
const czyMoje = z => (trybProsty() ? z.realizuje === osoba() : true);
const doWyslania = () => dane.zamowienia.filter(z => z.status !== STATUSY.anulowane && (z.typ === 'wysylka' || z.dostawa) && z.realizuje && czyMoje(z) && !z.wyslano)
  .sort((a, b) => String(a.data).localeCompare(String(b.data)));
const wyslane = () => dane.zamowienia.filter(z => z.wyslano && czyMoje(z) && z.realizuje && z.status !== STATUSY.anulowane)
  .sort((a, b) => String(b.wyslano).localeCompare(String(a.wyslano))).slice(0, 60);
export const ileDoWyslania = () => (trybProsty() ? doWyslania().length : 0);
/** Dla pełnego Stoiska (przycisk w „Zamówieniach”): wszystkie niewysłane. */
export const ileDoWyslaniaWszystkich = () => doWyslania().length;

const stan = { zakladka: 'do', kto: '' };
try { stan.kto = localStorage.getItem('or-stoisko-wysylki-kto') || ''; } catch { /* bez znaczenia */ }
const filtrKto = z => trybProsty() || !stan.kto || z.realizuje === stan.kto;
const czas = () => { const t = new Date(); const p = n => String(n).padStart(2, '0'); return `${dataLok(t)} ${p(t.getHours())}:${p(t.getMinutes())}`; };

let wysylaZdjecie = '';

function karta(z) {
  const k = klient(z.klient_id);
  const poz = pozycjeZamowienia(z.id).filter(p => !czyTransport(p.symbol));
  const link = linkSledzeniaPrzewoznika(z.przewoznik || 'InPost', z.nr_przesylki);
  return `<li class="wy-karta" data-id="${esc(z.id)}">
    <div class="wy-gora"><b class="wy-numer">${esc(z.id)}</b><span>${esc(dataKrotko(String(z.data || '').slice(0, 10)))}</span></div>
    ${trybProsty() ? '' : `<p class="wy-kto">Wysyła: <b>${esc(z.realizuje)}</b>${z.przypomniano ? ` · przypomniano ${esc(z.przypomniano)}` : ''}</p>`}
    ${z.przyjeto && !z.wyslano ? `<p class="wy-przyjete">👍 Przyjęte do realizacji ${esc(z.przyjeto)}</p>` : ''}
    ${!z.przyjeto && !z.wyslano && !trybProsty() ? '<p class="wy-kto">⏳ Jeszcze nie przyjęte do realizacji</p>' : ''}
    <p class="wy-klient">Dla: <b>${esc(k?.nazwa || '—')}</b></p>
    <p class="wy-dokad">${esc(z.przewoznik && z.przewoznik !== 'InPost' ? z.przewoznik : (z.dostawa || 'InPost'))}${z.adres_dostawy ? `<br>${esc(z.adres_dostawy)}` : ''}</p>
    <ul class="wy-produkty">${poz.map(p => `<li><span>${esc(p.nazwa)}</span><b>× ${esc(iloscTxt(num(p.ilosc)))}</b></li>`).join('')}</ul>
    ${z.kod_nadania ? `<p class="wy-kod">Kod nadania:<br><b>${esc(String(z.kod_nadania).replace(/(\d{3})(?=\d)/g, '$1 '))}</b></p>` : ''}
    ${z.uwagi ? `<p class="wy-uwagi">Uwagi: ${esc(z.uwagi)}</p>` : ''}
    ${z.zdjecie_wysylki ? `<p class="wy-zdj-ok">📷 Zdjęcie dodane – <a href="${esc(z.zdjecie_wysylki)}" target="_blank" rel="noopener">zobacz</a></p>` : ''}
    ${z.wyslano ? `<p class="wy-wyslano">✓ Wysłano ${esc(String(z.wyslano).slice(0, 16).replace('T', ' '))}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">śledź</a>` : ''}</p>
    <button type="button" class="wy-cofnij" data-akcja="cofnij">↩︎ Cofnij „wysłane” (pomyłka)</button>` : `
    ${!z.przyjeto && trybProsty() ? '<button type="button" class="wy-przycisk wy-przyjmij" data-akcja="przyjmij">👍 Przyjmuję do realizacji</button>' : ''}
    ${trybProsty() ? '' : `<button type="button" class="wy-przypomnij" data-akcja="przypomnij">🔔 Przypomnij: ${esc(z.realizuje)}</button>`}
    <label class="wy-przycisk wy-foto${wysylaZdjecie === z.id ? ' trwa' : ''}">
      <input type="file" accept="image/*" capture="environment" data-pole="zdjecie" hidden>
      ${wysylaZdjecie === z.id ? 'Wysyłam zdjęcie…' : (z.zdjecie_wysylki ? '📷 Zmień zdjęcie paczki' : '📷 Zrób zdjęcie paczki')}
    </label>
    <button type="button" class="wy-przycisk wy-wyslij" data-akcja="wyslane">✓ Oznacz jako wysłane</button>`}
  </li>`;
}

function render() {
  const wszystkie = doWyslania();
  if (trybProsty()) {
    const licznik = $('.nawigacja [data-widok="wysylki"] .licznik');
    if (licznik) { licznik.textContent = wszystkie.length || ''; licznik.hidden = !wszystkie.length; }
  }
  const lista = wszystkie.filter(filtrKto);
  const zrob = wyslane().filter(filtrKto);
  const osoby = [...new Set(dane.zamowienia.filter(z => z.realizuje && (z.typ === 'wysylka' || z.dostawa)).map(z => z.realizuje))].sort();
  const ile = o => wszystkie.filter(z => z.realizuje === o).length;
  $('#widok').innerHTML = `<section class="ekran ${trybProsty() ? 'prosty-ekran' : ''} wysylki-ekran">
    <h1 class="pr-tytul">${stan.zakladka === 'do' ? 'Do wysłania' : 'Wysłane'}</h1>
    ${trybProsty() ? '<div class="wy-push" data-push="baner" hidden></div>' : ''}
    <div class="wy-zakladki" role="tablist">
      <button type="button" role="tab" data-zakladka="do" aria-selected="${stan.zakladka === 'do'}">Do wysłania${lista.length ? ` (${lista.length})` : ''}</button>
      <button type="button" role="tab" data-zakladka="wyslane" aria-selected="${stan.zakladka === 'wyslane'}">Wysłane</button>
    </div>
    ${trybProsty() ? '' : `<div class="chipy male"><span class="etykieta-mag">Kto wysyła:</span>${[['', 'Wszyscy'], ...osoby.map(o => [o, o])].map(([w, e]) =>
      `<button type="button" class="chip" data-kto="${esc(w)}" aria-pressed="${stan.kto === w}">${esc(e)}${w && ile(w) ? ` (${ile(w)})` : ''}</button>`).join('')}</div>`}
    ${stan.zakladka === 'do'
      ? (lista.length ? `<ul class="wy-lista">${lista.map(karta).join('')}</ul>` : '<p class="pr-info">Nie ma nic do wysłania. 🎉</p>')
      : (zrob.length ? `<ul class="wy-lista wy-zrobione">${zrob.map(karta).join('')}</ul>` : '<p class="pr-info">Nie ma jeszcze wysłanych paczek.</p>')}
  </section>`;
  if (trybProsty()) wypelnijPanele(true);
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

async function przyjmij(z) {
  await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [{ ...zamowienie(z.id), przyjeto: czas(), przyjal: osoba() }] }]);
  toast(`${z.id}: przyjęte do realizacji.`, 'ok');
  render();
}

async function cofnij(z) {
  const tak = await okno(`Cofnąć „wysłane”: ${z.id}?`, `<p>Zamówienie wróci do zakładki <b>Do wysłania</b>. Zdjęcie paczki zostaje.</p>`,
    [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Tak, cofnij', wartosc: true, autofocus: true }]);
  if (!tak) return;
  await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [{ ...zamowienie(z.id), wyslano: '' }] }]);
  toast(`${z.id} wróciło do „Do wysłania”.`, 'ok');
  render();
}

async function przypomnij(z, b) {
  const tresc = await okno(`Przypomnienie dla: ${z.realizuje}`, `<p>Powiadomienie przyjdzie na telefon (${esc(z.realizuje)} musi mieć włączone powiadomienia w Stoisku).</p>
    <label class="pole szeroka"><span class="etykieta">Treść</span><input id="tresc-przypomnienia" value="${esc(`Pamiętaj o paczce ${z.id} dla ${klient(z.klient_id)?.nazwa || 'klienta'}.`)}" maxlength="160"></label>`,
    [{ etykieta: 'Anuluj', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Wyślij przypomnienie', wartosc: true, autofocus: true }]);
  if (!tresc) return;
  const tekst = $('#tresc-przypomnienia')?.value || '';   // treść okna zostaje w DOM po zamknięciu
  b.disabled = true;
  try {
    const w = await wywolaj('przypomnij', { id: z.id, tresc: tekst }, 60000);
    if (!w.wyslano) toast(`${z.realizuje} nie ma włączonych powiadomień na żadnym telefonie – zadzwoń albo napisz.`, 'blad', 9000);
    else {
      toast(`Przypomnienie wysłane do: ${z.realizuje}.`, 'ok');
      await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [{ ...zamowienie(z.id), przypomniano: czas() }] }]);
      render();
    }
  } catch (err) { toast(err.message, 'blad', 9000); } finally { b.disabled = false; }
}

async function oznaczWyslane(z) {
  const tak = await okno(`Wysłane: ${z.id}?`, `<p>Potwierdź, że paczka dla <b>${esc(klient(z.klient_id)?.nazwa || 'klienta')}</b> jest nadana.</p>${z.zdjecie_wysylki ? '' : '<p>Nie ma jeszcze zdjęcia paczki – możesz je dodać teraz albo później.</p>'}`,
    [{ etykieta: 'Jeszcze nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Tak, wysłane', wartosc: true, autofocus: true }]);
  if (!tak) return;
  const kiedy = czas();
  await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [{ ...zamowienie(z.id), wyslano: kiedy, nadano: zamowienie(z.id).nadano || dataLok() }] }]);
  toast(`Zamówienie ${z.id} oznaczone jako wysłane.`, 'ok');
  render();
}

async function klik(e) {
  const zk = e.target.closest('[data-zakladka]');
  if (zk) { stan.zakladka = zk.dataset.zakladka; render(); window.scrollTo(0, 0); return; }
  const kt = e.target.closest('[data-kto]');
  if (kt) { stan.kto = kt.dataset.kto; try { localStorage.setItem('or-stoisko-wysylki-kto', stan.kto); } catch { /* bez znaczenia */ } render(); return; }
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  if (await klikPanelu(b, toast, true)) return;
  const z = zamowienie(b.closest('[data-id]')?.dataset.id);
  if (!z) return;
  if (b.dataset.akcja === 'wyslane') await oznaczWyslane(z);
  else if (b.dataset.akcja === 'przyjmij') await przyjmij(z);
  else if (b.dataset.akcja === 'cofnij') await cofnij(z);
  else if (b.dataset.akcja === 'przypomnij') await przypomnij(z, b);
}

function zmiana(e) {
  if (e.target.dataset.pole !== 'zdjecie' || !e.target.files?.[0]) return;
  const z = zamowienie(e.target.closest('[data-id]')?.dataset.id);
  if (z) dodajZdjecie(z, e.target.files[0]);
}

export const ekran = { render, klik, zmiana };
