// Formularz zamówień ONE RIVER dla klientów – krok po kroku (jak sprzedaż u Grażynki):
// 1) produkty ze zdjęciami i ilościami, 2) koszyk, 3) kraj i dostawa z cennikiem (paczkomat z mapy), 4) dane i wysłanie.
// Pięć języków (PL, EN, ES, FR, DE), ceny w PLN albo EUR (kurs NBP, pełne euro – tak samo liczy skrypt).
// Oferta, ceny i cennik dostaw przychodzą ze skryptu arkusza (akcja „sklep”); zamówienie wysyła akcja „zamow”.
// Link z #kod=… pokazuje ceny klienta i wpisuje jego dane; #lang=en|es|fr|de ustawia język.

import { T, JEZYKI, KATEGORIE, KRAJE } from './teksty.js';

const API = 'https://script.google.com/macros/s/AKfycbwFcvYtbGMBPlJCT_QDzXfnFvnnEQQt1EqFrjnhEKgeg7lo22JuRwFxOK5-vZGcVwg9CQ/exec';
const KOLEJNOSC = ['Rapé', 'Akcesoria do rapé', 'Zielarnia i olejki', 'Biżuteria', 'Odzież', 'Wystrój wnętrz i inne', 'Instrumenty etniczne'];
const KROKI = ['produkty', 'koszyk', 'dostawa', 'dane'];
const PAMIEC = 'or-zamow-2';
const NA_STRONE = 30;
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zaokr = n => Math.round(n * 100) / 100;
const norm = v => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

// ───────────────────────── stan ─────────────────────────

const s = {
  oferta: null, produkty: [], krok: 'produkty', kategoria: '', szukaj: '', otwarty: '', ile: NA_STRONE,
  koszyk: {},                      // symbol → ilość
  kod: '', dostawa: '', adres: '', punkt: null, forma: 'Przelew', kraj: '', krajNazwa: '',
  jezyk: '', waluta: '',
  dane: { nazwa: '', telefon: '', email: '', uwagi: '' },
  wyslane: null, wysylam: false,
};

const t = (k, w = {}) => String((T[s.jezyk] || T.pl)[k] ?? T.pl[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => w[x] ?? '');
const sztuk = n => (T[s.jezyk] || T.pl).szt(n);
const nazwaKategorii = k => (s.jezyk === 'pl' ? k : KATEGORIE[k]?.[s.jezyk] || k);
const nazwaKraju = kod => { try { return new Intl.DisplayNames([s.jezyk], { type: 'region' }).of(kod); } catch { return kod; } };
const lokal = () => ({ pl: 'pl-PL', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' }[s.jezyk] || 'pl-PL');

// ───────────────────────── waluta ─────────────────────────

const kurs = () => Number(s.oferta?.kurs_eur) || 0;
const eur = () => s.waluta === 'EUR' && kurs() > 0;
/** Cena sztuki w walucie klienta (EUR – pełne euro, jak w skrypcie). */
const wWalucie = pln => (eur() ? Math.max(1, Math.round(pln / kurs())) : pln);
function kwota(n) {
  if (eur()) return new Intl.NumberFormat(lokal(), { style: 'currency', currency: 'EUR', minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  return new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' zł';
}

function wczytajPamiec() {
  try {
    const p = JSON.parse(localStorage.getItem(PAMIEC)) || {};
    ['koszyk', 'kod', 'dostawa', 'adres', 'punkt', 'forma', 'kraj', 'krajNazwa', 'jezyk', 'waluta'].forEach(k => { if (p[k] !== undefined && p[k] !== null) s[k] = p[k]; });
    s.dane = { ...s.dane, ...(p.dane || {}) };
  } catch { /* pusto */ }
}
function zachowaj() {
  const { koszyk, kod, dostawa, adres, punkt, forma, kraj, krajNazwa, jezyk, waluta, dane } = s;
  try { localStorage.setItem(PAMIEC, JSON.stringify({ koszyk, kod, dostawa, adres, punkt, forma, kraj, krajNazwa, jezyk, waluta, dane })); } catch { /* bez znaczenia */ }
}

// ───────────────────────── API ─────────────────────────

async function api(akcja, dane = {}) {
  let odp;
  try {
    odp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...dane, akcja }) });
  } catch {
    throw new Error(t('brakSieci'));
  }
  let j;
  try { j = await odp.json(); } catch { throw new Error(t('serwer')); }
  if (!j.ok) throw new Error(j.blad || 'Error');
  return j.dane;
}

async function wczytajOferte() {
  const o = await api('sklep', s.kod ? { kod: s.kod } : {});
  if (s.kod && !o.klient) {
    toast(t('nieZnamyKodu'), 'blad', 6000);
    s.kod = '';
  }
  s.oferta = o;
  const ceny = o.ceny || {};
  const mapa = new Map();
  o.produkty.forEach(p => {
    const klucz = p.w ? `${p.k}|${p.p}` : `${p.k}|${p.p}|${p.s}`;
    const g = mapa.get(klucz) || { klucz, nazwa: p.p, kategoria: p.k, zdjecie: '', warianty: [] };
    g.warianty.push({ s: p.s, w: p.w, c: p.c, cena: ceny[p.s] !== undefined ? ceny[p.s] : p.c, nazwa: p.n, q: p.q ?? null });
    if (!g.zdjecie && p.z) g.zdjecie = p.z;
    mapa.set(klucz, g);
  });
  const waga = w => { const n = parseFloat(String(w).replace(',', '.')); if (isFinite(n)) return n; const r = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].indexOf(w); return r >= 0 ? 1000 + r : 2000; };
  s.produkty = [...mapa.values()].map(g => {
    g.warianty.sort((a, b) => waga(a.w) - waga(b.w));
    g.szukaj = norm(g.nazwa + ' ' + g.kategoria + ' ' + nazwaKategorii(g.kategoria) + ' ' + g.warianty.map(w => w.nazwa + ' ' + w.w).join(' '));
    return g;
  }).sort((a, b) => (KOLEJNOSC.indexOf(a.kategoria) + 1 || 99) - (KOLEJNOSC.indexOf(b.kategoria) + 1 || 99)
    || (b.zdjecie ? 1 : 0) - (a.zdjecie ? 1 : 0) || a.nazwa.localeCompare(b.nazwa, 'pl'));
  let zmiana = false;
  Object.keys(s.koszyk).forEach(sym => {
    const x = wariant(sym);
    if (!x || !dostepny(x.w)) { delete s.koszyk[sym]; zmiana = true; }
    else if (x.w.q !== null && s.koszyk[sym] > x.w.q) { s.koszyk[sym] = x.w.q; zmiana = true; }
  });
  if (zmiana) toast(t('niedostepneJuz'), '', 5000);
  if (s.dostawa && !o.wysylki.some(w => w.id === s.dostawa)) s.dostawa = '';
  if (!kurs() && s.waluta === 'EUR') s.waluta = 'PLN';
  if (o.klient) {
    if (!s.dane.nazwa) s.dane.nazwa = o.klient.nazwa || '';
    if (!s.dane.telefon) s.dane.telefon = o.klient.telefon || '';
    if (!s.dane.email) s.dane.email = o.klient.email || '';
    if (!s.adres && o.klient.adres) s.adres = o.klient.adres;
  }
  if (!s.kategoria || !s.produkty.some(g => g.kategoria === s.kategoria)) s.kategoria = kategorie()[0] || '';
  zachowaj();
}

