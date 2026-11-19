// Zapotrzebowanie i przesunięcia międzymagazynowe (MM) – widok Dariusa (pełne Stoisko, #potrzebuje).
// Karta ZAPOTRZEBOWANIA, jeden wiersz = jedno zgłoszenie / jedno przesunięcie:
//   nowe         – Grażynka zgłosiła, czego potrzebuje (produkty, ilości nieobowiązkowe)
//   szkic        – Darius przygotowuje MM (Grażynka jeszcze nie widzi)
//   przygotowane – Darius ustalił ilości („wydano”) i wysłał towar; Grażynka liczy po odbiorze
//   sprawdzone   – Grażynka wpisała, ile naprawdę dostała („otrzymano”); czeka na zatwierdzenie
//   zatwierdzone – Darius zatwierdził; plik EPP (MMW) do Subiekta z ilościami „otrzymano”
//   anulowane
// Pozycje (JSON): [{ symbol, nazwa, ilosc (prośba), stan (GR przy zgłoszeniu), wydano, otrzymano }]

import { $, esc, liczba, liczbaNaTekst, uuid, toast, okno, normalizuj, bezSkoku, dataLok, dataKrotko } from './util.js';
import { dane } from './dane.js';
import { ustawienia, nazwaUzytkownika } from './api.js';
import { naCp1250, trescEppMM, FIRMA_INCO } from './epp.js';
import * as sync from './sync.js';

export const STATUSY_MM = [['nowe', 'Nowe zgłoszenie'], ['szkic', 'Szkic'], ['przygotowane', 'U Grażynki – do sprawdzenia'],
  ['sprawdzone', 'Do zatwierdzenia'], ['zatwierdzone', 'Zatwierdzone'], ['anulowane', 'Anulowane']];
export const etykietaMM = s => (STATUSY_MM.find(([k]) => k === s) || [s, s || 'Nowe zgłoszenie'])[1];
const status = z => z.status || 'nowe';
export const pozycjeZ = z => { try { const p = JSON.parse(z.pozycje || '[]'); return Array.isArray(p) ? p : []; } catch { return [{ nazwa: String(z.pozycje || '') }]; } };
const MAG_SGT = { INC: ['INC', 'Glowny', 'Magazyn glowny'], GR: ['GR', 'Grazanka', 'Grazanka'] };
const NAZWA_MAG = { INC: 'INC (Elsterska)', GR: 'GR (Grażynka)' };
const teraz = () => { const t = new Date(); const p = n => String(n).padStart(2, '0'); return `${dataLok(t)} ${p(t.getHours())}:${p(t.getMinutes())}`; };
const n0 = v => { const n = Number(v); return isFinite(n) ? n : 0; };

/** Do zrobienia przez Dariusa: nowe zgłoszenia i sprawdzone przez Grażynkę. */
export const ileDlaDariusa = () => dane.zapotrzebowania.filter(z => ['nowe', 'sprawdzone'].includes(status(z))).length;

const stan = { filtr: 'aktywne', edycja: null, szukaj: '' };
// edycja: { id, nowy, numer, magazynZ, magazynDo, uwagi, pozycje: [{ k, symbol, nazwa, ilosc, stan, wydanoTxt, otrzymano }] }

function nowyNumer() {
  const rok = new Date().getFullYear();
  const max = dane.zapotrzebowania.map(z => /^MM-(\d{4})-(\d+)$/.exec(String(z.numer || ''))).filter(m => m && Number(m[1]) === rok)
    .reduce((a, m) => Math.max(a, Number(m[2])), 0);
  return `MM-${rok}-${String(max + 1).padStart(4, '0')}`;
}

const produktINCO = w => /INCO/.test(w.podmioty || 'INCO');
function wyniki() {
  const slowa = normalizuj(stan.szukaj).split(/\s+/).filter(Boolean);
  if (!slowa.length) return [];
  return dane.cennik.filter(w => produktINCO(w) && slowa.every(s => normalizuj(w.nazwa + ' ' + w.symbol).includes(s))).slice(0, 30);
}

