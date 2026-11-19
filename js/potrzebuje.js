// „Potrzebuję” – zapotrzebowanie na towar i sprawdzanie dostaw (karta ZAPOTRZEBOWANIA).
// Grażynka: widzi swoje stany (magazyn GR), zaznacza produkty, których potrzebuje (ilość nieobowiązkowa), albo
// wpisuje ręcznie i wysyła. Gdy Darius przygotuje przesunięcie (MM), Grażynka liczy towar po odbiorze i wpisuje,
// ile naprawdę dostała. Darius (pełne Stoisko) – js/przesuniecia.js: ilości, zatwierdzenie, plik EPP do Subiekta.

import { $, esc, liczba, liczbaNaTekst, uuid, toast, okno, normalizuj, bezSkoku, dataLok } from './util.js';
import { dane, ustawienieTekst } from './dane.js';
import { trybProsty, nazwaUzytkownika } from './api.js';
import { KATEGORIE, htmlFiltrow, stanU } from './prosty.js';
import * as sync from './sync.js';
import { ekran as ekranMM, ileDlaDariusa, pozycjeZ as pozycjeMM } from './przesuniecia.js';

const STATUSY_U_GRAZYNKI = { nowe: 'Wysłane do Dariusa', przygotowane: 'Towar w drodze – policz po odbiorze', sprawdzone: 'Policzone – czeka na zatwierdzenie',
  zatwierdzone: 'Zatwierdzone', anulowane: 'Anulowane' };
const etykietaStatusu = s => STATUSY_U_GRAZYNKI[s] || s || 'Wysłane do Dariusa';
const doSprawdzenia = () => dane.zapotrzebowania.filter(z => z.status === 'przygotowane' && (z.magazyn || 'GR') === 'GR');
export const ileDoSprawdzenia = () => (trybProsty() ? doSprawdzenia().length : 0);
const prog = () => { const n = liczba(ustawienieTekst('prog_niskiego_stanu')); return isFinite(n) ? n : 2; };
export const ileNowychZapotrzebowan = () => (trybProsty() ? 0 : ileDlaDariusa());

const KLUCZ = 'or-stoisko-potrzebuje-szkic';
const nowy = () => ({ sprawdzId: '', liczone: {}, krok: 'lista', kategoria: KATEGORIE[0][0], szukaj: '', tylkoMalo: false, otwarty: '', pozycje: [], reczny: '', recznyIle: '', uwagi: '', blad: '' });
let p = (() => { try { return { ...nowy(), ...JSON.parse(localStorage.getItem(KLUCZ) || '{}'), blad: '' }; } catch { return nowy(); } })();
const zachowaj = () => { try { localStorage.setItem(KLUCZ, JSON.stringify({ ...p, blad: '' })); } catch { /* bez znaczenia */ } };

const iloscZ = x => { const n = liczba(x.iloscTxt); return isFinite(n) && n > 0 ? n : 0; };
const naLiscie = symbol => p.pozycje.find(x => x.symbol === symbol);

function produkty() {
  const slowa = normalizuj(p.szukaj).split(/\s+/).filter(Boolean);
  const malo = prog();
  return dane.produkty.filter(pr => KATEGORIE.some(([k]) => k === pr.kategoria)
    && (slowa.length ? slowa.every(s => pr.szukaj.includes(s)) : pr.kategoria === p.kategoria)
    && (!p.tylkoMalo || pr.warianty.some(w => (stanU(w) ?? Infinity) <= malo)))
    .slice(0, 120);
}

// ───────────────────────── Grażynka ─────────────────────────