// ───────────────────────── obliczenia ─────────────────────────

const dostepny = w => w.q === null || w.q > 0;
function wariant(sym) {
  for (const g of s.produkty) { const w = g.warianty.find(x => x.s === sym); if (w) return { g, w }; }
  return null;
}
const pozycje = () => Object.entries(s.koszyk).map(([sym, ilosc]) => ({ ilosc, ...wariant(sym) })).filter(p => p.w && p.ilosc > 0);
const ileSztuk = () => pozycje().reduce((a, p) => a + p.ilosc, 0);
const sumaPln = () => zaokr(pozycje().reduce((a, p) => a + p.w.cena * p.ilosc, 0));
const sumaProduktow = () => (eur() ? pozycje().reduce((a, p) => a + wWalucie(p.w.cena) * p.ilosc, 0) : sumaPln());
const zagranica = () => Boolean(s.kraj) && s.kraj !== 'PL';
const metody = () => (s.oferta?.wysylki || []).filter(w => (w.zasieg || 'pl') === 'wszedzie' || ((w.zasieg || 'pl') === 'zagranica') === zagranica());
const dostawa = () => metody().find(w => w.id === s.dostawa);
const gratisDla = w => w.darmowa_od !== null && w.darmowa_od !== undefined && sumaPln() >= w.darmowa_od;
/** Koszt dostawy w walucie klienta; null = do ustalenia. */
function kosztWysylki(w) {
  if (!w) return 0;
  if (w.do_ustalenia) return null;
  if (gratisDla(w) || !w.cena) return 0;
  return eur() ? (w.cena_eur !== null && w.cena_eur !== undefined ? w.cena_eur : wWalucie(w.cena)) : w.cena;
}
const razem = () => zaokr(sumaProduktow() + (kosztWysylki(dostawa()) || 0));
function kategorie() {
  const kat = new Set(s.produkty.map(p => p.kategoria));
  return [...KOLEJNOSC.filter(k => kat.has(k)), ...[...kat].filter(k => !KOLEJNOSC.includes(k))];
}
const czyPaczkomat = w => !zagranica() && /paczkomat/i.test(w?.nazwa || '');
const czyPunktZagranica = w => zagranica() && /inpost|paczkomat|punkt|locker|point/i.test(w?.nazwa || '');

// ───────────────────────── widoki ─────────────────────────

const zdjecie = (g, klasa = 'zdj') => g.zdjecie
  ? `<img class="${klasa}" src="${esc(g.zdjecie)}" alt="" loading="lazy">`
  : `<span class="${klasa} zastepcze" aria-hidden="true">${esc(g.nazwa.replace(/^rap[eé]\s+/i, '').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase())}</span>`;

function htmlKrokow() {
  const i = KROKI.indexOf(s.krok);
  const nazwy = { produkty: t('krokProdukty'), koszyk: t('krokKoszyk'), dostawa: t('krokDostawa'), dane: t('krokDane') };
  return `<ol class="kroki" aria-label="${esc(t('tytul'))}">${KROKI.map((k, j) =>
    `<li class="${j < i ? 'zrobiony' : j === i ? 'biezacy' : ''}" ${j === i ? 'aria-current="step"' : ''}><span>${j < i ? '✓' : j + 1}</span>${esc(nazwy[k])}</li>`).join('')}</ol>`;
}

function htmlLicznika(w) {
  const n = s.koszyk[w.s] || 0;
  if (!dostepny(w)) return `<span class="niedostepny">${esc(t('brak'))}</span>`;
  if (!n) return `<button type="button" class="dodaj" data-akcja="plus" data-s="${esc(w.s)}">${esc(t('dodaj'))}</button>`;
  const max = w.q !== null && n >= w.q;
  return `<span class="licznik" role="group" aria-label="${esc(t('ilosc'))}">
    <button type="button" data-akcja="minus" data-s="${esc(w.s)}" aria-label="${esc(t('mniej'))}">−</button>
    <input type="number" inputmode="numeric" min="0" ${w.q !== null ? `max="${w.q}"` : ''} value="${n}" data-pole="ilosc" data-s="${esc(w.s)}" aria-label="${esc(t('ilosc'))}">
    <button type="button" data-akcja="plus" data-s="${esc(w.s)}" aria-label="${esc(t('wiecej'))}" ${max ? 'disabled' : ''}>+</button></span>`;
}