// ───────────── widok listy ─────────────

function htmlKarty(z) {
  const s = status(z);
  const poz = pozycjeZ(z);
  const zSprawdzeniem = s === 'sprawdzone' || s === 'zatwierdzone';
  return `<li class="panel mm-karta${['nowe', 'sprawdzone'].includes(s) ? ' wyroznij' : ''}" data-id="${esc(z.id)}">
    <div class="wy-gora"><b>${esc(z.numer || 'Zgłoszenie')} · ${esc(z.osoba || '—')}</b><span class="pz-status s-${esc(s)}">${esc(etykietaMM(s))}</span></div>
    <p class="mm-info">${esc(String(z.data || '').slice(0, 16))} · ${esc(NAZWA_MAG[z.mag_z || 'INC'] || z.mag_z || 'INC')} → ${esc(NAZWA_MAG[z.magazyn || 'GR'] || z.magazyn)}
      ${z.przygotowano ? ` · wydano ${esc(z.przygotowano)}` : ''}${z.sprawdzono ? ` · policzone ${esc(z.sprawdzono)}` : ''}${z.zatwierdzono ? ` · zatwierdzone ${esc(z.zatwierdzono)}` : ''}</p>
    <table class="pz-tabela"><thead><tr><th>Produkt</th>${s === 'nowe' ? '<th>Prośba</th><th>GR</th>' : `<th>Wydano</th>${zSprawdzeniem ? '<th>Dostała</th>' : ''}`}</tr></thead><tbody>
      ${poz.map(x => {
        const rozn = zSprawdzeniem && n0(x.otrzymano) !== n0(x.wydano);
        return `<tr class="${rozn ? 'mm-roznica' : ''}"><td>${esc(x.nazwa)}${x.symbol ? '' : ' <small>(ręcznie)</small>'}</td>
          ${s === 'nowe' ? `<td>${x.ilosc ? esc(liczbaNaTekst(n0(x.ilosc))) : '—'}</td><td>${x.stan === '' || x.stan == null ? '—' : esc(liczbaNaTekst(n0(x.stan)))}</td>`
            : `<td>${esc(liczbaNaTekst(n0(x.wydano)))}</td>${zSprawdzeniem ? `<td><b>${esc(liczbaNaTekst(n0(x.otrzymano)))}</b>${rozn ? ' ⚠︎' : ''}</td>` : ''}`}</tr>`;
      }).join('')}
    </tbody></table>
    ${z.uwagi ? `<p>Uwagi: ${esc(z.uwagi)}</p>` : ''}
    <div class="przyciski">
      ${s === 'nowe' ? '<button type="button" data-akcja="przygotuj">Przygotuj MM (ustal ilości)</button>' : ''}
      ${s === 'szkic' || s === 'przygotowane' ? '<button type="button" data-akcja="edytuj">Popraw</button>' : ''}
      ${s === 'sprawdzone' ? '<button type="button" data-akcja="zatwierdz">✓ Zatwierdź i pobierz plik EPP</button><button type="button" class="drugorzedny" data-akcja="edytuj">Popraw</button>' : ''}
      ${s === 'zatwierdzone' ? `<button type="button" class="drugorzedny" data-akcja="epp">⬇︎ Pobierz plik EPP${z.epp_eksport ? ' ponownie' : ''}</button>` : ''}
      ${s !== 'zatwierdzone' && s !== 'anulowane' ? '<button type="button" class="drugorzedny niebezpieczny" data-akcja="anuluj">Anuluj</button>' : ''}
    </div>
  </li>`;
}

