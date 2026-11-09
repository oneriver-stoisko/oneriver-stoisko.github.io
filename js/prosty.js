// Prosty ekran sprzedaży (tryb Grażynki): sprzedaż na miejscu krok po kroku – produkty ze zdjęciami,
// sprawdzenie koszyka, płatność (gotówka, BLIK albo podzielona: część gotówką, reszta BLIK-iem), klient i SMS.
// Duże przyciski, jasne komunikaty. Przy gramaturach widać stan magazynu GR (u Grażynki).

import { $, esc, kwotaTxt, liczba, liczbaNaTekst, uuid, toast, okno, normalizuj, bezSkoku } from './util.js';
import { dane, zamowienie, pozycjeZamowienia, telefonE164 } from './dane.js';
import { ustawienia } from './api.js';
import { trescWiadomosci, linkSms, otworzLink } from './wiadomosc.js';
import { zapiszProste } from './nowe.js';

// Kategorie widoczne w trybie prostym (w Subiekcie: RAPE, akcesoria, PŁYNY I ZIELARNIA)
export const KATEGORIE = [['Rapé', 'Rapé'], ['Akcesoria do rapé', 'Akcesoria'], ['Zielarnia i olejki', 'Płyny i zielarnia']];
const FORMY = [['Gotówka', '💵 Gotówka'], ['BLIK', '📱 BLIK na telefon'], ['Podzielona', '💵+📱 Część gotówką, reszta BLIK']];
/** Stan u Grażynki (magazyn GR); gdy katalog nie ma jeszcze stanów per magazyn – null. */
export const stanU = w => (w.stanGr === undefined ? null : w.stanGr);
const KROKI = ['produkty', 'koszyk', 'platnosc', 'klient'];
const TYTULY = { produkty: 'Wybierz produkty', koszyk: 'Sprawdź ilości i ceny', platnosc: 'Jak klient płaci?', klient: 'Telefon klienta' };

const KLUCZ = 'or-stoisko-prosty-szkic';
const nowy = () => ({ krok: 'produkty', kategoria: KATEGORIE[0][0], szukaj: '', koszyk: [], forma: '', gotowkaTxt: '', zaplacone: false, telefon: '', nazwa: '', otwarty: '', numer: '', blad: '' });
let p = (() => { try { return { ...nowy(), ...JSON.parse(localStorage.getItem(KLUCZ) || '{}'), blad: '' }; } catch { return nowy(); } })();
const zachowaj = () => { try { localStorage.setItem(KLUCZ, JSON.stringify({ ...p, blad: '' })); } catch { /* bez znaczenia */ } };

const cenaPoz = x => { const c = liczba(x.cenaTxt); return isFinite(c) ? c : Number(x.cena_cennik) || 0; };
const iloscPoz = x => { const n = liczba(x.iloscTxt); return isFinite(n) && n > 0 ? n : 0; };
const razem = () => Math.round(p.koszyk.reduce((s, x) => s + cenaPoz(x) * iloscPoz(x), 0) * 100) / 100;
const ileSztuk = () => p.koszyk.reduce((s, x) => s + iloscPoz(x), 0);
const gotowka = () => { const g = liczba(p.gotowkaTxt); return isFinite(g) ? Math.round(g * 100) / 100 : NaN; };
const resztaBlik = () => Math.round((razem() - (gotowka() || 0)) * 100) / 100;

function produktyKategorii() {
  const slowa = normalizuj(p.szukaj).split(/\s+/).filter(Boolean);
  return dane.produkty.filter(pr => KATEGORIE.some(([k]) => k === pr.kategoria)
    && (slowa.length ? slowa.every(s => pr.szukaj.includes(s)) : pr.kategoria === p.kategoria))
    .slice(0, 80);
}

function wKoszyku(symbol) { return p.koszyk.find(x => x.symbol === symbol); }

// ───────────────────────── widoki kroków ─────────────────────────

function htmlKrokow() {
  const i = KROKI.indexOf(p.krok);
  return `<ol class="pr-kroki">${KROKI.map((k, j) => `<li class="${j < i ? 'zrobiony' : j === i ? 'teraz' : ''}">${j + 1}</li>`).join('')}</ol>
    <h1 class="pr-tytul">Krok ${i + 1} z ${KROKI.length}: ${esc(TYTULY[p.krok])}</h1>`;
}