function htmlListy() {
  const malo = prog();
  const lista = produkty();
  const zStanami = dane.cennik.some(w => w.stanGr !== null && w.stanGr !== undefined);
  return `
    ${zStanami
      ? `<p class="pr-podp">Twoje stany (magazyn GR)${dane.stanyZDnia ? ` z ${esc(new Date(dane.stanyZDnia).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }))}` : ''}. Czerwone – ${esc(liczbaNaTekst(malo))} szt. lub mniej.</p>`
      : '<p class="pr-podp">Stany pojawią się po najbliższym odświeżeniu katalogu.</p>'}
    ${htmlFiltrow(p)}
    <label class="pr-przelacznik pr-malo"><input type="checkbox" data-pole="tylkoMalo" ${p.tylkoMalo ? 'checked' : ''}> Pokaż tylko te, których mam mało</label>
    <ul class="pz-produkty">${lista.map(pr => {
      const otwarty = p.otwarty === pr.klucz || pr.warianty.length === 1 || Boolean(p.szukaj) || p.tylkoMalo;
      const najmniej = Math.min(...pr.warianty.map(w => stanU(w) ?? Infinity));
      return `<li class="pz-produkt">
        <button type="button" class="pz-naglowek" data-akcja="otworz" data-v="${esc(pr.klucz)}">
          ${pr.zdjecie ? `<img src="${esc(pr.zdjecie)}" alt="" loading="lazy">` : '<span class="pz-bez-zdj"></span>'}
          <span class="pz-nazwa">${esc(pr.produkt)}
            <small class="pz-skrot">${pr.warianty.map(w => { const st = stanU(w); return st === null ? '' : `<span class="${st <= malo ? 'malo' : ''}">${esc(pr.warianty.length > 1 ? (w.wariant || '') + ': ' : 'masz: ')}${esc(liczbaNaTekst(st))}</span>`; }).filter(Boolean).join(' · ')}</small></span>
          ${pr.warianty.some(w => naLiscie(w.symbol)) ? `<span class="pr-ile">✓ ${esc(String(pr.warianty.filter(w => naLiscie(w.symbol)).length))}</span>` : (najmniej <= malo ? '<span class="pz-malo-znak">mało</span>' : '')}
        </button>
        ${otwarty ? `<ul class="pz-warianty">${pr.warianty.filter(w => !p.tylkoMalo || (stanU(w) ?? Infinity) <= malo).map(w => {
          const st = stanU(w);
          const x = naLiscie(w.symbol);
          return `<li class="pz-wariant${st !== null && st <= malo ? ' malo' : ''}">
            <span class="pz-w-nazwa">${esc(w.wariant || pr.produkt)}</span>
            <span class="pz-stan">${st === null ? '—' : `masz: <b>${esc(liczbaNaTekst(st))}</b>`}</span>
            <button type="button" class="pz-wybierz${x ? ' wybrany' : ''}" data-akcja="przelacz" data-v="${esc(w.symbol)}" aria-pressed="${Boolean(x)}">${x ? '✓ Dodane' : '+ Potrzebuję'}</button>
          </li>`;
        }).join('')}</ul>` : ''}
      </li>`;
    }).join('') || '<li class="pr-pusto">Nic nie znaleziono. Możesz wpisać produkt ręcznie w następnym kroku.</li>'}</ul>`;
}