function htmlEdycji() {
  const e = stan.edycja;
  const zle = e.pozycje.filter(x => !x.symbol);
  return `<section class="panel mm-edycja">
    <h2>${e.nowy ? 'Nowe przesunięcie' : 'Przesunięcie'} ${esc(e.numer)}</h2>
    <div class="chipy male"><span class="etykieta-mag">Z magazynu:</span>${['INC', 'GR'].map(m => `<button type="button" class="chip" data-akcja="mag-z" data-v="${m}" aria-pressed="${e.magazynZ === m}">${esc(NAZWA_MAG[m])}</button>`).join('')}</div>
    <div class="chipy male"><span class="etykieta-mag">Do magazynu:</span>${['GR', 'INC'].map(m => `<button type="button" class="chip" data-akcja="mag-do" data-v="${m}" aria-pressed="${e.magazynDo === m}">${esc(NAZWA_MAG[m])}</button>`).join('')}</div>
    ${e.pozycje.length ? `<ul class="mm-pozycje">${e.pozycje.map(x => {
      const w = x.symbol ? dane.cennik.find(c => c.symbol === x.symbol) : null;
      const zrodlo = w ? (e.magazynZ === 'GR' ? w.stanGr : w.stanInc) : null;
      const ile = liczba(x.wydanoTxt);
      return `<li data-k="${esc(x.k)}" class="${!x.symbol ? 'mm-zle' : ''}">
        <div class="mm-p-nazwa"><b>${esc(x.nazwa)}</b>${x.symbol ? ` <small>${esc(x.symbol)}</small>` : ' <small class="blad">wpisane ręcznie – znajdź produkt w katalogu i usuń tę linię</small>'}
          <small class="mm-stany">${x.ilosc ? `prośba: ${esc(liczbaNaTekst(n0(x.ilosc)))} · ` : ''}${zrodlo != null ? `${esc(e.magazynZ)}: ${esc(liczbaNaTekst(zrodlo))}` : ''}${w && w.stanGr != null && e.magazynZ !== 'GR' ? ` · GR: ${esc(liczbaNaTekst(w.stanGr))}` : ''}</small></div>
        ${x.symbol ? `<label class="mm-ile"><span>Wydaję</span><input data-pole="wydano" inputmode="decimal" value="${esc(x.wydanoTxt)}" placeholder="0" autocomplete="off"></label>` : ''}
        ${x.symbol && zrodlo != null && isFinite(ile) && ile > zrodlo ? `<small class="blad mm-ostrz">Więcej niż stan ${esc(e.magazynZ)} (${esc(liczbaNaTekst(zrodlo))}).</small>` : ''}
        <button type="button" class="pr-usun" data-akcja="usun-poz">Usuń</button>
      </li>`;
    }).join('')}</ul>` : '<p class="pr-info">Dodaj produkty – wyszukaj poniżej.</p>'}
    <label class="pole szukaj"><span class="etykieta">Dodaj produkt</span><input type="search" data-pole="szukaj-mm" value="${esc(stan.szukaj)}" placeholder="np. rosa blanca 24, caneleiro" autocomplete="off"></label>
    <ul class="mm-wyniki">${htmlWynikow()}</ul>
    <label class="pole szeroka"><span class="etykieta">Uwagi (trafią do dokumentu)</span><input data-pole="uwagi-mm" value="${esc(e.uwagi)}" maxlength="200" autocomplete="off"></label>
    ${zle.length ? '<p class="blad">Pozycje wpisane ręcznie nie trafią do Subiekta – zamień je na produkty z katalogu.</p>' : ''}
    <div class="przyciski mm-zapis">
      <button type="button" data-akcja="do-grazynki">📦 Wyślij Grażynce do sprawdzenia</button>
      <button type="button" class="drugorzedny" data-akcja="od-razu">✓ Zatwierdź od razu i pobierz EPP</button>
      <button type="button" class="drugorzedny" data-akcja="szkic">Zapisz szkic</button>
      <button type="button" class="drugorzedny" data-akcja="zamknij">Zamknij</button>
    </div>
    <p class="podpowiedz">„Wyślij Grażynce” – Grażynka policzy towar po odbiorze i poprawi ilości; potem zatwierdzisz i pobierzesz plik. „Zatwierdź od razu” – bez liczenia u Grażynki (np. gdy towar już sprawdzony).</p>
  </section>`;
}