/** Gramatura / rozmiar: dotknięcie dodaje 1 szt.; gdy jest w koszyku – obok „−”, żeby odjąć albo odznaczyć. */
function htmlWariantu(w) {
  const x = wKoszyku(w.symbol);
  const ile = x ? iloscPoz(x) : 0;
  const st = stanU(w);
  const brak = st !== null ? st <= 0 : (w.stan !== null && w.stan <= 0);
  return `<div class="pr-wariant${ile ? ' wybrany' : ''}"${brak ? ' data-brak="1"' : ''}>
    <button type="button" class="pr-w-dodaj" data-akcja="dodaj" data-v="${esc(w.symbol)}">
      <b>${esc(w.wariant || 'Dodaj')}</b><span>${esc(kwotaTxt(w.cena))}</span>
      <small class="pr-w-stan">${st !== null ? (st > 0 ? `masz: ${esc(liczbaNaTekst(st))} szt.` : 'u Ciebie: brak') : (brak ? 'brak na stanie' : '')}</small>
    </button>
    ${ile ? `<div class="pr-w-ile">
      <button type="button" class="pr-w-minus" data-akcja="odejmij" data-v="${esc(w.symbol)}" aria-label="Odejmij jedną sztukę">${ile === 1 ? '✕' : '−'}</button>
      <span>w koszyku: <b>${esc(liczbaNaTekst(ile))}</b></span>
    </div>` : ''}
  </div>`;
}

export function htmlFiltrow(stan) {
  return `<div class="pr-przyklejone">
    <div class="pr-kategorie">${KATEGORIE.map(([k, e]) => `<button type="button" class="pr-kat" data-akcja="kategoria" data-v="${esc(k)}" aria-pressed="${!stan.szukaj && stan.kategoria === k}">${esc(e)}</button>`).join('')}</div>
    <label class="pr-szukaj"><span class="sr">Szukaj</span><input type="search" data-pole="szukaj" value="${esc(stan.szukaj)}" placeholder="🔍 Szukaj po nazwie" autocomplete="off"></label>
  </div>`;
}

function htmlProdukty() {
  const lista = produktyKategorii();
  return `
    ${htmlFiltrow(p)}
    <ul class="pr-produkty">${lista.map(pr => {
      const ile = pr.warianty.reduce((s, w) => s + (wKoszyku(w.symbol) ? iloscPoz(wKoszyku(w.symbol)) : 0), 0);
      const otwarty = p.otwarty === pr.klucz;
      return `<li class="pr-produkt${otwarty ? ' otwarty' : ''}">
        <button type="button" class="pr-kafel" data-akcja="otworz" data-v="${esc(pr.klucz)}">
          ${pr.zdjecie ? `<img src="${esc(pr.zdjecie)}" alt="" loading="lazy">` : '<span class="pr-bez-zdj">brak zdjęcia</span>'}
          <span class="pr-nazwa">${esc(pr.produkt)}</span>
          ${ile ? `<span class="pr-ile">w koszyku: ${esc(liczbaNaTekst(ile))}</span>` : ''}
        </button>
        ${otwarty ? `<div class="pr-warianty">${pr.warianty.map(htmlWariantu).join('')}</div>` : ''}
      </li>`;
    }).join('') || '<li class="pr-pusto">Nic nie znaleziono. Spróbuj inaczej wpisać nazwę.</li>'}</ul>`;
}

function htmlKoszyk() {
  if (!p.koszyk.length) return '<p class="pr-info">Koszyk jest pusty. Wróć i wybierz produkty.</p>';
  return `<ul class="pr-koszyk">${p.koszyk.map(x => `<li data-k="${esc(x.k)}">
      <div class="pr-k-nazwa">${esc(x.nazwa)}</div>
      <div class="pr-k-ilosc">
        <button type="button" class="pr-okragly" data-akcja="minus" aria-label="Mniej">−</button>
        <span class="pr-liczba">${esc(liczbaNaTekst(iloscPoz(x)))}</span>
        <button type="button" class="pr-okragly" data-akcja="plus" aria-label="Więcej">+</button>
      </div>
      <label class="pr-k-cena"><span>Cena za sztukę (zł)</span>
        <input data-pole="cena" inputmode="decimal" value="${esc(x.cenaTxt)}" autocomplete="off"></label>
      <button type="button" class="pr-usun" data-akcja="usun">Usuń z koszyka</button>
    </li>`).join('')}</ul>
    <p class="pr-razem">Razem: <b>${esc(kwotaTxt(razem()))}</b></p>`;
}