function htmlProduktu(g) {
  const otwarty = s.otwarty === g.klucz;
  const ceny = g.warianty.map(w => wWalucie(w.cena));
  const min = Math.min(...ceny), max = Math.max(...ceny);
  const wKoszyku = g.warianty.reduce((a, w) => a + (s.koszyk[w.s] || 0), 0);
  const jeden = g.warianty.length === 1;
  const nic = !g.warianty.some(dostepny);
  return `<li class="produkt${otwarty ? ' otwarty' : ''}${nic ? ' brak' : ''}" data-klucz="${esc(g.klucz)}">
    <button type="button" class="glowa" data-akcja="otworz" aria-expanded="${otwarty}">
      ${zdjecie(g)}
      <span class="opis"><b>${esc(g.nazwa)}</b>
        <span class="cena">${min === max ? esc(kwota(min)) : esc(t('od', { k: kwota(min) }))}${jeden ? '' : ` · ${esc(t('wariantow', { n: g.warianty.length }))}`}</span>
        ${wKoszyku ? `<span class="w-koszyku">✓ ${esc(t('wKoszyku', { n: wKoszyku }))}</span>` : nic ? `<span class="niedostepny">${esc(t('brak'))}</span>` : ''}</span>
      <span class="strzalka" aria-hidden="true">${otwarty ? '▴' : '▾'}</span>
    </button>
    ${otwarty ? `<div class="warianty">
      ${g.zdjecie ? `<img class="duze" src="${esc(g.zdjecie)}" alt="${esc(g.nazwa)}">` : ''}
      <ul>${g.warianty.map(w => `<li><span class="w-nazwa">${esc(w.w || (jeden ? t('ilosc') : w.nazwa))}<small>${esc(kwota(wWalucie(w.cena)))}${w.cena < w.c ? ` <s>${esc(kwota(wWalucie(w.c)))}</s>` : ''}${w.q !== null && w.q > 0 && w.q <= 5 ? ` · ${esc(t('zostalo', { n: w.q }))}` : ''}</small></span>${htmlLicznika(w)}</li>`).join('')}</ul>
    </div>` : ''}
  </li>`;
}

const listaProduktow = () => {
  const slowa = norm(s.szukaj).split(/\s+/).filter(Boolean);
  return s.produkty.filter(g => (slowa.length ? slowa.every(x => g.szukaj.includes(x)) : g.kategoria === s.kategoria));
};

function htmlProdukty() {
  const kl = s.oferta.klient;
  return `
    ${kl ? `<p class="pasek-klienta">${esc(t('witaj', { n: kl.nazwa || '' }))} <button type="button" class="link" data-akcja="wyloguj">${esc(t('toNieJa'))}</button></p>` : ''}
    <h1>${esc(t('wybierzProdukty'))}</h1>
    <p class="wstep">${esc(t('wstep'))}${kl ? '' : ` <button type="button" class="link maly" data-akcja="kod">${esc(t('maszKod'))}</button>`}</p>
    <nav class="kategorie" aria-label="Kategorie">${kategorie().map(k => `<button type="button" class="kat" data-akcja="kategoria" data-k="${esc(k)}" aria-pressed="${!s.szukaj && s.kategoria === k}">${esc(nazwaKategorii(k))}</button>`).join('')}</nav>
    <label class="szukaj"><span class="sr">${esc(t('szukaj'))}</span><input type="search" data-pole="szukaj" value="${esc(s.szukaj)}" placeholder="🔍 ${esc(t('szukaj'))}" autocomplete="off" enterkeyhint="search"></label>
    <div id="lista">${htmlListy(listaProduktow())}</div>`;
}
function htmlListy(lista) {
  if (!lista.length) return `<p class="pusto">${esc(t('nicNie'))}</p>`;
  return `<ul class="produkty">${lista.slice(0, s.ile).map(htmlProduktu).join('')}</ul>
    ${lista.length > s.ile ? `<p class="wiecej"><button type="button" class="drugi" data-akcja="wiecej">${esc(t('pokazWiecej', { n: lista.length - s.ile }))}</button></p>` : ''}`;
}

function htmlKoszyk() {
  const poz = pozycje();
  if (!poz.length) return `<h1>${esc(t('krokKoszyk'))}</h1><p class="pusto">${esc(t('koszykPusty'))}</p><p><button type="button" class="glowny" data-akcja="krok" data-k="produkty">${esc(t('wrocDoProduktow'))}</button></p>`;
  return `<h1>${esc(t('sprawdzKoszyk'))}</h1>
    <ul class="koszyk">${poz.map(p => `<li>
      ${zdjecie(p.g, 'mini')}
      <span class="k-nazwa"><b>${esc(p.g.nazwa)}</b>${p.w.w ? ` <span class="wariant">${esc(p.w.w)}</span>` : ''}<small>${esc(t('zaSzt', { k: kwota(wWalucie(p.w.cena)) }))}</small></span>
      <span class="k-dol">${htmlLicznika(p.w)}<b class="k-wartosc">${esc(kwota(zaokr(wWalucie(p.w.cena) * p.ilosc)))}</b>
        <button type="button" class="usun" data-akcja="usun" data-s="${esc(p.w.s)}" aria-label="${esc(t('usun'))} ${esc(p.g.nazwa)}">×</button></span>
    </li>`).join('')}</ul>
    <p class="suma">${esc(t('produktyRazem'))}: <b>${esc(kwota(sumaProduktow()))}</b></p>
    <button type="button" class="link" data-akcja="krok" data-k="produkty">${esc(t('dodajInne'))}</button>`;
}

function htmlCenyMetody(w) {
  if (w.do_ustalenia) return `<span class="w-cena ustalenie">${esc(t('doUstalenia'))}</span>`;
  const gratis = gratisDla(w);
  const k = kosztWysylki(w);
  const prog = w.darmowa_od !== null && w.darmowa_od !== undefined && !gratis ? `<small>${esc(t('gratisOd', { k: kwota(wWalucie(w.darmowa_od)) }))}</small>` : '';
  return `<span class="w-cena">${gratis || !k ? esc(t('gratis')) : esc(kwota(k))}${prog}</span>`;
}

