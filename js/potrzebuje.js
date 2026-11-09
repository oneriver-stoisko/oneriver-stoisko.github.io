// „Potrzebuję” – zapotrzebowanie na towar (karta ZAPOTRZEBOWANIA).
// Grażynka: widzi swoje stany (magazyn GR z arkusza „Magazyn OneRiver”), wybiera produkty z listy albo wpisuje
// ręcznie, czego potrzebuje, i wysyła. Skrypt arkusza wysyła e-mail na info@oneriver.pl i powiadomienie do Dariusa.
// Darius (pełne Stoisko, Sklep → Zapotrzebowanie): lista zgłoszeń, status i odpowiedź dla Grażynki.

import { $, esc, liczba, liczbaNaTekst, uuid, toast, okno, normalizuj, bezSkoku, dataLok } from './util.js';
import { dane, ustawienieTekst } from './dane.js';
import { trybProsty, nazwaUzytkownika } from './api.js';
import { KATEGORIE, htmlFiltrow, stanU } from './prosty.js';
import * as sync from './sync.js';

export const STATUSY_ZAP = [['nowe', 'Nowe'], ['w realizacji', 'W realizacji'], ['wysłane', 'Wysłane do Ciebie'], ['zamknięte', 'Zamknięte']];
const etykietaStatusu = s => (STATUSY_ZAP.find(([k]) => k === s) || [s, s || 'Nowe'])[1];
const prog = () => { const n = liczba(ustawienieTekst('prog_niskiego_stanu')); return isFinite(n) ? n : 2; };
export const ileNowychZapotrzebowan = () => (trybProsty() ? 0 : dane.zapotrzebowania.filter(z => (z.status || 'nowe') === 'nowe').length);

