// Inwentaryzacja magazynu GR (Grażynka).
// Grażynka (tryb prosty, zakładka „Liczenie”): lista produktów, które wg systemu ma na stanie, z podpowiedzią
// „powinno być”; jednym dotknięciem „Zgadza się” albo wpisuje policzoną liczbę. Postęp zapisuje się w telefonie.
// Na końcu podsumowanie różnic i wysłanie. Darius (pełne Stoisko, Sklep → Inwentaryzacja): różnice z wartością,
// zatwierdzenie, arkusz do PDF (drukuj → zapisz jako PDF), pliki EPP do Subiekta: PW (nadwyżki) i RW (braki),
// albo prośba o ponowne liczenie.
// Zapis: karta ZAPOTRZEBOWANIA, typ „inwentaryzacja” (statusy: policzone → zatwierdzone; ponownie – do poprawy).
// Pozycje (JSON): [{ s: symbol, n: nazwa, sys: stan systemowy przy liczeniu, p: policzono }]

import { $, esc, liczba, liczbaNaTekst, uuid, toast, okno, normalizuj, bezSkoku, dataLok, kwotaTxt } from './util.js';
import { dane } from './dane.js';
import { trybProsty, nazwaUzytkownika, ustawienia } from './api.js';
import { KATEGORIE } from './prosty.js';
import { naCp1250, trescEppMM, FIRMA_INCO } from './epp.js';
import * as sync from './sync.js';