function htmlPlatnosc() {
  const { platnosc } = ustawienia();
  const g = gotowka();
  return `<div class="pr-formy">${FORMY.map(([f, e]) => `<button type="button" class="pr-forma${f === 'Podzielona' ? ' pr-forma-mala' : ''}" data-akcja="forma" data-v="${esc(f)}" aria-pressed="${p.forma === f}">${esc(e)}</button>`).join('')}</div>
    ${p.forma === 'Podzielona' ? `<div class="pr-blik">
        <label class="pr-pole"><span>Ile klient daje gotówką? (zł)</span>
          <input data-pole="gotowka" inputmode="decimal" value="${esc(p.gotowkaTxt)}" placeholder="np. 50" autocomplete="off"></label>
        <p class="pr-reszta">Reszta BLIK-iem: <b id="pr-reszta">${esc(isFinite(g) && g > 0 && g < razem() ? kwotaTxt(resztaBlik()) : '—')}</b></p>
      </div>` : ''}
    ${p.forma === 'BLIK' || p.forma === 'Podzielona' ? `<div class="pr-blik">
        <p>Klient wysyła BLIK na numer:<br><b class="pr-duzy">${esc(platnosc.blik || '')}</b><br>Kwota: <b id="pr-kwota-blik">${esc(kwotaTxt(p.forma === 'Podzielona' ? (isFinite(g) && g > 0 && g < razem() ? resztaBlik() : 0) : razem()))}</b></p>
        <label class="pr-przelacznik"><input type="checkbox" data-pole="zaplacone" ${p.zaplacone ? 'checked' : ''}> Klient pokazał, że zapłacił</label>
        <p class="pr-podp">Jeśli klient zapłaci później – zostaw puste. Dane do płatności pójdą w SMS-ie.</p>
      </div>` : ''}
    <p class="pr-razem">Do zapłaty: <b>${esc(kwotaTxt(razem()))}</b></p>`;
}

function htmlKlient() {
  return `<label class="pr-pole"><span>Telefon klienta</span>
      <input type="tel" data-pole="telefon" inputmode="tel" value="${esc(p.telefon)}" placeholder="np. 600 100 200" autocomplete="off"></label>
    <label class="pr-pole"><span>Imię i nazwisko (nie trzeba)</span>
      <input data-pole="nazwa" value="${esc(p.nazwa)}" autocomplete="off"></label>
    <p class="pr-razem">Razem: <b>${esc(kwotaTxt(razem()))}</b> · ${esc(p.forma === 'BLIK' ? 'BLIK' : p.forma === 'Podzielona' ? `gotówka ${kwotaTxt(gotowka())} + BLIK ${kwotaTxt(resztaBlik())}` : 'gotówka')}</p>
    <button type="button" class="pr-glowny" data-akcja="zapisz" data-v="sms">✓ Zapisz i wyślij SMS</button>
    <button type="button" class="pr-drugi" data-akcja="zapisz" data-v="">Zapisz bez SMS-a</button>`;
}

function htmlGotowe() {
  const z = zamowienie(p.numer);
  return `<section class="ekran prosty-ekran">
    <div class="pr-gotowe">
      <div class="pr-ok">✓</div>
      <h1>Zapisano!</h1>
      <p>Zamówienie <b class="pr-duzy">${esc(p.numer)}</b></p>
      ${z ? `<p>Razem: <b>${esc(kwotaTxt(Number(z.suma_brutto) || 0))}</b></p>` : ''}
      ${z && telefonE164((dane.klienci.find(k => String(k.id) === String(z.klient_id)) || {}).telefon) ? '<button type="button" class="pr-drugi" data-akcja="sms-ponownie">Wyślij SMS jeszcze raz</button>' : ''}
      <button type="button" class="pr-glowny" data-akcja="nowa">+ Nowa sprzedaż</button>
    </div>
  </section>`;
}

function render() {
  if (p.numer) { $('#widok').innerHTML = htmlGotowe(); return; }
  const tresc = { produkty: htmlProdukty, koszyk: htmlKoszyk, platnosc: htmlPlatnosc, klient: htmlKlient }[p.krok]();
  const i = KROKI.indexOf(p.krok);
  const dalej = p.krok === 'klient' ? '' : `<button type="button" class="pr-dalej" data-akcja="dalej">${p.krok === 'produkty' ? `Dalej → (${esc(liczbaNaTekst(ileSztuk()))} szt. · ${esc(kwotaTxt(razem()))})` : 'Dalej →'}</button>`;
  $('#widok').innerHTML = `<section class="ekran prosty-ekran">
    ${htmlKrokow()}
    <div class="pr-blad" id="pr-blad" role="alert" ${p.blad ? '' : 'hidden'}>${esc(p.blad)}</div>
    <div id="pr-tresc">${tresc}</div>
    <div class="pr-dol">
      ${i > 0 ? '<button type="button" class="pr-wstecz" data-akcja="wstecz">← Wstecz</button>' : (p.koszyk.length ? '<button type="button" class="pr-wstecz" data-akcja="od-nowa">Wyczyść</button>' : '<span></span>')}
      ${dalej}
    </div>
  </section>`;
}