function htmlWynikow() {
  return wyniki().map(w => `<li><button type="button" class="mm-wynik" data-akcja="dodaj-poz" data-v="${esc(w.symbol)}">
    <span>${esc(w.nazwa)}</span><small>INC: ${w.stanInc == null ? '—' : esc(liczbaNaTekst(w.stanInc))} · GR: ${w.stanGr == null ? '—' : esc(liczbaNaTekst(w.stanGr))}</small></button></li>`).join('')
    || (stan.szukaj ? '<li class="pr-pusto">Nic nie znaleziono w katalogu INCO.</li>' : '');
}

function render() {
  const wszystkie = dane.zapotrzebowania;
  const filtry = [['aktywne', 'Do zrobienia i w toku'], ['zatwierdzone', 'Zatwierdzone'], ['wszystkie', 'Wszystkie']];
  const lista = wszystkie.filter(z => stan.filtr === 'wszystkie' || (stan.filtr === 'zatwierdzone' ? status(z) === 'zatwierdzone' : !['zatwierdzone', 'anulowane'].includes(status(z))));
  $('#widok').innerHTML = `<section class="ekran ustawienia przesuniecia">
    <h1>Zapotrzebowanie i przesunięcia (MM)</h1>
    ${stan.edycja ? htmlEdycji() : `<div class="przyciski"><button type="button" data-akcja="nowe-mm">+ Nowe przesunięcie (MM)</button><a class="przycisk drugorzedny" href="#sklep">← Sklep</a></div>
    <p class="podpowiedz">Zgłoszenia Grażynki z zakładki „Potrzebuję” i przesunięcia między magazynami. Plik EPP wczytasz w Subiekcie (INCO): Operacje → Odbierz z… → Plik EDI++.</p>`}
    <div class="chipy male">${filtry.map(([f, e]) => `<button type="button" class="chip" data-filtr="${f}" aria-pressed="${stan.filtr === f}">${esc(e)}</button>`).join('')}</div>
    ${lista.length ? `<ul class="pz-zgloszenia pelne">${lista.map(htmlKarty).join('')}</ul>` : '<p class="pusto">Nic tu nie ma.</p>'}
  </section>`;
}

// ───────────── zapis i plik ─────────────

function zEdycji(nowyStatus) {
  const e = stan.edycja;
  const stary = dane.zapotrzebowania.find(z => z.id === e.id) || {};
  const pozycje = e.pozycje.map(x => ({ symbol: x.symbol || '', nazwa: x.nazwa, ilosc: x.ilosc ?? '', stan: x.stan ?? '',
    wydano: x.symbol ? (isFinite(liczba(x.wydanoTxt)) ? liczba(x.wydanoTxt) : 0) : '', otrzymano: x.otrzymano ?? '' }));
  return { ...stary, id: e.id, numer: e.numer, data: stary.data || teraz(), osoba: stary.osoba || nazwaUzytkownika() || 'Darius',
    mag_z: e.magazynZ, magazyn: e.magazynDo, uwagi: e.uwagi, status: nowyStatus, pozycje: JSON.stringify(pozycje) };
}

function blednaEdycja() {
  const e = stan.edycja;
  if (e.magazynZ === e.magazynDo) return 'Magazyn źródłowy i docelowy muszą być różne.';
  const z = e.pozycje.filter(x => x.symbol);
  if (!z.length) return 'Dodaj co najmniej jeden produkt z katalogu.';
  if (e.pozycje.some(x => !x.symbol)) return 'Są pozycje wpisane ręcznie – zamień je na produkty z katalogu albo usuń.';
  const zla = z.find(x => { const n = liczba(x.wydanoTxt); return !(isFinite(n) && n > 0); });
  if (zla) return `Wpisz ilość dla: ${zla.nazwa}.`;
  return '';
}