const KLUCZ = 'or-stoisko-inwentaryzacja';
const MAG = 'GR';
const n0 = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const teraz = () => { const t = new Date(); const p = n => String(n).padStart(2, '0'); return `${dataLok(t)} ${p(t.getHours())}:${p(t.getMinutes())}`; };
const pozycjeZ = z => { try { const p = JSON.parse(z.pozycje || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } };
const KAT = [...KATEGORIE, ['inne', 'Inne']];
const katPozycji = w => (KATEGORIE.some(([k]) => k === w.kategoria) ? w.kategoria : 'inne');

/** Do zrobienia: Grażynka – prośba o ponowne liczenie; Darius – policzone do zatwierdzenia. */
export const ileInwentaryzacji = () => (trybProsty()
  ? dane.inwentaryzacje.filter(z => z.status === 'ponownie').length
  : dane.inwentaryzacje.filter(z => z.status === 'policzone').length);

function nowyNumer() {
  const rok = new Date().getFullYear();
  const max = dane.inwentaryzacje.map(z => /^INW-(\d{4})-(\d+)$/.exec(String(z.numer || ''))).filter(m => m && Number(m[1]) === rok)
    .reduce((a, m) => Math.max(a, Number(m[2])), 0);
  return `INW-${rok}-${String(max + 1).padStart(4, '0')}`;
}

// ═════════════════════════ Grażynka ═════════════════════════

let g = (() => { try { return JSON.parse(localStorage.getItem(KLUCZ) || 'null'); } catch { return null; } })();
// g: { id, numer, start, poz: { symbol: { n, sys, p } }, kolejnosc: [symbol], kategoria, szukaj, tylkoNie, krok: 'lista'|'sprawdz', blad }
const zachowaj = () => { try { if (g) localStorage.setItem(KLUCZ, JSON.stringify({ ...g, blad: '' })); else localStorage.removeItem(KLUCZ); } catch { /* bez znaczenia */ } };
let wyslane = null;   // numer po wysłaniu (ekran „gotowe”)

function rozpocznij(zPonownej) {
  const poz = {};
  if (zPonownej) {
    pozycjeZ(zPonownej).forEach(x => { poz[x.s] = { n: x.n, sys: n0(x.sys), p: x.p === '' || x.p == null ? null : n0(x.p) }; });
  } else {
    dane.cennik.filter(w => w.stanGr != null && w.stanGr > 0).forEach(w => { poz[w.symbol] = { n: w.nazwa, sys: w.stanGr, p: null }; });
  }
  g = { id: zPonownej ? zPonownej.id : 'inw-' + dataLok().replace(/-/g, '') + '-' + uuid().slice(0, 6), numer: zPonownej ? zPonownej.numer : nowyNumer(),
    start: zPonownej ? zPonownej.data : teraz(), poz, kategoria: KAT[0][0], szukaj: '', tylkoNie: false, krok: 'lista', blad: '' };
  wyslane = null;
  zachowaj();
}

const policzone = () => Object.values(g.poz).filter(x => x.p !== null).length;
const wszystkie = () => Object.keys(g.poz).length;

function produktyDoListy() {
  const slowa = normalizuj(g.szukaj).split(/\s+/).filter(Boolean);
  return dane.produkty.map(pr => ({ pr, w: pr.warianty.filter(w => g.poz[w.symbol]
    && (!g.tylkoNie || g.poz[w.symbol].p === null)) }))
    .filter(({ pr, w }) => w.length && (slowa.length ? slowa.every(s => pr.szukaj.includes(s)) : katPozycji(w[0]) === g.kategoria))
    .sort((a, b) => a.pr.produkt.localeCompare(b.pr.produkt, 'pl'));
}

/** Produkty spoza listy (system ma 0, a na półce są) – do dodania przy wyszukiwaniu. */
function spozaListy() {
  const slowa = normalizuj(g.szukaj).split(/\s+/).filter(Boolean);
  if (!slowa.length) return [];
  return dane.cennik.filter(w => !g.poz[w.symbol] && /INCO/.test(w.podmioty || 'INCO') && slowa.every(s => normalizuj(w.nazwa + ' ' + w.symbol).includes(s))).slice(0, 8);
}

function htmlWiersza(w) {
  const x = g.poz[w.symbol];
  const rozn = x.p === null ? null : x.p - x.sys;
  return `<li class="inw-war${x.p === null ? '' : rozn === 0 ? ' ok' : ' inaczej'}" data-s="${esc(w.symbol)}">
    <div class="inw-w-gora"><span class="inw-w-nazwa">${esc(w.wariant || w.nazwa)}</span>
      <span class="inw-powinno">powinno być: <b>${esc(liczbaNaTekst(x.sys))}</b></span></div>
    <div class="inw-w-dol">
      ${x.p === null ? '<button type="button" class="inw-zgadza" data-akcja="zgadza">✓ Zgadza się</button>'
        : `<span class="inw-wynik ${rozn === 0 ? 'ok' : rozn < 0 ? 'minus' : 'plus'}">${rozn === 0 ? '✓ zgadza się' : (rozn > 0 ? '+' : '−') + esc(liczbaNaTekst(Math.abs(rozn)))}</span>`}
      <span class="inw-licz">
        <button type="button" class="pr-okragly maly-okr" data-akcja="minus" aria-label="Mniej">−</button>
        <input class="inw-pole" data-pole="ile" inputmode="numeric" value="${x.p === null ? '' : esc(liczbaNaTekst(x.p))}" placeholder="—" aria-label="Policzono" autocomplete="off">
        <button type="button" class="pr-okragly maly-okr" data-akcja="plus" aria-label="Więcej">+</button>
      </span>
    </div>
  </li>`;
}

function htmlListy() {
  if (!g.szukaj && !Object.entries(g.poz).some(([s]) => { const w = dane.cennik.find(c => c.symbol === s); return w && katPozycji(w) === g.kategoria; })) {
    const pierwsza = KAT.find(([k]) => Object.keys(g.poz).some(s => { const w = dane.cennik.find(c => c.symbol === s); return w && katPozycji(w) === k; }));
    if (pierwsza) g.kategoria = pierwsza[0];
  }
  const lista = produktyDoListy();
  const ile = k => Object.entries(g.poz).filter(([s]) => { const w = dane.cennik.find(c => c.symbol === s); return w && katPozycji(w) === k; });
  const procent = Math.round((policzone() / Math.max(1, wszystkie())) * 100);
  const extra = spozaListy();
  return `
    <div class="inw-pasek"><div>Policzone: <b>${policzone()} z ${wszystkie()}</b> pozycji</div>
      <div class="inw-postep"><i style="width:${procent}%"></i></div>
      <small>Możesz przerwać i wrócić – liczenie zapisuje się w telefonie.</small></div>
    <div class="pr-przyklejone">
      <div class="pr-kategorie">${KAT.filter(([k]) => ile(k).length).map(([k, e]) => { const l = ile(k); return `<button type="button" class="pr-kat" data-akcja="kategoria" data-v="${esc(k)}" aria-pressed="${!g.szukaj && g.kategoria === k}">${esc(e)} <small>${l.filter(([, x]) => x.p !== null).length}/${l.length}</small></button>`; }).join('')}</div>
      <label class="pr-szukaj"><span class="sr">Szukaj</span><input type="search" data-pole="szukaj" value="${esc(g.szukaj)}" placeholder="🔍 Szukaj po nazwie" autocomplete="off"></label>
    </div>
    <label class="pr-przelacznik"><input type="checkbox" data-pole="tylkoNie" ${g.tylkoNie ? 'checked' : ''}> Pokaż tylko jeszcze niepoliczone</label>
    <ul class="inw-produkty">${lista.map(({ pr, w }) => `<li class="inw-produkt"><b class="inw-p-nazwa">${esc(pr.produkt)}</b>
      <ul class="inw-warianty">${w.map(htmlWiersza).join('')}</ul></li>`).join('')
      || `<li class="pr-pusto">${g.tylkoNie ? 'Wszystko w tej grupie policzone ✓' : 'Nic nie znaleziono na liście.'}</li>`}</ul>
    ${extra.length ? `<div class="inw-extra"><h2>Jest na półce, a nie ma na liście?</h2><p class="pr-podp">System ma 0 sztuk. Dotknij, żeby dodać do liczenia.</p>
      ${extra.map(w => `<button type="button" class="pr-drugi" data-akcja="dodaj" data-v="${esc(w.symbol)}">+ ${esc(w.nazwa)}</button>`).join('')}</div>` : ''}`;
}

function htmlSprawdzenia() {
  const poz = Object.entries(g.poz);
  const nie = poz.filter(([, x]) => x.p === null);
  const rozne = poz.filter(([, x]) => x.p !== null && x.p !== x.sys).sort((a, b) => a[1].n.localeCompare(b[1].n, 'pl'));
  return `
    <div class="inw-podsum"><div><b>${poz.length - nie.length}</b>policzone</div><div><b>${nie.length}</b>niepoliczone</div><div><b>${rozne.length}</b>inaczej niż w systemie</div></div>
    ${nie.length ? `<div class="inw-uwaga">${nie.length} ${nie.length === 1 ? 'pozycja nie jest policzona' : 'pozycji nie jest policzonych'}. Policz je albo dotknij „Nie ma (0)”.</div>
      <ul class="inw-lista-roz">${nie.map(([s, x]) => `<li data-s="${esc(s)}"><span>${esc(x.n)}<small>powinno być ${esc(liczbaNaTekst(x.sys))}</small></span>
        <span class="inw-akcje"><button type="button" class="pr-drugi maly-pr" data-akcja="zgadza">✓ ${esc(liczbaNaTekst(x.sys))}</button><button type="button" class="pr-drugi maly-pr" data-akcja="zero">Nie ma (0)</button></span></li>`).join('')}</ul>` : '<div class="inw-uwaga ok">Wszystko policzone ✓</div>'}
    ${rozne.length ? `<h2>Inaczej niż w systemie</h2><p class="pr-podp">Warto przeliczyć jeszcze raz. Popraw liczbę przyciskami.</p>
      <ul class="inw-lista-roz">${rozne.map(([s, x]) => `<li data-s="${esc(s)}"><span>${esc(x.n)}<small>w systemie ${esc(liczbaNaTekst(x.sys))}</small></span>
        <span class="inw-licz"><button type="button" class="pr-okragly maly-okr" data-akcja="minus">−</button>
          <b class="inw-wynik ${x.p < x.sys ? 'minus' : 'plus'}">${esc(liczbaNaTekst(x.p))} (${x.p > x.sys ? '+' : '−'}${esc(liczbaNaTekst(Math.abs(x.p - x.sys)))})</b>
          <button type="button" class="pr-okragly maly-okr" data-akcja="plus">+</button></span></li>`).join('')}</ul>` : ''}
    <label class="pr-pole"><span>Uwagi dla Dariusa (nie trzeba)</span><textarea data-pole="uwagi" rows="2" placeholder="np. dwa opakowania uszkodzone">${esc(g.uwagi || '')}</textarea></label>`;
}

function renderProsty() {
  const ponownie = dane.inwentaryzacje.find(z => z.status === 'ponownie' && (z.magazyn || MAG) === MAG);
  if (wyslane) {
    $('#widok').innerHTML = `<section class="ekran prosty-ekran inw-ekran"><div class="pr-gotowe">
      <div class="pr-ok">✓</div><h1>Wysłane do Dariusa</h1>
      <p>Inwentaryzacja ${esc(wyslane)}</p>
      <p class="pr-info">Darius sprawdzi i zatwierdzi. Jeśli coś trzeba policzyć jeszcze raz, zobaczysz to w tej zakładce.</p>
      <button type="button" class="pr-glowny" data-akcja="koniec">OK</button></div></section>`;
    return;
  }
  if (!g) {
    const ostatnie = dane.inwentaryzacje.filter(z => (z.magazyn || MAG) === MAG).slice(0, 5);
    $('#widok').innerHTML = `<section class="ekran prosty-ekran inw-ekran">
      <h1 class="pr-tytul">Inwentaryzacja</h1>
      ${ponownie ? `<div class="inw-uwaga">Darius prosi o ponowne policzenie (${esc(ponownie.numer || '')}).${ponownie.odpowiedz ? ` <b>${esc(ponownie.odpowiedz)}</b>` : ''}</div>
        <button type="button" class="pr-glowny" data-akcja="ponownie">Policz ponownie</button>`
        : `<p class="pr-info">Na koniec miesiąca policz wszystko, co masz na półkach. Przy każdym produkcie zobaczysz, ile powinno być – jeśli się zgadza, wystarczy dotknąć „✓ Zgadza się”.</p>
        <button type="button" class="pr-glowny" data-akcja="start">Rozpocznij liczenie</button>`}
      ${ostatnie.length ? `<h2 class="wy-pod">Poprzednie</h2><ul class="pz-zgloszenia">${ostatnie.map(z => `<li><div class="wy-gora"><b>${esc(z.numer || '')}</b>
        <span class="pz-status">${esc({ policzone: 'Wysłane do Dariusa', zatwierdzone: 'Zatwierdzone', ponownie: 'Do ponownego liczenia' }[z.status] || z.status)}</span></div>
        <p class="pr-podp">${esc(String(z.data || '').slice(0, 10))}</p></li>`).join('')}</ul>` : ''}
    </section>`;
    return;
  }
  $('#widok').innerHTML = `<section class="ekran prosty-ekran inw-ekran">
    <h1 class="pr-tytul">${g.krok === 'lista' ? 'Inwentaryzacja – liczenie' : 'Sprawdź przed wysłaniem'}</h1>
    <div class="pr-blad" id="pr-blad" role="alert" ${g.blad ? '' : 'hidden'}>${esc(g.blad || '')}</div>
    ${g.krok === 'lista' ? htmlListy() : htmlSprawdzenia()}
    <div class="pr-dol">
      ${g.krok === 'lista' ? '<button type="button" class="pr-wstecz" data-akcja="przerwij">Przerwij</button><button type="button" class="pr-dalej" data-akcja="dalej">Dalej → sprawdź</button>'
        : '<button type="button" class="pr-wstecz" data-akcja="wstecz">← Wróć</button><button type="button" class="pr-dalej" data-akcja="wyslij">✓ Zakończ i wyślij</button>'}
    </div>
  </section>`;
}

function odswiezWiersz() { bezSkoku(renderProsty); }

async function wyslij(b) {
  const nie = Object.values(g.poz).filter(x => x.p === null).length;
  if (nie) { g.blad = `Zostało ${nie} niepoliczonych pozycji – policz je albo dotknij „Nie ma (0)”.`; bezSkoku(renderProsty); $('#pr-blad')?.scrollIntoView({ block: 'center' }); return; }
  b.disabled = true; b.textContent = 'Wysyłam…';
  try {
    const pozycje = Object.entries(g.poz).map(([s, x]) => ({ s, n: x.n, sys: x.sys, p: x.p }));
    await sync.zapisz([{ karta: 'ZAPOTRZEBOWANIA', wiersze: [{ id: g.id, typ: 'inwentaryzacja', numer: g.numer, data: g.start, osoba: nazwaUzytkownika() || 'Grażynka',
      magazyn: MAG, status: 'policzone', sprawdzono: teraz(), uwagi: String(g.uwagi || '').trim(), odpowiedz: '', pozycje: JSON.stringify(pozycje) }] }]);
    const { wczytaj } = await import('./dane.js');
    await wczytaj();
    wyslane = g.numer;
    g = null; zachowaj();
    window.scrollTo(0, 0);
    renderProsty();
  } catch (err) {
    b.disabled = false; b.textContent = '✓ Zakończ i wyślij';
    g.blad = 'Nie udało się wysłać: ' + (err?.message || err) + '. Spróbuj jeszcze raz.'; bezSkoku(renderProsty);
  }
}

async function klikProsty(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const a = b.dataset.akcja;
  if (a === 'koniec') { wyslane = null; renderProsty(); return; }
  if (a === 'start') { rozpocznij(null); renderProsty(); return; }
  if (a === 'ponownie') { rozpocznij(dane.inwentaryzacje.find(z => z.status === 'ponownie')); renderProsty(); return; }
  if (!g) return;
  const s = b.closest('[data-s]')?.dataset.s;
  const x = s ? g.poz[s] : null;
  if (a === 'kategoria') { g.kategoria = b.dataset.v; g.szukaj = ''; }
  else if (a === 'zgadza' && x) { x.p = x.sys; }
  else if (a === 'zero' && x) { x.p = 0; }
  else if ((a === 'plus' || a === 'minus') && x) { x.p = Math.max(0, (x.p === null ? x.sys : x.p) + (a === 'plus' ? 1 : -1)); }
  else if (a === 'dodaj') {
    const w = dane.cennik.find(c => c.symbol === b.dataset.v);
    if (w) { g.poz[w.symbol] = { n: w.nazwa, sys: 0, p: null }; toast(`Dodano: ${w.nazwa}. Wpisz, ile jest.`, 'ok'); }
  } else if (a === 'dalej') { g.krok = 'sprawdz'; g.blad = ''; window.scrollTo(0, 0); }
  else if (a === 'wstecz') { g.krok = 'lista'; g.blad = ''; window.scrollTo(0, 0); }
  else if (a === 'przerwij') { zachowaj(); toast('Liczenie zapisane – wrócisz do niego w tej zakładce.', 'ok', 5000); location.hash = '#prosty'; return; }
  else if (a === 'wyslij') { await wyslij(b); return; }
  else return;
  zachowaj();
  if (g.krok === 'lista' && s && x) odswiezWiersz(s); else bezSkoku(renderProsty);
}

function wejscieProste(e) {
  if (!g) return;
  const pole = e.target.dataset.pole;
  if (pole === 'szukaj') { g.szukaj = e.target.value; zachowaj(); const ul = $('.inw-produkty'); if (ul) { bezSkoku(renderProsty); const i = $('[data-pole="szukaj"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } return; }
  if (pole === 'tylkoNie') { g.tylkoNie = e.target.checked; zachowaj(); bezSkoku(renderProsty); return; }
  if (pole === 'uwagi') { g.uwagi = e.target.value; zachowaj(); return; }
  if (pole === 'ile') {
    const s = e.target.closest('[data-s]')?.dataset.s;
    const x = g.poz[s];
    if (!x) return;
    const t = e.target.value.trim();
    const n = liczba(t);
    x.p = t === '' ? null : (isFinite(n) && n >= 0 ? n : x.p);
    zachowaj();
  }
}

function zmianaProsta(e) {
  if (e.target.dataset.pole === 'ile') { const s = e.target.closest('[data-s]')?.dataset.s; if (s) odswiezWiersz(s); }
  else if (e.target.dataset.pole === 'tylkoNie') wejscieProste(e);
}

// ═════════════════════════ Darius ═════════════════════════

const stan = { otwarta: '', wszystkie: false };
const ETYKIETY = { policzone: 'Do zatwierdzenia', zatwierdzone: 'Zatwierdzone', ponownie: 'Do ponownego liczenia' };

function wyliczenia(z) {
  const poz = pozycjeZ(z).map(x => {
    const w = dane.cennik.find(c => c.symbol === x.s) || {};
    const rozn = n0(x.p) - n0(x.sys);
    return { ...x, w, rozn, cena: n0(w.cena), wartosc: rozn * n0(w.cena) };
  }).sort((a, b) => String(a.n).localeCompare(String(b.n), 'pl'));
  const rozne = poz.filter(x => x.rozn !== 0);
  return { poz, rozne, nadwyzki: rozne.filter(x => x.rozn > 0), braki: rozne.filter(x => x.rozn < 0),
    suma: rozne.reduce((a, x) => a + x.rozn, 0), wartosc: rozne.reduce((a, x) => a + x.wartosc, 0) };
}

function htmlSzczegolow(z) {
  const r = wyliczenia(z);
  const pokaz = stan.wszystkie ? r.poz : r.rozne;
  return `<div class="inw-szczegoly">
    <p class="mm-info">${r.poz.length} pozycji · ${r.rozne.length} różnic (nadwyżki: ${r.nadwyzki.length}, braki: ${r.braki.length}) · wartość różnic: <b>${esc(kwotaTxt(r.wartosc))}</b> (ceny detaliczne)</p>
    <label class="przelacznik"><input type="checkbox" data-pole="wszystkie" ${stan.wszystkie ? 'checked' : ''}> Pokaż wszystkie pozycje</label>
    <div class="inw-tabela-wrap"><table class="pz-tabela inw-tabela"><thead><tr><th>Produkt</th><th>System</th><th>Policzone</th><th>Różnica</th><th>Wartość</th></tr></thead><tbody>
      ${pokaz.map(x => `<tr class="${x.rozn < 0 ? 'inw-minus' : x.rozn > 0 ? 'inw-plus' : ''}"><td>${esc(x.n)} <small>${esc(x.s)}</small></td><td>${esc(liczbaNaTekst(n0(x.sys)))}</td>
        <td>${esc(liczbaNaTekst(n0(x.p)))}</td><td>${x.rozn > 0 ? '+' : ''}${esc(liczbaNaTekst(x.rozn))}</td><td>${x.rozn ? esc(kwotaTxt(x.wartosc)) : ''}</td></tr>`).join('')
        || '<tr><td colspan="5">Brak różnic – wszystko się zgadza ✓</td></tr>'}
      <tr class="inw-suma"><td colspan="3"><b>Razem różnice</b></td><td><b>${r.suma > 0 ? '+' : ''}${esc(liczbaNaTekst(r.suma))}</b></td><td><b>${esc(kwotaTxt(r.wartosc))}</b></td></tr>
    </tbody></table></div>
    ${z.uwagi ? `<p>Uwagi Grażynki: ${esc(z.uwagi)}</p>` : ''}
    <div class="przyciski mm-zapis">
      ${z.status === 'policzone' ? '<button type="button" data-akcja="zatwierdz-inw">✓ Zatwierdź</button>' : ''}
      <button type="button" class="drugorzedny" data-akcja="pdf">⬇︎ PDF – arkusz inwentaryzacji</button>
      ${r.nadwyzki.length ? `<button type="button" class="drugorzedny" data-akcja="epp-pw">⬇︎ EPP: PW – nadwyżki (${r.nadwyzki.length})</button>` : ''}
      ${r.braki.length ? `<button type="button" class="drugorzedny" data-akcja="epp-rw">⬇︎ EPP: RW – braki (${r.braki.length})</button>` : ''}
      ${z.status === 'policzone' ? '<button type="button" class="drugorzedny" data-akcja="ponownie-inw">↩︎ Poproś o ponowne liczenie</button>' : ''}
    </div>
    <p class="podpowiedz">Pliki EPP wczytaj w Subiekcie INCO (magazyn GR): Operacje → Odbierz z… → Plik EDI++ – najpierw PW, potem RW. PDF: w oknie drukowania wybierz „Zapisz jako PDF”.</p>
  </div>`;
}

function renderPelny() {
  const lista = dane.inwentaryzacje;
  $('#widok').innerHTML = `<section class="ekran ustawienia przesuniecia inw-darius">
    <h1>Inwentaryzacja</h1>
    <p class="podpowiedz">Grażynka liczy w zakładce „Liczenie” i wysyła tutaj. Zatwierdzasz, pobierasz arkusz PDF i pliki EPP (PW – nadwyżki, RW – braki).</p>
    ${lista.length ? `<ul class="pz-zgloszenia pelne">${lista.map(z => `<li class="panel${z.status === 'policzone' ? ' wyroznij' : ''}" data-id="${esc(z.id)}">
      <div class="wy-gora"><b>${esc(z.numer || '')} · magazyn ${esc(z.magazyn || MAG)} · ${esc(z.osoba || '')}</b><span class="pz-status s-${esc(z.status === 'zatwierdzone' ? 'zatwierdzone' : 'sprawdzone')}">${esc(ETYKIETY[z.status] || z.status)}</span></div>
      <p class="mm-info">liczenie od ${esc(String(z.data || '').slice(0, 16))}${z.sprawdzono ? ` · wysłane ${esc(z.sprawdzono)}` : ''}${z.zatwierdzono ? ` · zatwierdzone ${esc(z.zatwierdzono)}` : ''}</p>
      ${stan.otwarta === z.id ? htmlSzczegolow(z) : '<div class="przyciski"><button type="button" data-akcja="otworz-inw">Pokaż</button></div>'}
    </li>`).join('')}</ul>` : '<p class="pusto">Nie ma jeszcze żadnej inwentaryzacji.</p>'}
    <div class="przyciski"><a class="przycisk drugorzedny" href="#sklep">← Sklep</a></div>
  </section>`;
}

function pobierzPlik(nazwa, bajty) {
  const url = URL.createObjectURL(new Blob([bajty], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = nazwa; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function plikEpp(z, typ) {
  const r = wyliczenia(z);
  const lista = typ === 'PW' ? r.nadwyzki : r.braki;
  const data = String(z.data || dataLok()).slice(0, 10);
  const pozycje = lista.map(x => ({ symbol: x.s, nazwa: x.w.nazwa || x.n, typ: x.w.rodzaj || 'towar', jm: x.w.jm || 'szt.', ilosc: Math.abs(x.rozn), vat: 23, cenaCennik: x.cena, grupa: x.w.grupa || '' }));
  const nr = Number(String(z.numer || '').split('-').pop()) || 1;
  const tresc = trescEppMM({ ...FIRMA_INCO, magazyn: 'GR', magazynNazwa: 'Grazanka', magazynOpis: 'Grazanka' }, [{ typ, numer: nr, pelnyNumer: `${typ} ${z.numer}`, data,
    wystawca: ustawienia().kto || 'Stoisko', podtytul: 'Inwentaryzacja', uwagi: `Inwentaryzacja ${z.numer} (magazyn GR) - ${typ === 'PW' ? 'nadwyzki' : 'braki'}`, pozycje }]);
  pobierzPlik(`${typ}_GR_${z.numer}.epp`, naCp1250(tresc));
}

function arkuszPdf(z) {
  const r = wyliczenia(z);
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Arkusz inwentaryzacji ${esc(z.numer)}</title>
  <style>body{font:12px/1.35 Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:3px 5px;text-align:right}th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3){text-align:left}
  th{background:#eee}tr.r td{background:#f6f0e4;font-weight:bold}.podpisy{display:flex;gap:60px;margin-top:40px}.podpisy div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center}
  .druk{margin:10px 0;padding:8px 14px;font-size:14px}@media print{.druk{display:none}}</style></head><body>
  <button class="druk" onclick="print()">Drukuj / Zapisz jako PDF</button>
  <h1>Arkusz inwentaryzacji ${esc(z.numer)} – magazyn GR (Grażynka)</h1>
  <p>ONE RIVER – podmiot INCO · liczenie od: ${esc(String(z.data || '').slice(0, 16))} · zakończone: ${esc(z.sprawdzono || '')}${z.zatwierdzono ? ` · zatwierdzone: ${esc(z.zatwierdzono)}` : ''}</p>
  <p>Osoba licząca: ${esc(z.osoba || '')} · pozycji: ${r.poz.length} · różnic: ${r.rozne.length} · wartość różnic (ceny detaliczne brutto): ${esc(kwotaTxt(r.wartosc))}</p>
  ${z.uwagi ? `<p>Uwagi: ${esc(z.uwagi)}</p>` : ''}
  <table><thead><tr><th>Lp.</th><th>Symbol</th><th>Nazwa</th><th>J.m.</th><th>Stan systemowy</th><th>Policzono</th><th>Różnica</th><th>Cena</th><th>Wartość różnicy</th></tr></thead><tbody>
  ${r.poz.map((x, i) => `<tr class="${x.rozn ? 'r' : ''}"><td>${i + 1}</td><td>${esc(x.s)}</td><td>${esc(x.n)}</td><td>${esc(x.w.jm || 'szt.')}</td><td>${esc(liczbaNaTekst(n0(x.sys)))}</td>
    <td>${esc(liczbaNaTekst(n0(x.p)))}</td><td>${x.rozn > 0 ? '+' : ''}${esc(liczbaNaTekst(x.rozn))}</td><td>${esc(kwotaTxt(x.cena))}</td><td>${x.rozn ? esc(kwotaTxt(x.wartosc)) : ''}</td></tr>`).join('')}
  <tr><td colspan="6"><b>Razem</b></td><td><b>${r.suma > 0 ? '+' : ''}${esc(liczbaNaTekst(r.suma))}</b></td><td></td><td><b>${esc(kwotaTxt(r.wartosc))}</b></td></tr>
  </tbody></table>
  <div class="podpisy"><div>Osoba licząca</div><div>Zatwierdził</div></div>
  <script>setTimeout(function(){print()},400)<\/script></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const okno2 = window.open(url, '_blank');
  if (!okno2) { const a = document.createElement('a'); a.href = url; a.download = `Arkusz_${z.numer}.html`; document.body.append(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

async function zapisz(w) {
  await sync.zapisz([{ karta: 'ZAPOTRZEBOWANIA', wiersze: [w] }]);
  const { wczytaj } = await import('./dane.js');
  await wczytaj();
}

async function klikPelny(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const z = dane.inwentaryzacje.find(x => x.id === b.closest('[data-id]')?.dataset.id);
  if (!z) return;
  const a = b.dataset.akcja;
  try {
    if (a === 'otworz-inw') { stan.otwarta = z.id; bezSkoku(renderPelny); }
    else if (a === 'pdf') arkuszPdf(z);
    else if (a === 'epp-pw') plikEpp(z, 'PW');
    else if (a === 'epp-rw') plikEpp(z, 'RW');
    else if (a === 'zatwierdz-inw') { await zapisz({ ...z, status: 'zatwierdzone', zatwierdzono: teraz() }); toast('Zatwierdzone. Pobierz pliki EPP i wczytaj w Subiekcie.', 'ok', 6000); bezSkoku(renderPelny); }
    else if (a === 'ponownie-inw') {
      const tak = await okno('Poprosić o ponowne liczenie?', `<p>Grażynka zobaczy prośbę w zakładce „Liczenie” z dotychczasowymi wynikami.</p>
        <label class="pole szeroka"><span class="etykieta">Co sprawdzić? (nie trzeba)</span><input id="inw-prosba" maxlength="200" placeholder="np. policz jeszcze raz Rapé 24 g"></label>`,
        [{ etykieta: 'Anuluj', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Poproś', wartosc: true }]);
      if (!tak) return;
      await zapisz({ ...z, status: 'ponownie', odpowiedz: $('#inw-prosba')?.value || '' });
      toast('Wysłane do Grażynki.', 'ok');
      bezSkoku(renderPelny);
    }
  } catch (err) { toast(err.message, 'blad', 8000); }
}

function wejsciePelne(e) {
  if (e.target.dataset.pole === 'wszystkie') { stan.wszystkie = e.target.checked; bezSkoku(renderPelny); }
}

export const ekran = {
  render: () => (trybProsty() ? renderProsty() : renderPelny()),
  klik: e => (trybProsty() ? klikProsty(e) : klikPelny(e)),
  wejscie: e => (trybProsty() ? wejscieProste(e) : wejsciePelne(e)),
  zmiana: e => (trybProsty() ? zmianaProsta(e) : wejsciePelne(e)),
};