const KLUCZ = 'or-stoisko-potrzebuje-szkic';
const nowy = () => ({ krok: 'lista', kategoria: KATEGORIE[0][0], szukaj: '', tylkoMalo: false, otwarty: '', pozycje: [], reczny: '', recznyIle: '', uwagi: '', blad: '' });
let p = (() => { try { return { ...nowy(), ...JSON.parse(localStorage.getItem(KLUCZ) || '{}'), blad: '' }; } catch { return nowy(); } })();
const zachowaj = () => { try { localStorage.setItem(KLUCZ, JSON.stringify({ ...p, blad: '' })); } catch { /* bez znaczenia */ } };
let edycja = {};      // Darius: id → { status, odpowiedz } przed zapisem

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
      const ileNa = pr.warianty.reduce((s, w) => s + (naLiscie(w.symbol) ? iloscZ(naLiscie(w.symbol)) : 0), 0);
      const najmniej = Math.min(...pr.warianty.map(w => stanU(w) ?? Infinity));
      return `<li class="pz-produkt">
        <button type="button" class="pz-naglowek" data-akcja="otworz" data-v="${esc(pr.klucz)}">
          ${pr.zdjecie ? `<img src="${esc(pr.zdjecie)}" alt="" loading="lazy">` : '<span class="pz-bez-zdj"></span>'}
          <span class="pz-nazwa">${esc(pr.produkt)}
            <small class="pz-skrot">${pr.warianty.map(w => { const st = stanU(w); return st === null ? '' : `<span class="${st <= malo ? 'malo' : ''}">${esc(pr.warianty.length > 1 ? (w.wariant || '') + ': ' : 'masz: ')}${esc(liczbaNaTekst(st))}</span>`; }).filter(Boolean).join(' · ')}</small></span>
          ${ileNa ? `<span class="pr-ile">zamawiam: ${esc(liczbaNaTekst(ileNa))}</span>` : (najmniej <= malo ? '<span class="pz-malo-znak">mało</span>' : '')}
        </button>
        ${otwarty ? `<ul class="pz-warianty">${pr.warianty.filter(w => !p.tylkoMalo || (stanU(w) ?? Infinity) <= malo).map(w => {
          const st = stanU(w);
          const x = naLiscie(w.symbol);
          return `<li class="pz-wariant${st !== null && st <= malo ? ' malo' : ''}">
            <span class="pz-w-nazwa">${esc(w.wariant || pr.produkt)}</span>
            <span class="pz-stan">${st === null ? '—' : `masz: <b>${esc(liczbaNaTekst(st))}</b>`}</span>
            <span class="pz-ile">
              ${x ? `<button type="button" class="pr-okragly maly-okr" data-akcja="mniej" data-v="${esc(w.symbol)}" aria-label="Mniej">−</button><b>${esc(liczbaNaTekst(iloscZ(x)))}</b>` : ''}
              <button type="button" class="pr-okragly maly-okr" data-akcja="wiecej" data-v="${esc(w.symbol)}" aria-label="Więcej">+</button>
            </span>
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
      <div class="pr-k-ilosc">
        <button type="button" class="pr-okragly" data-akcja="minus" aria-label="Mniej">−</button>
        <span class="pr-liczba">${esc(liczbaNaTekst(iloscZ(x)))}</span>
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
  const moje = dane.zapotrzebowania.filter(z => !trybProsty() || z.osoba === (nazwaUzytkownika() || 'Grażynka')).slice(0, 10);
  if (!moje.length) return '';
  return `<h2 class="wy-pod">Twoje zgłoszenia</h2><ul class="pz-zgloszenia">${moje.map(z => `<li>
    <div class="wy-gora"><b>${esc(String(z.data || '').slice(0, 10))}</b><span class="pz-status s-${esc(normalizuj(z.status || 'nowe').replace(/\s+/g, '-'))}">${esc(etykietaStatusu(z.status || 'nowe'))}</span></div>
    <ul class="pz-pozycje">${pozycjeZ(z).map(x => `<li>${esc(x.nazwa)}${x.ilosc ? ` – <b>${esc(liczbaNaTekst(Number(x.ilosc)))}</b>` : ''}</li>`).join('')}</ul>
    ${z.uwagi ? `<p class="pr-podp">Uwagi: ${esc(z.uwagi)}</p>` : ''}
    ${z.odpowiedz ? `<p class="pz-odp">Odpowiedź: ${esc(z.odpowiedz)}</p>` : ''}
  </li>`).join('')}</ul>`;
}

function pozycjeZ(z) { try { return JSON.parse(z.pozycje || '[]'); } catch { return [{ nazwa: String(z.pozycje || '') }]; } }

function renderProsty() {
  const sztuk = p.pozycje.reduce((s, x) => s + iloscZ(x), 0);
  $('#widok').innerHTML = `<section class="ekran prosty-ekran potrzebuje-ekran">
    <h1 class="pr-tytul">${p.krok === 'lista' ? 'Potrzebuję – stany i zamawianie' : 'Sprawdź i wyślij'}</h1>
    <div class="pr-blad" id="pr-blad" role="alert" ${p.blad ? '' : 'hidden'}>${esc(p.blad)}</div>
    ${p.krok === 'lista' ? htmlListy() : htmlPodsumowania()}
    ${p.krok === 'lista' ? htmlMoichZgloszen() : ''}
    <div class="pr-dol">
      ${p.krok === 'lista' ? '<span></span>' : '<button type="button" class="pr-wstecz" data-akcja="wstecz">← Wstecz</button>'}
      ${p.krok === 'lista' ? `<button type="button" class="pr-dalej" data-akcja="dalej">Dalej → ${p.pozycje.length ? `(${esc(String(p.pozycje.length))} poz.${sztuk ? ', ' + esc(liczbaNaTekst(sztuk)) + ' szt.' : ''})` : '(albo wpisz ręcznie)'}</button>`
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
  else if (akcja === 'wiecej' || akcja === 'mniej') {
    const w = dane.cennik.find(c => c.symbol === v);
    if (!w) return;
    const x = naLiscie(v);
    if (akcja === 'wiecej') {
      if (x) x.iloscTxt = liczbaNaTekst(iloscZ(x) + 1);
      else p.pozycje.push({ k: uuid(), symbol: w.symbol, nazwa: w.nazwa, stan: stanU(w), iloscTxt: '1' });
    } else if (x) {
      const n = iloscZ(x) - 1;
      if (n <= 0) p.pozycje = p.pozycje.filter(y => y !== x); else x.iloscTxt = liczbaNaTekst(n);
    }
  } else if (akcja === 'plus' || akcja === 'minus' || akcja === 'usun') {
    const x = p.pozycje.find(y => y.k === b.closest('[data-k]').dataset.k);
    if (!x) return;
    const n = iloscZ(x) + (akcja === 'plus' ? 1 : -1);
    if (akcja === 'usun' || (n <= 0 && !x.reczny)) p.pozycje = p.pozycje.filter(y => y !== x);
    else x.iloscTxt = n > 0 ? liczbaNaTekst(n) : '';
  } else if (akcja === 'dopisz') {
    const nazwa = p.reczny.trim();
    if (!nazwa) { blad('Wpisz, czego potrzebujesz, np. „torebki papierowe małe”.'); return; }
    const ile = liczba(p.recznyIle);
    if (String(p.recznyIle).trim() && !(isFinite(ile) && ile > 0)) { blad('Ilość jest nieprawidłowa – wpisz liczbę, np. 20, albo zostaw puste.'); return; }
    p.pozycje.push({ k: uuid(), symbol: '', nazwa, reczny: true, stan: null, iloscTxt: isFinite(ile) && ile > 0 ? liczbaNaTekst(ile) : '' });
    p.reczny = ''; p.recznyIle = ''; p.blad = '';
  } else if (akcja === 'dalej') { p.krok = 'wyslij'; p.blad = ''; window.scrollTo(0, 0); }
  else if (akcja === 'wstecz') { p.krok = 'lista'; p.blad = ''; window.scrollTo(0, 0); }
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

// ───────────────────────── Darius ─────────────────────────

function renderPelny() {
  const lista = dane.zapotrzebowania;
  $('#widok').innerHTML = `<section class="ekran ustawienia">
    <h1>Zapotrzebowanie</h1>
    <p class="podpowiedz">Zgłoszenia z zakładki „Potrzebuję” (Grażynka). Nowe przychodzą też e-mailem na info@oneriver.pl. Status i odpowiedź Grażynka widzi u siebie.</p>
    ${lista.length ? `<ul class="pz-zgloszenia pelne">${lista.map(z => {
      const e = edycja[z.id] || { status: z.status || 'nowe', odpowiedz: z.odpowiedz || '' };
      return `<li class="panel" data-id="${esc(z.id)}">
        <div class="wy-gora"><b>${esc(z.osoba || '—')} · ${esc(String(z.data || '').slice(0, 16))}</b><span class="pz-status s-${esc(normalizuj(z.status || 'nowe').replace(/\s+/g, '-'))}">${esc(etykietaStatusu(z.status || 'nowe'))}</span></div>
        <table class="pz-tabela"><thead><tr><th>Produkt</th><th>Ile</th><th>Miała</th><th>GR teraz</th></tr></thead><tbody>
          ${pozycjeZ(z).map(x => { const w = x.symbol ? dane.cennik.find(c => c.symbol === x.symbol) : null; return `<tr>
            <td>${esc(x.nazwa)}${x.symbol ? ` <small>${esc(x.symbol)}</small>` : ' <small>(ręcznie)</small>'}</td><td>${esc(x.ilosc === '' || x.ilosc == null ? '—' : liczbaNaTekst(Number(x.ilosc)))}</td>
            <td>${esc(x.stan === '' || x.stan == null ? '—' : liczbaNaTekst(Number(x.stan)))}</td><td>${w && w.stanGr !== null ? esc(liczbaNaTekst(w.stanGr)) : '—'}</td></tr>`; }).join('')}
        </tbody></table>
        ${z.uwagi ? `<p>Uwagi: ${esc(z.uwagi)}</p>` : ''}
        <div class="chipy">${STATUSY_ZAP.map(([k, et]) => `<button type="button" class="chip" data-akcja="status" data-v="${esc(k)}" aria-pressed="${e.status === k}">${esc(et)}</button>`).join('')}</div>
        <label class="pole szeroka"><span class="etykieta">Odpowiedź dla Grażynki</span><input data-pole="odpowiedz" value="${esc(e.odpowiedz)}" placeholder="np. wysłane InPostem 12.11" autocomplete="off"></label>
        <div class="przyciski"><button type="button" data-akcja="zapisz-zap" ${edycja[z.id] ? '' : 'disabled'}>Zapisz</button></div>
      </li>`;
    }).join('')}</ul>` : '<p class="pusto">Nie ma jeszcze zgłoszeń.</p>'}
    <div class="przyciski"><a class="przycisk drugorzedny" href="#sklep">← Sklep</a></div>
  </section>`;
}

async function klikPelny(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const id = b.closest('[data-id]')?.dataset.id;
  const z = dane.zapotrzebowania.find(x => x.id === id);
  if (!z) return;
  const e0 = edycja[id] || { status: z.status || 'nowe', odpowiedz: z.odpowiedz || '' };
  if (b.dataset.akcja === 'status') { edycja[id] = { ...e0, status: b.dataset.v }; bezSkoku(renderPelny); }
  else if (b.dataset.akcja === 'zapisz-zap') {
    await sync.zapisz([{ karta: 'ZAPOTRZEBOWANIA', wiersze: [{ ...z, status: e0.status, odpowiedz: e0.odpowiedz }] }]);
    delete edycja[id];
    const { wczytaj } = await import('./dane.js');
    await wczytaj();
    toast('Zapisano – Grażynka zobaczy status u siebie.', 'ok');
    bezSkoku(renderPelny);
  }
}

function wejsciePelne(e) {
  if (e.target.dataset.pole !== 'odpowiedz') return;
  const id = e.target.closest('[data-id]')?.dataset.id;
  const z = dane.zapotrzebowania.find(x => x.id === id);
  if (!z) return;
  edycja[id] = { ...(edycja[id] || { status: z.status || 'nowe' }), odpowiedz: e.target.value };
  const przycisk = e.target.closest('[data-id]').querySelector('[data-akcja="zapisz-zap"]');
  if (przycisk) przycisk.disabled = false;
}

export const ekran = {
  render: () => (trybProsty() ? renderProsty() : renderPelny()),
  klik: e => (trybProsty() ? klikProsty(e) : klikPelny(e)),
  wejscie: e => (trybProsty() ? wejscieProste(e) : wejsciePelne(e)),
  zmiana: e => (trybProsty() ? wejscieProste(e) : null),
};