function htmlPodsumowania() {
  return `
    ${p.pozycje.length ? `<ul class="pr-koszyk">${p.pozycje.map(x => `<li data-k="${esc(x.k)}">
      <div class="pr-k-nazwa">${esc(x.nazwa)}${x.reczny ? ' <small class="pz-reczny">wpisane ręcznie</small>' : ''}</div>
      ${x.stan !== null && x.stan !== undefined && !x.reczny ? `<div class="pr-podp">Masz teraz: ${esc(liczbaNaTekst(x.stan))} szt.</div>` : ''}
      <div class="pr-k-ilosc"><span class="pz-ile-et">Ile? <small>(nie trzeba)</small></span>
        <button type="button" class="pr-okragly" data-akcja="minus" aria-label="Mniej">−</button>
        <span class="pr-liczba">${iloscZ(x) ? esc(liczbaNaTekst(iloscZ(x))) : '—'}</span>
        <button type="button" class="pr-okragly" data-akcja="plus" aria-label="Więcej">+</button>
      </div>
      <button type="button" class="pr-usun" data-akcja="usun">Usuń z listy</button>
    </li>`).join('')}</ul>` : '<p class="pr-info">Lista jest pusta. Dopisz produkt poniżej albo wróć i wybierz z listy.</p>'}
    <div class="pz-reczny-pole">
      <h2>Dopisz ręcznie</h2>
      <label class="pr-pole"><span>Czego potrzebujesz?</span>
        <input data-pole="reczny" value="${esc(p.reczny)}" placeholder="np. torebki papierowe małe" autocomplete="off"></label>
      <label class="pr-pole"><span>Ile? (nie trzeba)</span>
        <input data-pole="recznyIle" inputmode="decimal" value="${esc(p.recznyIle)}" placeholder="np. 20" autocomplete="off"></label>
      <button type="button" class="pr-drugi" data-akcja="dopisz">+ Dopisz do listy</button>
    </div>
    <label class="pr-pole"><span>Uwagi dla nas (nie trzeba)</span>
      <textarea data-pole="uwagi" rows="3" placeholder="np. pilne – klienci pytają">${esc(p.uwagi)}</textarea></label>`;
}

function htmlMoichZgloszen() {
  const moje = dane.zapotrzebowania.filter(z => z.status !== 'szkic' && (z.osoba === (nazwaUzytkownika() || 'Grażynka') || (z.magazyn || 'GR') === 'GR')).slice(0, 10);
  if (!moje.length) return '';
  return `<h2 class="wy-pod">Twoje zgłoszenia</h2><ul class="pz-zgloszenia">${moje.map(z => `<li>
    <div class="wy-gora"><b>${esc(String(z.data || '').slice(0, 10))}</b><span class="pz-status s-${esc(normalizuj(z.status || 'nowe').replace(/\s+/g, '-'))}">${esc(etykietaStatusu(z.status || 'nowe'))}</span></div>
    ${z.numer ? `<p class="pr-podp">Przesunięcie ${esc(z.numer)}</p>` : ''}
    <ul class="pz-pozycje">${pozycjeZ(z).map(x => { const ile = x.otrzymano !== '' && x.otrzymano != null ? x.otrzymano : (x.wydano !== '' && x.wydano != null ? x.wydano : x.ilosc);
      return `<li>${esc(x.nazwa)}${ile ? ` – <b>${esc(liczbaNaTekst(Number(ile)))}</b>` : ''}</li>`; }).join('')}</ul>
    ${z.uwagi ? `<p class="pr-podp">Uwagi: ${esc(z.uwagi)}</p>` : ''}
    ${z.odpowiedz ? `<p class="pz-odp">Odpowiedź: ${esc(z.odpowiedz)}</p>` : ''}
  </li>`).join('')}</ul>`;
}

function pozycjeZ(z) { try { return JSON.parse(z.pozycje || '[]'); } catch { return [{ nazwa: String(z.pozycje || '') }]; } }

function htmlDoSprawdzenia() {
  const lista = doSprawdzenia();
  if (!lista.length) return '';
  return `<div class="pz-dostawy">${lista.map(z => `<button type="button" class="pz-dostawa" data-akcja="sprawdz" data-v="${esc(z.id)}">
    <b>📦 Przyszedł towar – policz go</b><span>${esc(z.numer || '')} · ${esc(String(pozycjeZ(z).length))} poz. · wysłane ${esc(String(z.przygotowano || z.data || '').slice(0, 10))}</span></button>`).join('')}</div>`;
}