function blad(tekst) {
  p.blad = tekst;
  const el = $('#pr-blad');
  if (el) { el.textContent = tekst; el.hidden = !tekst; if (tekst) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

function sprawdzKrok() {
  if (p.krok === 'produkty' && !p.koszyk.length) return 'Najpierw wybierz produkt: dotknij zdjęcia, a potem gramatury lub rozmiaru.';
  if (p.krok === 'koszyk') {
    for (const x of p.koszyk) {
      if (!(iloscPoz(x) > 0)) return `Sprawdź ilość: ${x.nazwa}.`;
      const c = liczba(x.cenaTxt);
      if (!isFinite(c) || c < 0) return `Cena „${x.nazwa}” jest nieprawidłowa – wpisz liczbę, np. 70 albo 70,50.`;
    }
  }
  if (p.krok === 'platnosc' && !p.forma) return 'Wybierz, jak klient płaci: Gotówka, BLIK albo część gotówką i reszta BLIK-iem.';
  if (p.krok === 'platnosc' && p.forma === 'Podzielona') {
    const g = gotowka();
    if (!String(p.gotowkaTxt).trim()) return 'Wpisz, ile klient daje gotówką – resztę zapłaci BLIK-iem.';
    if (!isFinite(g) || g <= 0) return 'Kwota gotówki jest nieprawidłowa – wpisz liczbę, np. 50 albo 50,50.';
    if (g >= razem()) return `Gotówka (${kwotaTxt(g)}) musi być mniejsza niż razem (${kwotaTxt(razem())}). Jeśli klient płaci całość gotówką – wybierz „Gotówka”.`;
  }
  return '';
}

// ───────────────────────── zapis ─────────────────────────

async function zapisz(kanal, przycisk) {
  const tel = telefonE164(p.telefon);
  if (kanal && !p.telefon.trim()) return blad('Wpisz telefon klienta – bez niego nie wyślemy SMS-a. Możesz też dotknąć „Zapisz bez SMS-a”.');
  if (p.telefon.trim() && !tel) return blad('Numer telefonu wygląda na błędny. Wpisz 9 cyfr, np. 600 100 200 (zagraniczny z kierunkowym, np. +44…).');
  blad('');
  przycisk.disabled = true;
  przycisk.textContent = 'Zapisuję…';
  try {
    const koszyk = p.koszyk.map(({ symbol, nazwa, grupa, jm, cena_cennik, iloscTxt, cenaTxt }) => ({ symbol, nazwa, grupa, jm, cena_cennik, iloscTxt, cenaTxt }));
    const platnosci = p.forma === 'Podzielona'
      ? [{ forma: 'Gotówka', kwotaTxt: liczbaNaTekst(gotowka()), zaplacone: true }, { forma: 'BLIK', kwotaTxt: '', zaplacone: p.zaplacone }]
      : [{ forma: p.forma, kwotaTxt: '', zaplacone: p.forma === 'Gotówka' || p.zaplacone }];
    const numer = await zapiszProste({ koszyk, platnosci, telefon: p.telefon, nazwa: p.nazwa, magazyn: 'GR' });
    p = { ...nowy(), numer };
    zachowaj();
    if (kanal) wyslijSms(numer);
    render();
  } catch (err) {
    console.error(err);
    blad('Nie udało się zapisać: ' + (err?.message || err) + '. Nic nie zginęło – spróbuj jeszcze raz za chwilę. Jeśli się powtarza, zrób zrzut ekranu i wyślij Dariusowi.');
    przycisk.disabled = false;
    przycisk.textContent = kanal ? '✓ Zapisz i wyślij SMS' : 'Zapisz bez SMS-a';
  }
}

function wyslijSms(numer) {
  const z = zamowienie(numer);
  const k = z && dane.klienci.find(x => String(x.id) === String(z.klient_id));
  if (!z || !k?.telefon) { toast('Brak telefonu klienta – SMS nie został otwarty.', 'blad', 6000); return; }
  otworzLink(linkSms(k.telefon, trescWiadomosci(z, pozycjeZamowienia(numer))));
}

// ───────────────────────── zdarzenia ─────────────────────────

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'kategoria') { p.kategoria = v; p.szukaj = ''; p.otwarty = ''; }
  else if (akcja === 'otworz') p.otwarty = p.otwarty === v ? '' : v;
  else if (akcja === 'dodaj') {
    const w = dane.cennik.find(c => c.symbol === v);
    if (!w) return;
    const jest = wKoszyku(v);
    if (jest) jest.iloscTxt = liczbaNaTekst(iloscPoz(jest) + 1);
    else p.koszyk.push({ k: uuid(), symbol: w.symbol, nazwa: w.nazwa, grupa: w.kategoria, jm: w.jm || 'szt.', cena_cennik: w.cena, iloscTxt: '1', cenaTxt: liczbaNaTekst(w.cena) });
    toast(`Dodano: ${w.nazwa}`, 'ok', 1800);
    blad('');
  } else if (akcja === 'odejmij') {
    const x = wKoszyku(v);
    if (!x) return;
    const n = iloscPoz(x) - 1;
    if (n <= 0) { p.koszyk = p.koszyk.filter(y => y !== x); toast(`Usunięto z koszyka: ${x.nazwa}`, '', 1800); }
    else x.iloscTxt = liczbaNaTekst(n);
  } else if (akcja === 'plus' || akcja === 'minus' || akcja === 'usun') {
    const x = p.koszyk.find(y => y.k === b.closest('[data-k]').dataset.k);
    if (!x) return;
    if (akcja === 'usun') p.koszyk = p.koszyk.filter(y => y !== x);
    else {
      const n = iloscPoz(x) + (akcja === 'plus' ? 1 : -1);
      if (n <= 0) p.koszyk = p.koszyk.filter(y => y !== x);
      else x.iloscTxt = liczbaNaTekst(n);
    }
  } else if (akcja === 'forma') { p.forma = v; p.zaplacone = false; if (v !== 'Podzielona') p.gotowkaTxt = ''; blad(''); }
  else if (akcja === 'dalej') {
    const bl = sprawdzKrok();
    if (bl) { blad(bl); return; }
    p.blad = '';
    p.krok = KROKI[KROKI.indexOf(p.krok) + 1];
    window.scrollTo(0, 0);
  } else if (akcja === 'wstecz') { p.blad = ''; p.krok = KROKI[Math.max(0, KROKI.indexOf(p.krok) - 1)]; window.scrollTo(0, 0); }
  else if (akcja === 'od-nowa') {
    const tak = await okno('Wyczyścić koszyk?', '<p>Wybrane produkty zostaną usunięte.</p>', [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Tak, wyczyść', wartosc: true }]);
    if (!tak) return;
    p = nowy();
  } else if (akcja === 'zapisz') { await zapisz(v, b); return; }
  else if (akcja === 'nowa') { p = nowy(); window.scrollTo(0, 0); }
  else if (akcja === 'sms-ponownie') { wyslijSms(p.numer); return; }
  else return;
  zachowaj();
  bezSkoku(render);
}

function wejscie(e) {
  const pole = e.target.dataset.pole;
  if (!pole) return;
  if (pole === 'szukaj') { p.szukaj = e.target.value; p.otwarty = ''; $('.pr-produkty').outerHTML = htmlProdukty().match(/<ul class="pr-produkty">[\s\S]*<\/ul>/)[0];
    document.querySelectorAll('.pr-kat').forEach(k => k.setAttribute('aria-pressed', String(!p.szukaj && k.dataset.v === p.kategoria))); }
  else if (pole === 'cena') { const x = p.koszyk.find(y => y.k === e.target.closest('[data-k]').dataset.k); if (x) x.cenaTxt = e.target.value; const r = $('.pr-razem b'); if (r) r.textContent = kwotaTxt(razem()); }
  else if (pole === 'gotowka') {
    p.gotowkaTxt = e.target.value;
    const g = gotowka(); const ok = isFinite(g) && g > 0 && g < razem();
    const r = $('#pr-reszta'); if (r) r.textContent = ok ? kwotaTxt(resztaBlik()) : '—';
    const kb = $('#pr-kwota-blik'); if (kb) kb.textContent = kwotaTxt(ok ? resztaBlik() : 0);
    if (ok && p.blad) blad('');
  }
  else if (pole === 'telefon' || pole === 'nazwa') p[pole] = e.target.value;
  else if (pole === 'zaplacone') p.zaplacone = e.target.checked;
  zachowaj();
}

export const ekran = { render, klik, wejscie, zmiana: wejscie };