function htmlDostawa() {
  const lista = metody();
  const d = dostawa();
  const kraje = KRAJE.map(k => [k, nazwaKraju(k)]);
  const pierwsze = kraje.slice(0, 1), reszta = kraje.slice(1).sort((a, b) => a[1].localeCompare(b[1], lokal()));
  return `<h1>${esc(t('jakDostarczyc'))}</h1>
    <label class="pole"><span>${esc(t('krajDostawy'))}</span>
      <select data-pole="kraj">
        <option value="" ${s.kraj ? '' : 'selected'}>${esc(t('wybierzKraj'))}</option>
        ${[...pierwsze, ...reszta].map(([k, n]) => `<option value="${k}" ${s.kraj === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        <option value="XX" ${s.kraj === 'XX' ? 'selected' : ''}>${esc(t('innyKraj'))}</option>
      </select></label>
    ${s.kraj === 'XX' ? `<label class="pole"><span>${esc(t('nazwaKraju'))} *</span><input data-pole="krajNazwa" value="${esc(s.krajNazwa)}" autocomplete="country-name"></label>` : ''}
    ${!s.kraj ? '' : lista.length ? `<div class="wybory">${lista.map(w => `<label class="wybor"><input type="radio" name="dostawa" value="${esc(w.id)}" data-pole="dostawa" ${s.dostawa === w.id ? 'checked' : ''}>
        <span class="w-tekst"><b>${esc(w.nazwa)}</b>${w.opis ? `<small>${esc(w.opis)}</small>` : ''}${w.pobranie && !/odbior|pobrani/i.test(norm(w.opis)) ? `<small>${esc(t('placiszPrzyOdbiorze'))}</small>` : ''}${w.do_ustalenia && !w.opis ? `<small>${esc(t('doUstaleniaOpis'))}</small>` : ''}</span>
        ${htmlCenyMetody(w)}</label>`).join('')}</div>` : `<p class="pusto">${esc(t('brakMetod'))}</p>`}
    ${d?.adres ? htmlAdresu(d) : ''}
    ${d && !d.pobranie ? `<h2>${esc(t('platnosc'))}</h2>
    <div class="wybory">${eur()
      ? `<label class="wybor"><input type="radio" name="forma" value="Przelew" data-pole="forma" checked><span class="w-tekst"><b>${esc(t('przelewEur'))}</b><small>${esc(t('przelewEurOpis'))}</small></span></label>`
      : `<label class="wybor"><input type="radio" name="forma" value="Przelew" data-pole="forma" ${s.forma !== 'BLIK' ? 'checked' : ''}><span class="w-tekst"><b>${esc(t('przelew'))}</b><small>${esc(t('przelewOpis'))}</small></span></label>
         ${zagranica() ? '' : `<label class="wybor"><input type="radio" name="forma" value="BLIK" data-pole="forma" ${s.forma === 'BLIK' ? 'checked' : ''}><span class="w-tekst"><b>${esc(t('blik'))}</b><small>${esc(t('blikOpis'))}</small></span></label>`}`}
    </div>` : ''}`;
}

function htmlAdresu(d) {
  if (czyPaczkomat(d)) {
    return `<div class="pole"><span>${esc(t('numerPaczkomatu'))}</span>
      <button type="button" class="mapa-przycisk" data-akcja="mapa">${esc(t('wybierzNaMapie'))}</button>
      ${s.punkt && s.punkt.n === s.adres ? `<p class="wybrany-punkt"><b>${esc(s.punkt.n)}</b> · ${esc(s.punkt.a)}, ${esc(s.punkt.m)}${s.punkt.o ? `<small>${esc(s.punkt.o)}</small>` : ''}</p>` : ''}
      <input data-pole="adres" value="${esc(s.adres)}" placeholder="${esc(t('nieZnaszNumeru'))}" autocapitalize="characters" autocomplete="off" aria-label="${esc(t('numerPaczkomatu'))}"></div>`;
  }
  return `<label class="pole"><span>${esc(t('adresDostawy'))}</span>
    <textarea data-pole="adres" rows="3" autocomplete="street-address" placeholder="${esc(czyPunktZagranica(d) ? t('punktPlaceholder') : t('adresPlaceholder'))}">${esc(s.adres)}</textarea></label>`;
}

function htmlDane() {
  const d = dostawa();
  const poz = pozycje();
  const koszt = kosztWysylki(d);
  const forma = d?.pobranie ? '' : eur() ? t('przelewEur') : s.forma === 'BLIK' ? t('blik') : t('przelew');
  return `<h1>${esc(t('twojeDane'))}</h1>
    <form id="formularz" novalidate>
      <label class="pole"><span>${esc(t('imie'))}</span><input data-pole="nazwa" autocomplete="name" value="${esc(s.dane.nazwa)}"></label>
      <label class="pole"><span>${esc(t('telefon'))} <small>${esc(t('telefonPodp'))}</small></span><input data-pole="telefon" type="tel" inputmode="tel" autocomplete="tel" value="${esc(s.dane.telefon)}" placeholder="${esc(t('telefonPlaceholder'))}"></label>
      <label class="pole"><span>${esc(zagranica() ? t('emailWymagany') : t('email'))} ${zagranica() ? '' : `<small>${esc(t('nieTrzeba'))}</small>`}</span><input data-pole="email" type="email" inputmode="email" autocomplete="email" value="${esc(s.dane.email)}"></label>
      <label class="pole"><span>${esc(t('uwagi'))} <small>${esc(t('nieTrzeba'))}</small></span><textarea data-pole="uwagi" rows="2">${esc(s.dane.uwagi)}</textarea></label>
      <label class="pulapka" aria-hidden="true">www<input name="www" tabindex="-1" autocomplete="off"></label>
    </form>
    <section class="podsumowanie" aria-label="${esc(t('podsumowanie'))}">
      <h2>${esc(t('podsumowanie'))}</h2>
      <ul>${poz.map(p => `<li><span>${esc(p.g.nazwa)}${p.w.w ? ' ' + esc(p.w.w) : ''} × ${p.ilosc}</span><b>${esc(kwota(zaokr(wWalucie(p.w.cena) * p.ilosc)))}</b></li>`).join('')}
        <li><span>${esc(d ? d.nazwa : t('dostawa'))}${s.adres && d?.adres ? `<small>${esc(s.adres)}${zagranica() ? ', ' + esc(s.kraj === 'XX' ? s.krajNazwa : nazwaKraju(s.kraj)) : ''}</small>` : ''}</span>
          <b>${koszt === null ? esc(t('doUstalenia')) : koszt ? esc(kwota(koszt)) : esc(t('gratis'))}</b></li></ul>
      <p class="razem">${esc(koszt === null ? t('razemPlus') : t('razem'))}: <b>${esc(kwota(razem()))}</b></p>
      <p class="drobne">${esc(d?.pobranie ? t('placiszPrzyOdbiorzeTxt') : t('platnoscTxt', { f: forma.toLowerCase() }))}
        ${esc(t('rodo'))}</p>
    </section>`;
}

function htmlGotowe() {
  const w = s.wyslane;
  return `<section class="gotowe">
    <div class="ok" aria-hidden="true">✓</div>
    <h1>${esc(t('dziekujemy'))}</h1>
    <p>${esc(t('maNumer'))}</p>
    <p class="numer">${esc(w.numer)}</p>
    <p>${esc(w.doUstalenia ? t('razemPlus') : t('razem'))}: <b>${esc(w.tekstSumy)}</b></p>
    <p>${esc(w.pobranie ? t('poPobraniu') : w.doUstalenia ? t('poZamowieniuUstalenie') : t('poZamowieniu'))}</p>
    <button type="button" class="drugi" data-akcja="nowe">${esc(t('kolejne'))}</button>
  </section>`;
}

function htmlPaska() {
  const n = ileSztuk();
  if (s.krok === 'produkty') {
    return `<span class="p-info">${n ? `<b>${esc(sztuk(n))}</b> · ${esc(kwota(sumaProduktow()))}` : esc(t('pusty'))}</span>
      <button type="button" class="glowny" data-akcja="dalej" ${n ? '' : 'disabled'}>${esc(t('dalej'))}</button>`;
  }
  const wstecz = `<button type="button" class="drugi" data-akcja="wstecz">${esc(t('wstecz'))}</button>`;
  if (s.krok === 'dane') return `${wstecz}<button type="button" class="glowny" data-akcja="wyslij" ${s.wysylam ? 'disabled' : ''}>${esc(s.wysylam ? t('wysylam') : t('zamawiam'))}</button>`;
  return `${wstecz}<button type="button" class="glowny" data-akcja="dalej" ${n ? '' : 'disabled'}>${esc(t('dalej'))}</button>`;
}

function htmlUstawien() {
  return `<label class="przelacznik-jezyka"><span class="sr">${esc(t('jezyk'))}</span>
      <select data-pole="jezyk" aria-label="${esc(t('jezyk'))}">${JEZYKI.map(([k, n]) => `<option value="${k}" ${s.jezyk === k ? 'selected' : ''}>${k.toUpperCase()} · ${esc(n)}</option>`).join('')}</select></label>
    ${kurs() ? `<span class="waluta" role="group" aria-label="${esc(t('waluta'))}">${['PLN', 'EUR'].map(w => `<button type="button" data-akcja="waluta" data-w="${w}" aria-pressed="${(s.waluta || 'PLN') === w}">${w === 'PLN' ? 'zł' : '€'}</button>`).join('')}</span>` : ''}`;
}

function render() {
  const w = $('#widok');
  const pasek = $('#pasek');
  document.documentElement.lang = s.jezyk;
  document.title = `${t('tytul')} · One River`;
  $('.marka small').textContent = t('tytul').toLowerCase();
  $('#ustawienia').innerHTML = s.oferta ? htmlUstawien() : '';
  if (!s.oferta) return;
  if (s.wyslane) { w.innerHTML = htmlGotowe(); pasek.hidden = true; return; }
  const tresc = { produkty: htmlProdukty, koszyk: htmlKoszyk, dostawa: htmlDostawa, dane: htmlDane }[s.krok]();
  w.innerHTML = htmlKrokow() + `<section class="krok krok-${s.krok}">${tresc}</section>`;
  pasek.innerHTML = htmlPaska();
  pasek.hidden = false;
}

function odswiez() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

// ───────────────────────── sprawdzanie i wysyłka ─────────────────────────

const telefonOk = (tel, kraj) => {
  let v = String(tel || '').replace(/[^\d+]/g, '');
  if (v.startsWith('00')) v = '+' + v.slice(2);
  if (/^\d{9}$/.test(v) && (!kraj || kraj === 'PL')) v = '+48' + v;
  if (/^48\d{9}$/.test(v)) v = '+' + v;
  return /^\+\d{8,15}$/.test(v);
};

function sprawdzKrok(krok) {
  if (krok === 'produkty' || krok === 'koszyk') return ileSztuk() ? '' : t('bWybierz');
  if (krok === 'dostawa') {
    if (!s.kraj || (s.kraj === 'XX' && !s.krajNazwa.trim())) return t('bKraj');
    const d = dostawa();
    if (!d) return t('bDostawa');
    if (d.adres && !s.adres.trim()) return czyPaczkomat(d) ? t('bPaczkomat') : t('bAdres');
    return '';
  }
  if (krok === 'dane') {
    if (!s.dane.nazwa.trim()) return t('bImie');
    if (!telefonOk(s.dane.telefon, s.kraj)) return t('bTelefon');
    if (zagranica() && !s.dane.email.trim()) return t('bEmailWym');
    if (s.dane.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.dane.email.trim())) return t('bEmail');
  }
  return '';
}

function pokazBlad(b) {
  toast(b, 'blad', 6000);
  const pole = [[t('bKraj'), 'kraj'], [t('bPaczkomat'), 'adres'], [t('bAdres'), 'adres'], [t('bImie'), 'nazwa'], [t('bTelefon'), 'telefon'], [t('bEmail'), 'email'], [t('bEmailWym'), 'email']]
    .find(([k]) => k === b)?.[1];
  const el = pole && $(`[data-pole="${pole}"]`);
  if (el) { el.focus(); el.classList.add('blad'); setTimeout(() => el.classList.remove('blad'), 3000); }
}

async function wyslij() {
  for (const k of ['koszyk', 'dostawa', 'dane']) {
    const b = sprawdzKrok(k);
    if (b) { if (s.krok !== k) { s.krok = k; render(); } pokazBlad(b); return; }
  }
  s.wysylam = true; odswiez();
  const d = dostawa();
  const tekstSumy = kwota(razem());
  try {
    const wynik = await api('zamow', {
      kod: s.kod || '', www: $('[name=www]')?.value || '',
      klient: { nazwa: s.dane.nazwa.trim(), telefon: s.dane.telefon.trim(), email: s.dane.email.trim() },
      pozycje: pozycje().map(p => ({ symbol: p.w.s, ilosc: p.ilosc })),
      dostawa_id: d ? d.id : '', adres: d?.adres ? s.adres.trim() : '',
      kraj: s.kraj === 'XX' ? 'XX' : s.kraj, kraj_nazwa: s.kraj === 'XX' ? s.krajNazwa.trim() : nazwaKraju(s.kraj),
      forma_platnosci: d?.pobranie ? 'Pobranie' : eur() ? 'Przelew' : s.forma, uwagi: s.dane.uwagi.trim(),
      waluta: eur() ? 'EUR' : 'PLN', jezyk: s.jezyk,
    });
    const doUstalenia = Boolean(wynik.do_ustalenia);
    s.wyslane = { numer: wynik.numer, pobranie: Boolean(d?.pobranie), doUstalenia,
      tekstSumy: wynik.waluta === 'EUR' && wynik.suma_eur !== '' ? kwota(Number(wynik.suma_eur)) : eur() ? tekstSumy : kwota(Number(wynik.suma)) };
    s.koszyk = {}; s.krok = 'produkty'; s.dane.uwagi = '';
    zachowaj();
    window.scrollTo(0, 0);
  } catch (err) {
    toast(err.message || String(err), 'blad', 8000);
  } finally {
    s.wysylam = false;
    render();
  }
}

// ───────────────────────── mapa paczkomatów ─────────────────────────

let L = null, mapa = null, warstwa = null, punkty = [], wybrany = '';

function wczytajLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((ok, nie) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = LEAFLET + 'leaflet.min.js';
    js.onload = () => ok(window.L);
    js.onerror = nie;
    document.head.append(js);
  });
}

async function otworzMape() {
  const d = $('#mapa');
  const pobranie = Boolean(dostawa()?.pobranie);
  d.innerHTML = `<div class="mapa-okno">
    <header><h2>${esc(t('mapaTytul'))}</h2><button type="button" class="zamknij" data-akcja="mapa-zamknij" aria-label="${esc(t('zamknij'))}">✕</button></header>
    <form class="mapa-szukaj" data-forma="mapa"><input type="search" name="q" placeholder="${esc(t('mapaSzukaj'))}" autocomplete="off" enterkeyhint="search">
      <button type="submit" class="glowny">${esc(t('mapaSzukajBtn'))}</button></form>
    <div class="mapa-narzedzia"><button type="button" class="drugi" data-akcja="mapa-gps">${esc(t('mapaBlisko'))}</button>
      ${pobranie ? `<small>${esc(t('mapaPobranie'))}</small>` : ''}</div>
    <div class="mapa-kontener"><div id="mapa-mapa"></div><button type="button" class="mapa-tutaj" data-akcja="mapa-tutaj" hidden>${esc(t('mapaTutaj'))}</button></div>
    <p class="mapa-info" id="mapa-info">${esc(t('mapaPusto'))}</p>
    <ul class="mapa-lista" id="mapa-lista"></ul>
  </div>`;
  d.showModal();
  wybrany = s.adres;
  try {
    L = await wczytajLeaflet();
  } catch {
    $('#mapa-info').textContent = t('serwer');
    return;
  }
  mapa = L.map('mapa-mapa', { zoomControl: true, attributionControl: true }).setView([52.07, 19.48], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  warstwa = L.layerGroup().addTo(mapa);
  mapa.on('dragend', () => { const b = $('.mapa-tutaj'); if (b && mapa.getZoom() >= 11) b.hidden = false; });
  const start = (s.punkt && s.punkt.n === s.adres && s.adres) || s.adres.trim() || s.oferta.klient?.miasto || '';
  if (start) { $('.mapa-szukaj [name=q]').value = start; szukajPunktow({ szukaj: start }); }
  else $('.mapa-szukaj [name=q]').focus();
}

async function szukajPunktow(zapytanie) {
  const info = $('#mapa-info');
  info.textContent = t('mapaSzuka');
  $('.mapa-tutaj') && ($('.mapa-tutaj').hidden = true);
  try {
    const w = await api('paczkomaty', { ...zapytanie, pobranie: Boolean(dostawa()?.pobranie) });
    punkty = (w.punkty || []).filter(p => isFinite(p.lat) && isFinite(p.lng));
    if (w.blad === 'nie_znaleziono') { info.textContent = t('mapaNieZnaleziono'); $('#mapa-lista').innerHTML = ''; warstwa.clearLayers(); return; }
    if (!punkty.length) { info.textContent = t('mapaBrak'); $('#mapa-lista').innerHTML = ''; warstwa.clearLayers(); return; }
    info.textContent = '';
    rysujPunkty(w.srodek);
  } catch (err) {
    info.textContent = err.message || String(err);
  }
}

function rysujPunkty(srodek) {
  warstwa.clearLayers();
  const granice = [];
  punkty.forEach(p => {
    const m = L.circleMarker([p.lat, p.lng], { radius: p.n === wybrany ? 11 : 8, color: '#0D4240', weight: 2, fillColor: p.n === wybrany ? '#E5B335' : '#FFCD00', fillOpacity: 1 })
      .bindPopup(`<b>${esc(p.n)}</b><br>${esc(p.a)}<br>${esc(p.m)}${p.o ? `<br><small>${esc(p.o)}</small>` : ''}<br><button type="button" class="glowny maly" data-akcja="mapa-wybierz" data-n="${esc(p.n)}">${esc(t('mapaWybierz'))}</button>`);
    m.addTo(warstwa);
    granice.push([p.lat, p.lng]);
  });
  if (srodek) granice.push([srodek.lat, srodek.lng]);
  if (granice.length === 1) mapa.setView(granice[0], 15);
  else mapa.fitBounds(granice.slice(0, 12), { padding: [24, 24], maxZoom: 15 });
  $('#mapa-lista').innerHTML = punkty.slice(0, 25).map(p => `<li><button type="button" data-akcja="mapa-wybierz" data-n="${esc(p.n)}" class="${p.n === wybrany ? 'wybrany' : ''}">
    <b>${esc(p.n)}</b><span>${esc(p.a)}, ${esc(p.m)}</span>${p.o ? `<small>${esc(p.o)}${p.c ? ' · ' + esc(t('calaDoba')) : ''}</small>` : p.c ? `<small>${esc(t('calaDoba'))}</small>` : ''}</button></li>`).join('');
}

function wybierzPunkt(n) {
  const p = punkty.find(x => x.n === n);
  if (!p) return;
  s.adres = p.n;
  s.punkt = { n: p.n, a: p.a, m: p.m, o: p.o };
  zachowaj();
  $('#mapa').close();
  odswiez();
  toast(`${t('wybrano')}: ${p.n}`, 'ok', 2500);
}

// ───────────────────────── zdarzenia ─────────────────────────

function ustawIlosc(sym, n) {
  const x = wariant(sym);
  if (!x) return;
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (x.w.q !== null && n > x.w.q) { n = x.w.q; toast(t('mamyTylko', { n: sztuk(x.w.q) }), '', 3000); }
  if (n) s.koszyk[sym] = n; else delete s.koszyk[sym];
  zachowaj();
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-akcja]');
  if (!b || b.disabled) return;
  const { akcja } = b.dataset;
  if (akcja === 'otworz') {
    const li = b.closest('[data-klucz]');
    s.otwarty = s.otwarty === li.dataset.klucz ? '' : li.dataset.klucz;
    odswiez();
    if (s.otwarty) { const el = $('.produkt.otwarty'); if (el && el.getBoundingClientRect().top < 70) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  } else if (akcja === 'plus' || akcja === 'minus') {
    ustawIlosc(b.dataset.s, (s.koszyk[b.dataset.s] || 0) + (akcja === 'plus' ? 1 : -1));
    odswiez();
  } else if (akcja === 'usun') { ustawIlosc(b.dataset.s, 0); odswiez(); }
  else if (akcja === 'kategoria') { s.kategoria = b.dataset.k; s.szukaj = ''; s.otwarty = ''; s.ile = NA_STRONE; render(); window.scrollTo(0, 0); }
  else if (akcja === 'wiecej') { s.ile += NA_STRONE; odswiez(); }
  else if (akcja === 'dalej') {
    const bl = sprawdzKrok(s.krok);
    if (bl) { pokazBlad(bl); return; }
    s.krok = KROKI[KROKI.indexOf(s.krok) + 1];
    render(); window.scrollTo(0, 0);
  } else if (akcja === 'wstecz') { s.krok = KROKI[Math.max(0, KROKI.indexOf(s.krok) - 1)]; render(); window.scrollTo(0, 0); }
  else if (akcja === 'krok') { s.krok = b.dataset.k; render(); window.scrollTo(0, 0); }
  else if (akcja === 'wyslij') await wyslij();
  else if (akcja === 'nowe') { s.wyslane = null; render(); window.scrollTo(0, 0); }
  else if (akcja === 'kod') oknoKodu();
  else if (akcja === 'wyloguj') { s.kod = ''; s.dane = { nazwa: '', telefon: '', email: '', uwagi: '' }; s.adres = ''; s.punkt = null; await przeladuj(); }
  else if (akcja === 'waluta') { s.waluta = b.dataset.w; zachowaj(); odswiez(); }
  else if (akcja === 'mapa') otworzMape();
  else if (akcja === 'mapa-zamknij') $('#mapa').close();
  else if (akcja === 'mapa-wybierz') wybierzPunkt(b.dataset.n);
  else if (akcja === 'mapa-tutaj') { const c = mapa.getCenter(); szukajPunktow({ lat: c.lat, lng: c.lng }); }
  else if (akcja === 'mapa-gps') {
    if (!navigator.geolocation) { $('#mapa-info').textContent = t('mapaBladGps'); return; }
    $('#mapa-info').textContent = t('mapaSzuka');
    navigator.geolocation.getCurrentPosition(p => szukajPunktow({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { $('#mapa-info').textContent = t('mapaBladGps'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }
});

document.addEventListener('submit', e => {
  if (e.target.dataset.forma !== 'mapa') return;
  e.preventDefault();
  const q = e.target.elements.q.value.trim();
  if (q) szukajPunktow({ szukaj: q });
});

document.addEventListener('input', e => {
  const pole = e.target.dataset?.pole;
  if (!pole) return;
  const v = e.target.value;
  if (pole === 'szukaj') {
    s.szukaj = v; s.otwarty = ''; s.ile = NA_STRONE;
    $('#lista').innerHTML = htmlListy(listaProduktow());
    document.querySelectorAll('.kat').forEach(k => k.setAttribute('aria-pressed', String(!v && k.dataset.k === s.kategoria)));
  } else if (pole === 'ilosc') {
    if (v === '') return;
    ustawIlosc(e.target.dataset.s, v);
    $('#pasek').innerHTML = htmlPaska();
  } else if (pole === 'adres') {
    s.adres = czyPaczkomat(dostawa()) ? v.toUpperCase() : v;
    if (czyPaczkomat(dostawa()) && e.target.value !== s.adres) { const p = e.target.selectionStart; e.target.value = s.adres; e.target.setSelectionRange(p, p); }
    zachowaj();
  } else if (pole === 'krajNazwa') { s.krajNazwa = v; zachowaj(); }
  else if (['nazwa', 'telefon', 'email', 'uwagi'].includes(pole)) { s.dane[pole] = v; zachowaj(); }
});

document.addEventListener('change', e => {
  const pole = e.target.dataset?.pole;
  if (pole === 'dostawa') {
    const byl = dostawa();
    s.dostawa = e.target.value;
    // przy zmianie paczkomat ↔ adres stary wpis nie pasuje
    if (byl && czyPaczkomat(byl) !== czyPaczkomat(dostawa())) { s.adres = czyPaczkomat(dostawa()) ? '' : (s.oferta.klient?.adres || ''); s.punkt = null; }
    zachowaj(); odswiez();
  } else if (pole === 'kraj') {
    const bylaZagranica = zagranica();
    s.kraj = e.target.value;
    if (!dostawa()) s.dostawa = '';
    if (bylaZagranica !== zagranica()) { s.adres = ''; s.punkt = null; }
    // klient zagraniczny zwykle płaci w euro – ustawiamy, póki sam nie wybrał waluty
    if (zagranica() && !s.walutaWybrana && kurs()) s.waluta = 'EUR';
    if (s.kraj === 'PL' && !s.walutaWybrana) s.waluta = 'PLN';
    zachowaj(); odswiez();
  } else if (pole === 'forma') { s.forma = e.target.value; zachowaj(); }
  else if (pole === 'ilosc') { ustawIlosc(e.target.dataset.s, e.target.value); odswiez(); }
  else if (pole === 'jezyk') {
    s.jezyk = e.target.value;
    s.produkty.forEach(g => { g.szukaj = norm(g.nazwa + ' ' + g.kategoria + ' ' + nazwaKategorii(g.kategoria) + ' ' + g.warianty.map(w => w.nazwa + ' ' + w.w).join(' ')); });
    zachowaj(); odswiez();
  }
});
document.addEventListener('click', e => { if (e.target.closest('[data-akcja="waluta"]')) s.walutaWybrana = true; }, true);

// ───────────────────────── kod klienta, komunikaty ─────────────────────────

async function oknoKodu() {
  const d = $('#okno');
  d.innerHTML = `<form method="dialog" class="okno-kod">
    <h2>${esc(t('kodTytul'))}</h2>
    <p>${esc(t('kodOpis'))}</p>
    <label class="pole"><span>${esc(t('kod'))}</span><input name="kod" autocomplete="off" autocapitalize="characters" value="${esc(s.kod)}" placeholder="ABCD-1234"></label>
    <div class="przyciski"><button value="" class="drugi">${esc(t('anuluj'))}</button><button value="ok" class="glowny">${esc(t('zastosuj'))}</button></div>
  </form>`;
  d.showModal();
  d.addEventListener('close', async () => {
    if (d.returnValue !== 'ok') return;
    const kod = $('[name=kod]', d).value.trim();
    if (!kod) return;
    s.kod = kod;
    await przeladuj();
    if (s.oferta?.klient) toast(t('witaj', { n: s.oferta.klient.nazwa }), 'ok', 4000);
  }, { once: true });
}

let toastCzas;
function toast(tekst, typ = '', ms = 3000) {
  const el = $('#toast');
  el.textContent = tekst;
  el.className = 'widoczny ' + typ;
  clearTimeout(toastCzas);
  toastCzas = setTimeout(() => { el.className = ''; }, ms);
}

async function przeladuj() {
  try {
    await wczytajOferte();
    render();
  } catch (err) {
    $('#widok').innerHTML = `<section class="krok"><h1>${esc(t('bladOferty'))}</h1><p>${esc(err.message || err)}</p>
      <p><button type="button" class="glowny" onclick="location.reload()">${esc(t('sprobuj'))}</button></p></section>`;
  }
}

// ───────────────────────── start ─────────────────────────

wczytajPamiec();
const parametry = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
const jezykZLinku = parametry.get('lang');
if (jezykZLinku && T[jezykZLinku]) s.jezyk = jezykZLinku;
if (!T[s.jezyk]) {
  const przegladarka = (navigator.languages || [navigator.language || 'pl']).map(j => String(j).slice(0, 2).toLowerCase()).find(j => T[j]);
  s.jezyk = przegladarka || 'pl';
}
if (!s.waluta) s.waluta = s.jezyk === 'pl' ? 'PLN' : 'EUR';
const kodZLinku = parametry.get('kod');
if (kodZLinku) {
  if (kodZLinku !== s.kod) { s.dane = { nazwa: '', telefon: '', email: '', uwagi: '' }; s.adres = ''; s.punkt = null; }
  s.kod = kodZLinku;
}
if (kodZLinku || jezykZLinku) history.replaceState(null, '', location.pathname);
$('#widok').innerHTML = `<p class="laduje">${esc(t('wczytuje'))}</p>`;
przeladuj().then(() => { if (kodZLinku && s.oferta?.klient) toast(t('witaj', { n: s.oferta.klient.nazwa }), 'ok', 5000); });
// link z innym kodem otwarty w tej samej karcie (zmienia się tylko #…) – wczytujemy od nowa
window.addEventListener('hashchange', () => { if (/[#&](kod|lang)=/.test(location.hash)) location.reload(); });