function pobierzPlik(nazwa, bajty) {
  const url = URL.createObjectURL(new Blob([bajty], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = nazwa; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Plik EPP (MMW) z ilościami policzonymi przez Grażynkę (albo wydanymi, gdy zatwierdzone bez liczenia). */
export function plikMM(z) {
  const mz = z.mag_z || 'INC', md = z.magazyn || 'GR';
  const [magazyn, magazynNazwa, magazynOpis] = MAG_SGT[mz] || MAG_SGT.INC;
  const pozycje = pozycjeZ(z).filter(x => x.symbol).map(x => {
    const w = dane.cennik.find(c => c.symbol === x.symbol) || {};
    const ile = x.otrzymano !== '' && x.otrzymano != null ? n0(x.otrzymano) : n0(x.wydano);
    return { symbol: x.symbol, nazwa: w.nazwa || x.nazwa, typ: w.rodzaj || 'towar', jm: w.jm || 'szt.', ilosc: ile, vat: 23, cenaCennik: w.cena || 0, grupa: w.grupa || '' };
  }).filter(p => p.ilosc > 0);
  if (!pozycje.length) throw new Error('Wszystkie ilości są zerowe – nie ma czego przesunąć.');
  const data = String(z.zatwierdzono || z.data || dataLok()).slice(0, 10);
  const nr = Number(String(z.numer || '').split('-').pop()) || 1;
  const tresc = trescEppMM({ ...FIRMA_INCO, magazyn, magazynNazwa, magazynOpis }, [{ numer: nr, pelnyNumer: z.numer || '', data,
    magazynDo: md, wystawca: ustawienia().kto || 'Stoisko', odbiorca: md === 'GR' ? 'Grazynka' : '',
    uwagi: `Stoisko ${z.numer || z.id}${z.uwagi ? ' - ' + z.uwagi : ''}`.slice(0, 255), pozycje }]);
  pobierzPlik(`MM_${mz}-${md}_${z.numer || z.id}.epp`, naCp1250(tresc));
  return pozycje.length;
}

async function zapisz(wiersz) {
  await sync.zapisz([{ karta: 'ZAPOTRZEBOWANIA', wiersze: [wiersz] }]);
  const { wczytaj } = await import('./dane.js');
  await wczytaj();
}

async function zatwierdz(z) {
  const wiersz = { ...z, status: 'zatwierdzone', zatwierdzono: teraz(), epp_eksport: teraz() };
  const n = plikMM(wiersz);
  await zapisz(wiersz);
  toast(`Zatwierdzone. Pobrano plik EPP (${n} poz.) – wczytaj go w Subiekcie INCO.`, 'ok', 8000);
}

// ───────────── obsługa ─────────────

function otworzEdycje(z) {
  if (!z) {
    stan.edycja = { id: 'zp-' + dataLok().replace(/-/g, '') + '-' + uuid().slice(0, 6), nowy: true, numer: nowyNumer(), magazynZ: 'INC', magazynDo: 'GR', uwagi: '', pozycje: [] };
  } else {
    stan.edycja = { id: z.id, nowy: false, numer: z.numer || nowyNumer(), magazynZ: z.mag_z || 'INC', magazynDo: z.magazyn || 'GR', uwagi: z.uwagi || '',
      pozycje: pozycjeZ(z).map(x => ({ k: uuid(), symbol: x.symbol || '', nazwa: x.nazwa, ilosc: x.ilosc, stan: x.stan,
        wydanoTxt: x.otrzymano !== '' && x.otrzymano != null ? liczbaNaTekst(n0(x.otrzymano)) : (x.wydano !== '' && x.wydano != null ? liczbaNaTekst(n0(x.wydano)) : (x.ilosc ? liczbaNaTekst(n0(x.ilosc)) : '')),
        otrzymano: '' })) };
  }
  stan.szukaj = '';
  render();
  window.scrollTo(0, 0);
}

async function klik(e) {
  const f = e.target.closest('[data-filtr]');
  if (f) { stan.filtr = f.dataset.filtr; render(); return; }
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const a = b.dataset.akcja;
  const z = dane.zapotrzebowania.find(x => x.id === b.closest('[data-id]')?.dataset.id);
  const ed = stan.edycja;
  if (a === 'nowe-mm') otworzEdycje(null);
  else if ((a === 'przygotuj' || a === 'edytuj') && z) otworzEdycje(z);
  else if (a === 'zatwierdz' && z) { b.disabled = true; try { await zatwierdz(z); } catch (err) { toast(err.message, 'blad', 8000); } render(); }
  else if (a === 'epp' && z) {
    try { plikMM(z); await zapisz({ ...z, epp_eksport: teraz() }); render(); } catch (err) { toast(err.message, 'blad', 8000); }
  } else if (a === 'anuluj' && z) {
    const tak = await okno(`Anulować ${esc(z.numer || 'zgłoszenie')}?`, '<p>Zgłoszenie zostanie w historii jako anulowane.</p>',
      [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Anuluj zgłoszenie', wartosc: true }]);
    if (tak) { await zapisz({ ...z, status: 'anulowane' }); render(); }
  } else if (!ed) return;
  else if (a === 'mag-z') { ed.magazynZ = b.dataset.v; if (ed.magazynDo === ed.magazynZ) ed.magazynDo = ed.magazynZ === 'GR' ? 'INC' : 'GR'; bezSkoku(render); }
  else if (a === 'mag-do') { ed.magazynDo = b.dataset.v; if (ed.magazynDo === ed.magazynZ) ed.magazynZ = ed.magazynDo === 'GR' ? 'INC' : 'GR'; bezSkoku(render); }
  else if (a === 'dodaj-poz') {
    const w = dane.cennik.find(c => c.symbol === b.dataset.v);
    if (!w) return;
    if (!ed.pozycje.some(x => x.symbol === w.symbol)) ed.pozycje.push({ k: uuid(), symbol: w.symbol, nazwa: w.nazwa, ilosc: '', stan: w.stanGr ?? '', wydanoTxt: '' });
    stan.szukaj = '';
    render();
    const pole = document.querySelector(`.mm-pozycje li:last-child input[data-pole="wydano"]`);
    if (pole) { pole.scrollIntoView({ block: 'center' }); pole.focus(); }
  } else if (a === 'usun-poz') { ed.pozycje = ed.pozycje.filter(x => x.k !== b.closest('[data-k]').dataset.k); bezSkoku(render); }
  else if (a === 'zamknij') { stan.edycja = null; render(); }
  else if (a === 'szkic' || a === 'do-grazynki' || a === 'od-razu') {
    if (a !== 'szkic') { const bl = blednaEdycja(); if (bl) { toast(bl, 'blad', 7000); return; } }
    b.disabled = true;
    try {
      if (a === 'szkic') { await zapisz(zEdycji('szkic')); toast('Szkic zapisany – Grażynka go nie widzi.', 'ok'); }
      else if (a === 'do-grazynki') { await zapisz({ ...zEdycji('przygotowane'), przygotowano: teraz() }); toast('Wysłane do Grażynki – policzy towar po odbiorze.', 'ok', 6000); }
      else {
        const w = zEdycji('zatwierdzone');
        const poz = pozycjeZ(w).map(x => ({ ...x, otrzymano: x.wydano }));
        await zatwierdz({ ...w, pozycje: JSON.stringify(poz), przygotowano: w.przygotowano || teraz() });
      }
      stan.edycja = null;
      render();
    } catch (err) { toast(err.message, 'blad', 8000); b.disabled = false; }
  }
}

function wejscie(e) {
  const pole = e.target.dataset.pole;
  const ed = stan.edycja;
  if (!ed) return;
  if (pole === 'szukaj-mm') { stan.szukaj = e.target.value; const ul = $('.mm-wyniki'); if (ul) ul.innerHTML = htmlWynikow(); }
  else if (pole === 'uwagi-mm') ed.uwagi = e.target.value;
  else if (pole === 'wydano') { const x = ed.pozycje.find(y => y.k === e.target.closest('[data-k]').dataset.k); if (x) x.wydanoTxt = e.target.value; }
}

export const ekran = { render, klik, wejscie };