function htmlSprawdzania() {
  const z = dane.zapotrzebowania.find(y => y.id === p.sprawdzId);
  if (!z) return '<p class="pr-info">Tego przesunięcia już nie ma do sprawdzenia.</p>';
  return `<p class="pr-podp">Policz, ile sztuk każdego produktu przyszło. Jeśli się zgadza – nic nie zmieniaj. Jeśli jest inaczej – popraw przyciskami − i +.</p>
    <ul class="pr-koszyk pz-liczenie">${pozycjeMM(z).map((x, i) => {
      const wyd = Number(x.wydano || 0);
      const ile = p.liczone[i] ?? wyd;
      return `<li data-i="${i}" class="${ile !== wyd ? 'inaczej' : ''}">
        <div class="pr-k-nazwa">${esc(x.nazwa)}</div>
        <div class="pr-podp">Wysłane: <b>${esc(liczbaNaTekst(wyd))}</b>${ile !== wyd ? ` · <b class="pz-rozn">${ile < wyd ? 'brakuje ' + esc(liczbaNaTekst(wyd - ile)) : 'więcej o ' + esc(liczbaNaTekst(ile - wyd))}</b>` : ' · zgadza się ✓'}</div>
        <div class="pr-k-ilosc"><span class="pz-ile-et">Dostałam:</span>
          <button type="button" class="pr-okragly" data-akcja="l-minus" aria-label="Mniej">−</button>
          <span class="pr-liczba">${esc(liczbaNaTekst(ile))}</span>
          <button type="button" class="pr-okragly" data-akcja="l-plus" aria-label="Więcej">+</button>
        </div>
      </li>`;
    }).join('')}</ul>
    <label class="pr-pole"><span>Uwagi dla Dariusa (nie trzeba)</span><textarea data-pole="uwagi" rows="2" placeholder="np. jedno opakowanie uszkodzone">${esc(p.uwagi)}</textarea></label>`;
}

async function wyslijPoliczone(przycisk) {
  const z = dane.zapotrzebowania.find(y => y.id === p.sprawdzId);
  if (!z) return;
  const poz = pozycjeMM(z).map((x, i) => ({ ...x, otrzymano: p.liczone[i] ?? Number(x.wydano || 0) }));
  const inne = poz.filter(x => Number(x.otrzymano) !== Number(x.wydano || 0));
  if (inne.length) {
    const tak = await okno('Wysłać policzone?', `<p>Inaczej niż wysłane: <b>${inne.length}</b> ${inne.length === 1 ? 'produkt' : 'produkty'}. Darius zobaczy różnice.</p>`,
      [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Tak, wyślij', wartosc: true }]);
    if (!tak) return;
  }
  przycisk.disabled = true; przycisk.textContent = 'Wysyłam…';
  const t = new Date();
  try {
    await sync.zapisz([{ karta: 'ZAPOTRZEBOWANIA', wiersze: [{ ...z, status: 'sprawdzone', pozycje: JSON.stringify(poz),
      sprawdzono: dataLok(t) + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'),
      uwagi: [z.uwagi, p.uwagi.trim() ? 'Grażynka: ' + p.uwagi.trim() : ''].filter(Boolean).join(' | ') }] }]);
    const { wczytaj } = await import('./dane.js');
    await wczytaj();
    p = nowy(); zachowaj();
    window.scrollTo(0, 0);
    renderProsty();
    toast('Dziękuję! Darius zobaczy policzony towar.', 'ok', 6000);
  } catch (err) {
    przycisk.disabled = false; przycisk.textContent = '✓ Policzone – wyślij';
    blad('Nie udało się zapisać: ' + (err?.message || err) + '. Spróbuj jeszcze raz.');
  }
}

function renderProsty() {
  if (p.krok === 'sprawdz' && !doSprawdzenia().some(z => z.id === p.sprawdzId)) { p.krok = 'lista'; p.sprawdzId = ''; }
  if (p.krok === 'sprawdz') {
    $('#widok').innerHTML = `<section class="ekran prosty-ekran potrzebuje-ekran">
      <h1 class="pr-tytul">Policz towar</h1>
      <div class="pr-blad" id="pr-blad" role="alert" ${p.blad ? '' : 'hidden'}>${esc(p.blad)}</div>
      ${htmlSprawdzania()}
      <div class="pr-dol"><button type="button" class="pr-wstecz" data-akcja="wstecz">← Wstecz</button>
        <button type="button" class="pr-dalej" data-akcja="policzone">✓ Policzone – wyślij</button></div>
    </section>`;
    return;
  }
  $('#widok').innerHTML = `<section class="ekran prosty-ekran potrzebuje-ekran">
    <h1 class="pr-tytul">${p.krok === 'lista' ? 'Potrzebuję – stany i zamawianie' : 'Sprawdź i wyślij'}</h1>
    <div class="pr-blad" id="pr-blad" role="alert" ${p.blad ? '' : 'hidden'}>${esc(p.blad)}</div>
    ${p.krok === 'lista' ? htmlDoSprawdzenia() + htmlListy() : htmlPodsumowania()}
    ${p.krok === 'lista' ? htmlMoichZgloszen() : ''}
    <div class="pr-dol">
      ${p.krok === 'lista' ? '<span></span>' : '<button type="button" class="pr-wstecz" data-akcja="wstecz">← Wstecz</button>'}
      ${p.krok === 'lista' ? `<button type="button" class="pr-dalej" data-akcja="dalej">Dalej → ${p.pozycje.length ? `(${esc(String(p.pozycje.length))} poz.)` : '(albo wpisz ręcznie)'}</button>`
        : '<button type="button" class="pr-dalej" data-akcja="wyslij">✓ Wyślij</button>'}
    </div>
  </section>`;
}

function blad(t) {
  p.blad = t;
  const el = $('#pr-blad');
  if (el) { el.textContent = t; el.hidden = !t; if (t) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

async function wyslij(przycisk) {
  const pozycje = p.pozycje.filter(x => x.nazwa);
  if (!pozycje.length && !p.uwagi.trim()) return blad('Lista jest pusta. Wybierz produkty albo dopisz ręcznie, czego potrzebujesz.');
  blad('');
  przycisk.disabled = true; przycisk.textContent = 'Wysyłam…';
  try {
    const teraz = new Date();
    await sync.zapisz([{ karta: 'ZAPOTRZEBOWANIA', wiersze: [{
      id: 'zp-' + dataLok(teraz).replace(/-/g, '') + '-' + uuid().slice(0, 6),
      data: dataLok(teraz) + ' ' + String(teraz.getHours()).padStart(2, '0') + ':' + String(teraz.getMinutes()).padStart(2, '0'),
      osoba: nazwaUzytkownika() || 'Grażynka', magazyn: 'GR', status: 'nowe', uwagi: p.uwagi.trim(), odpowiedz: '',
      pozycje: JSON.stringify(pozycje.map(x => ({ symbol: x.symbol || '', nazwa: x.nazwa, ilosc: iloscZ(x) || '', stan: x.reczny ? '' : (x.stan ?? '') }))),
    }] }]);
    const { wczytaj } = await import('./dane.js');
    await wczytaj();
    p = nowy(); zachowaj();
    window.scrollTo(0, 0);
    renderProsty();
    toast(navigator.onLine ? 'Wysłane! Dostaniemy e-mail i powiadomienie.' : 'Zapisane – wyślę, gdy telefon będzie miał internet.', 'ok', 6000);
  } catch (err) {
    przycisk.disabled = false; przycisk.textContent = '✓ Wyślij zapotrzebowanie';
    blad('Nie udało się zapisać: ' + (err?.message || err) + '. Spróbuj jeszcze raz.');
  }
}

async function klikProsty(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'kategoria') { p.kategoria = v; p.szukaj = ''; p.otwarty = ''; }
  else if (akcja === 'otworz') p.otwarty = p.otwarty === v ? '' : v;
  else if (akcja === 'przelacz') {
    const w = dane.cennik.find(c => c.symbol === v);
    if (!w) return;
    const x = naLiscie(v);
    if (x) p.pozycje = p.pozycje.filter(y => y !== x);
    else p.pozycje.push({ k: uuid(), symbol: w.symbol, nazwa: w.nazwa, stan: stanU(w), iloscTxt: '' });
  }
  else if (akcja === 'sprawdz') { p.sprawdzId = v; p.liczone = {}; p.krok = 'sprawdz'; window.scrollTo(0, 0); }
  else if (akcja === 'l-plus' || akcja === 'l-minus') {
    const z = dane.zapotrzebowania.find(y => y.id === p.sprawdzId);
    const i = Number(b.closest('[data-i]').dataset.i);
    const poz = z ? pozycjeMM(z)[i] : null;
    if (!poz) return;
    const teraz = p.liczone[i] ?? Number(poz.wydano || 0);
    p.liczone[i] = Math.max(0, teraz + (akcja === 'l-plus' ? 1 : -1));
  }
  else if (akcja === 'policzone') { await wyslijPoliczone(b); return; } else if (akcja === 'plus' || akcja === 'minus' || akcja === 'usun') {
    const x = p.pozycje.find(y => y.k === b.closest('[data-k]').dataset.k);
    if (!x) return;
    const n = iloscZ(x) + (akcja === 'plus' ? 1 : -1);
    if (akcja === 'usun') p.pozycje = p.pozycje.filter(y => y !== x);
    else x.iloscTxt = n > 0 ? liczbaNaTekst(n) : '';
  } else if (akcja === 'dopisz') {
    const nazwa = p.reczny.trim();
    if (!nazwa) { blad('Wpisz, czego potrzebujesz, np. „torebki papierowe małe”.'); return; }
    const ile = liczba(p.recznyIle);
    if (String(p.recznyIle).trim() && !(isFinite(ile) && ile > 0)) { blad('Ilość jest nieprawidłowa – wpisz liczbę, np. 20, albo zostaw puste.'); return; }
    p.pozycje.push({ k: uuid(), symbol: '', nazwa, reczny: true, stan: null, iloscTxt: isFinite(ile) && ile > 0 ? liczbaNaTekst(ile) : '' });
    p.reczny = ''; p.recznyIle = ''; p.blad = '';
  } else if (akcja === 'dalej') { p.krok = 'wyslij'; p.blad = ''; window.scrollTo(0, 0); }
  else if (akcja === 'wstecz') { p.krok = 'lista'; p.sprawdzId = ''; p.blad = ''; window.scrollTo(0, 0); }
  else if (akcja === 'wyslij') { await wyslij(b); return; }
  else return;
  zachowaj();
  bezSkoku(renderProsty);
}

function wejscieProste(e) {
  const pole = e.target.dataset.pole;
  if (!pole) return;
  if (pole === 'szukaj') {
    p.szukaj = e.target.value; p.otwarty = '';
    const nowa = new DOMParser().parseFromString(htmlListy(), 'text/html').querySelector('.pz-produkty');
    $('.pz-produkty').replaceWith(nowa);
    document.querySelectorAll('.pr-kat').forEach(k => k.setAttribute('aria-pressed', String(!p.szukaj && k.dataset.v === p.kategoria)));
  } else if (pole === 'tylkoMalo') { p.tylkoMalo = e.target.checked; zachowaj(); bezSkoku(renderProsty); return; }
  else if (pole in p) p[pole] = e.target.value;
  zachowaj();
}

export const ekran = {
  render: () => (trybProsty() ? renderProsty() : ekranMM.render()),
  klik: e => (trybProsty() ? klikProsty(e) : ekranMM.klik(e)),
  wejscie: e => (trybProsty() ? wejscieProste(e) : ekranMM.wejscie(e)),
  zmiana: e => (trybProsty() ? wejscieProste(e) : null),
};
