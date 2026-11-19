// Formularz zamówień ONE RIVER dla klientów – krok po kroku (jak sprzedaż u Grażynki):
// 1) produkty ze zdjęciami i ilościami, 2) koszyk, 3) dostawa z cennikiem, 4) dane i wysłanie.
// Oferta, ceny i cennik dostaw przychodzą ze skryptu arkusza (akcja „sklep”); zamówienie wysyła akcja „zamow”.
// Ceny liczy skrypt – przeglądarka tylko je pokazuje. Link z #kod=… pokazuje ceny klienta i wpisuje jego dane.

const API = 'https://script.google.com/macros/s/AKfycbwFcvYtbGMBPlJCT_QDzXfnFvnnEQQt1EqFrjnhEKgeg7lo22JuRwFxOK5-vZGcVwg9CQ/exec';
const KOLEJNOSC = ['Rapé', 'Akcesoria do rapé', 'Zielarnia i olejki', 'Biżuteria', 'Odzież', 'Wystrój wnętrz i inne', 'Instrumenty etniczne'];
const KROKI = [['produkty', 'Produkty'], ['koszyk', 'Koszyk'], ['dostawa', 'Dostawa'], ['dane', 'Dane']];
const PAMIEC = 'or-zamow-2';
const NA_STRONE = 30;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const zl = n => fmt.format(n) + ' zł';
const zaokr = n => Math.round(n * 100) / 100;
const norm = v => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const szt = n => `${n} ${n === 1 ? 'sztuka' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'sztuki' : 'sztuk'}`;

// ───────────────────────── stan ─────────────────────────

const s = {
  oferta: null, produkty: [], krok: 'produkty', kategoria: '', szukaj: '', otwarty: '', ile: NA_STRONE,
  koszyk: {},                      // symbol → ilość
  kod: '', dostawa: '', adres: '', forma: 'Przelew',
  dane: { nazwa: '', telefon: '', email: '', uwagi: '' },
  wyslane: null, wysylam: false,
};

function wczytajPamiec() {
  try {
    const p = JSON.parse(localStorage.getItem(PAMIEC)) || {};
    ['koszyk', 'kod', 'dostawa', 'adres', 'forma'].forEach(k => { if (p[k] !== undefined) s[k] = p[k]; });
    s.dane = { ...s.dane, ...(p.dane || {}) };
  } catch { /* pusto */ }
}
function zachowaj() {
  try { localStorage.setItem(PAMIEC, JSON.stringify({ koszyk: s.koszyk, kod: s.kod, dostawa: s.dostawa, adres: s.adres, forma: s.forma, dane: s.dane })); } catch { /* bez znaczenia */ }
}

// ───────────────────────── API ─────────────────────────

async function api(akcja, dane = {}) {
  let odp;
  try {
    odp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...dane, akcja }) });
  } catch {
    throw new Error('Brak połączenia z internetem. Spróbuj ponownie za chwilę.');
  }
  let j;
  try { j = await odp.json(); } catch { throw new Error('Serwer zamówień nie odpowiada. Spróbuj ponownie za chwilę.'); }
  if (!j.ok) throw new Error(j.blad || 'Coś poszło nie tak.');
  return j.dane;
}

async function wczytajOferte() {
  const o = await api('sklep', s.kod ? { kod: s.kod } : {});
  if (s.kod && !o.klient) {
    toast(o.blad_kodu || 'Nie znamy takiego kodu.', 'blad', 6000);
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
    g.szukaj = norm(g.nazwa + ' ' + g.kategoria + ' ' + g.warianty.map(w => w.nazwa + ' ' + w.w).join(' '));
    return g;
  }).sort((a, b) => (KOLEJNOSC.indexOf(a.kategoria) + 1 || 99) - (KOLEJNOSC.indexOf(b.kategoria) + 1 || 99)
    || (b.zdjecie ? 1 : 0) - (a.zdjecie ? 1 : 0) || a.nazwa.localeCompare(b.nazwa, 'pl'));
  // z koszyka znikają produkty, których nie ma już w ofercie; ilości ponad stan są przycinane
  let zmiana = false;
  Object.keys(s.koszyk).forEach(sym => {
    const x = wariant(sym);
    if (!x || !dostepny(x.w)) { delete s.koszyk[sym]; zmiana = true; }
    else if (x.w.q !== null && s.koszyk[sym] > x.w.q) { s.koszyk[sym] = x.w.q; zmiana = true; }
  });
  if (zmiana) toast('Część produktów z koszyka nie jest już dostępna w tej ilości.', '', 5000);
  if (s.dostawa && !o.wysylki.some(w => w.id === s.dostawa)) s.dostawa = '';
  // klient z kodem – jego dane od razu w formularzu
  if (o.klient) {
    if (!s.dane.nazwa) s.dane.nazwa = o.klient.nazwa || '';
    if (!s.dane.telefon) s.dane.telefon = o.klient.telefon || '';
    if (!s.dane.email) s.dane.email = o.klient.email || '';
    if (!s.adres && o.klient.adres) s.adres = o.klient.adres;
  }
  if (!s.kategoria) s.kategoria = kategorie()[0] || '';
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
const sumaProduktow = () => zaokr(pozycje().reduce((a, p) => a + p.w.cena * p.ilosc, 0));
const dostawa = () => s.oferta?.wysylki.find(w => w.id === s.dostawa);
const kosztWysylki = w => (!w ? 0 : w.darmowa_od !== null && sumaProduktow() >= w.darmowa_od ? 0 : w.cena);
const razem = () => zaokr(sumaProduktow() + kosztWysylki(dostawa()));
function kategorie() {
  const kat = new Set(s.produkty.map(p => p.kategoria));
  return [...KOLEJNOSC.filter(k => kat.has(k)), ...[...kat].filter(k => !KOLEJNOSC.includes(k))];
}
const czyPaczkomat = w => /paczkomat/i.test(w?.nazwa || '');

// ───────────────────────── widoki ─────────────────────────

const zdjecie = (g, klasa = 'zdj') => g.zdjecie
  ? `<img class="${klasa}" src="${esc(g.zdjecie)}" alt="" loading="lazy">`
  : `<span class="${klasa} zastepcze" aria-hidden="true">${esc(g.nazwa.replace(/^rap[eé]\s+/i, '').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase())}</span>`;

function htmlKrokow() {
  const i = KROKI.findIndex(([k]) => k === s.krok);
  return `<ol class="kroki" aria-label="Etapy zamówienia">${KROKI.map(([k, n], j) =>
    `<li class="${j < i ? 'zrobiony' : j === i ? 'biezacy' : ''}" ${j === i ? 'aria-current="step"' : ''}><span>${j < i ? '✓' : j + 1}</span>${esc(n)}</li>`).join('')}</ol>`;
}

function htmlLicznika(w) {
  const n = s.koszyk[w.s] || 0;
  if (!dostepny(w)) return '<span class="niedostepny">chwilowo brak</span>';
  if (!n) return `<button type="button" class="dodaj" data-akcja="plus" data-s="${esc(w.s)}">Dodaj</button>`;
  const max = w.q !== null && n >= w.q;
  return `<span class="licznik" role="group" aria-label="Ilość">
    <button type="button" data-akcja="minus" data-s="${esc(w.s)}" aria-label="Mniej">−</button>
    <input type="number" inputmode="numeric" min="0" ${w.q !== null ? `max="${w.q}"` : ''} value="${n}" data-pole="ilosc" data-s="${esc(w.s)}" aria-label="Ilość">
    <button type="button" data-akcja="plus" data-s="${esc(w.s)}" aria-label="Więcej" ${max ? 'disabled' : ''}>+</button></span>`;
}

function htmlProduktu(g) {
  const otwarty = s.otwarty === g.klucz;
  const ceny = g.warianty.map(w => w.cena);
  const min = Math.min(...ceny), max = Math.max(...ceny);
  const wKoszyku = g.warianty.reduce((a, w) => a + (s.koszyk[w.s] || 0), 0);
  const jeden = g.warianty.length === 1;
  const nic = !g.warianty.some(dostepny);
  return `<li class="produkt${otwarty ? ' otwarty' : ''}${nic ? ' brak' : ''}" data-klucz="${esc(g.klucz)}">
    <button type="button" class="glowa" data-akcja="otworz" aria-expanded="${otwarty}">
      ${zdjecie(g)}
      <span class="opis"><b>${esc(g.nazwa)}</b>
        <span class="cena">${min === max ? esc(zl(min)) : `od ${esc(zl(min))}`}${jeden || g.warianty.length < 2 ? '' : ` · ${g.warianty.length} warianty`}</span>
        ${wKoszyku ? `<span class="w-koszyku">✓ w koszyku: ${wKoszyku}</span>` : nic ? '<span class="niedostepny">chwilowo brak</span>' : ''}</span>
      <span class="strzalka" aria-hidden="true">${otwarty ? '▴' : '▾'}</span>
    </button>
    ${otwarty ? `<div class="warianty">
      ${g.zdjecie ? `<img class="duze" src="${esc(g.zdjecie)}" alt="${esc(g.nazwa)}">` : ''}
      <ul>${g.warianty.map(w => `<li><span class="w-nazwa">${esc(w.w || (jeden ? 'Ilość' : w.nazwa))}<small>${esc(zl(w.cena))}${w.cena < w.c ? ` <s>${esc(zl(w.c))}</s>` : ''}${w.q !== null && w.q > 0 && w.q <= 5 ? ` · zostało ${w.q}` : ''}</small></span>${htmlLicznika(w)}</li>`).join('')}</ul>
    </div>` : ''}
  </li>`;
}

function htmlProdukty() {
  const slowa = norm(s.szukaj).split(/\s+/).filter(Boolean);
  const lista = s.produkty.filter(g => (slowa.length ? slowa.every(x => g.szukaj.includes(x)) : g.kategoria === s.kategoria));
  const kl = s.oferta.klient;
  return `
    ${kl ? `<p class="pasek-klienta">Witaj, <b>${esc(kl.nazwa || 'kliencie')}</b>! Widzisz swoje ceny. <button type="button" class="link" data-akcja="wyloguj">To nie ja</button></p>` : ''}
    <h1>Wybierz produkty</h1>
    <p class="wstep">Dotknij produktu, wybierz wariant i ilość. Potem „Dalej”.</p>
    <nav class="kategorie" aria-label="Kategorie">${kategorie().map(k => `<button type="button" class="kat" data-akcja="kategoria" data-k="${esc(k)}" aria-pressed="${!s.szukaj && s.kategoria === k}">${esc(k)}</button>`).join('')}</nav>
    <label class="szukaj"><span class="sr">Szukaj</span><input type="search" data-pole="szukaj" value="${esc(s.szukaj)}" placeholder="🔍 Szukaj produktu" autocomplete="off" enterkeyhint="search"></label>
    <div id="lista">${htmlListy(lista)}</div>`;
}
function htmlListy(lista) {
  if (!lista.length) return '<p class="pusto">Nic nie znaleźliśmy. Spróbuj innej nazwy.</p>';
  return `<ul class="produkty">${lista.slice(0, s.ile).map(htmlProduktu).join('')}</ul>
    ${lista.length > s.ile ? `<p class="wiecej"><button type="button" class="drugi" data-akcja="wiecej">Pokaż więcej (${lista.length - s.ile})</button></p>` : ''}`;
}

function htmlKoszyk() {
  const poz = pozycje();
  if (!poz.length) return `<h1>Koszyk</h1><p class="pusto">Koszyk jest pusty.</p><p><button type="button" class="glowny" data-akcja="krok" data-k="produkty">← Wybierz produkty</button></p>`;
  return `<h1>Sprawdź koszyk</h1>
    <ul class="koszyk">${poz.map(p => `<li>
      ${zdjecie(p.g, 'mini')}
      <span class="k-nazwa"><b>${esc(p.g.nazwa)}</b>${p.w.w ? ` <span class="wariant">${esc(p.w.w)}</span>` : ''}<small>${esc(zl(p.w.cena))} / szt.</small></span>
      <span class="k-dol">${htmlLicznika(p.w)}<b class="k-wartosc">${esc(zl(zaokr(p.w.cena * p.ilosc)))}</b>
        <button type="button" class="usun" data-akcja="usun" data-s="${esc(p.w.s)}" aria-label="Usuń ${esc(p.g.nazwa)}">×</button></span>
    </li>`).join('')}</ul>
    <p class="suma">Produkty: <b>${esc(zl(sumaProduktow()))}</b></p>
    <button type="button" class="link" data-akcja="krok" data-k="produkty">+ Dodaj inne produkty</button>`;
}

function htmlDostawa() {
  const wys = s.oferta.wysylki;
  const d = dostawa();
  const prod = sumaProduktow();
  return `<h1>Jak dostarczyć?</h1>
    ${wys.length ? `<div class="wybory">${wys.map(w => {
      const gratis = w.darmowa_od !== null && prod >= w.darmowa_od;
      return `<label class="wybor"><input type="radio" name="dostawa" value="${esc(w.id)}" data-pole="dostawa" ${s.dostawa === w.id ? 'checked' : ''}>
        <span class="w-tekst"><b>${esc(w.nazwa)}</b>${w.opis ? `<small>${esc(w.opis)}</small>` : ''}${w.pobranie && !/odbior/i.test(norm(w.opis)) ? '<small>💵 płacisz przy odbiorze</small>' : ''}</span>
        <span class="w-cena">${gratis ? 'gratis' : w.cena ? esc(zl(w.cena)) : '0 zł'}${!gratis && w.darmowa_od !== null ? `<small>gratis od ${esc(zl(w.darmowa_od))}</small>` : ''}</span></label>`;
    }).join('')}</div>` : '<p class="pusto">Sposób dostawy ustalimy z Tobą telefonicznie.</p>'}
    ${d?.adres ? `<label class="pole"><span>${czyPaczkomat(d) ? 'Numer paczkomatu *' : 'Adres dostawy *'}</span>
      ${czyPaczkomat(d)
        ? `<input data-pole="adres" value="${esc(s.adres)}" placeholder="np. WAW123M" autocapitalize="characters" autocomplete="off">
           <small class="podp">Nie znasz numeru? <a href="https://inpost.pl/znajdz-paczkomat" target="_blank" rel="noopener">Znajdź paczkomat na mapie</a></small>`
        : `<textarea data-pole="adres" rows="3" autocomplete="street-address" placeholder="Ulica i numer, kod pocztowy, miasto${/zagran/i.test(d.nazwa) ? ', kraj' : ''}">${esc(s.adres)}</textarea>`}</label>` : ''}
    ${d && !d.pobranie ? `<h2>Płatność</h2>
    <div class="wybory">
      <label class="wybor"><input type="radio" name="forma" value="Przelew" data-pole="forma" ${s.forma === 'Przelew' ? 'checked' : ''}><span class="w-tekst"><b>Przelew</b><small>Numer konta wyślemy SMS-em po sprawdzeniu zamówienia</small></span></label>
      <label class="wybor"><input type="radio" name="forma" value="BLIK" data-pole="forma" ${s.forma === 'BLIK' ? 'checked' : ''}><span class="w-tekst"><b>BLIK na telefon</b><small>Numer telefonu do BLIK-a wyślemy SMS-em</small></span></label>
    </div>` : ''}`;
}

function htmlDane() {
  const d = dostawa();
  const poz = pozycje();
  const koszt = kosztWysylki(d);
  return `<h1>Twoje dane</h1>
    <form id="formularz" novalidate>
      <label class="pole"><span>Imię i nazwisko *</span><input data-pole="nazwa" autocomplete="name" value="${esc(s.dane.nazwa)}"></label>
      <label class="pole"><span>Telefon * <small>(potwierdzimy SMS-em)</small></span><input data-pole="telefon" type="tel" inputmode="tel" autocomplete="tel" value="${esc(s.dane.telefon)}" placeholder="np. 600 100 200"></label>
      <label class="pole"><span>E-mail <small>(nie trzeba)</small></span><input data-pole="email" type="email" inputmode="email" autocomplete="email" value="${esc(s.dane.email)}"></label>
      <label class="pole"><span>Uwagi <small>(nie trzeba)</small></span><textarea data-pole="uwagi" rows="2">${esc(s.dane.uwagi)}</textarea></label>
      <label class="pulapka" aria-hidden="true">Strona www<input name="www" tabindex="-1" autocomplete="off"></label>
    </form>
    <section class="podsumowanie" aria-label="Podsumowanie">
      <h2>Podsumowanie</h2>
      <ul>${poz.map(p => `<li><span>${esc(p.g.nazwa)}${p.w.w ? ' ' + esc(p.w.w) : ''} × ${p.ilosc}</span><b>${esc(zl(zaokr(p.w.cena * p.ilosc)))}</b></li>`).join('')}
        <li><span>${esc(d ? d.nazwa : 'Dostawa')}${s.adres && d?.adres ? `<small>${esc(s.adres)}</small>` : ''}</span><b>${koszt ? esc(zl(koszt)) : 'gratis'}</b></li></ul>
      <p class="razem">Razem: <b>${esc(zl(razem()))}</b></p>
      <p class="drobne">${d?.pobranie ? 'Płacisz przy odbiorze przesyłki.' : `Płatność: ${s.forma === 'BLIK' ? 'BLIK na telefon' : 'przelew'} – dane wyślemy SMS-em, gdy sprawdzimy zamówienie.`}
        Twoje dane wykorzystamy wyłącznie do realizacji tego zamówienia. Administrator: ONE RIVER sp. z o.o., Warszawa.</p>
    </section>`;
}

function htmlGotowe() {
  const w = s.wyslane;
  return `<section class="gotowe">
    <div class="ok" aria-hidden="true">✓</div>
    <h1>Dziękujemy!</h1>
    <p>Twoje zamówienie ma numer</p>
    <p class="numer">${esc(w.numer)}</p>
    <p>Razem: <b>${esc(zl(w.suma))}</b></p>
    <p>${w.pobranie ? 'Zapłacisz przy odbiorze. Damy znać SMS-em, gdy paczka wyruszy.' : 'Sprawdzimy zamówienie i wyślemy Ci SMS z danymi do płatności.'}</p>
    <button type="button" class="drugi" data-akcja="nowe">Złóż kolejne zamówienie</button>
  </section>`;
}

function htmlPaska() {
  const n = ileSztuk();
  if (s.krok === 'produkty') {
    return `<span class="p-info">${n ? `<b>${szt(n)}</b> · ${esc(zl(sumaProduktow()))}` : 'Koszyk jest pusty'}</span>
      <button type="button" class="glowny" data-akcja="dalej" ${n ? '' : 'disabled'}>Dalej →</button>`;
  }
  const wstecz = '<button type="button" class="drugi" data-akcja="wstecz">← Wstecz</button>';
  if (s.krok === 'dane') return `${wstecz}<button type="button" class="glowny" data-akcja="wyslij" ${s.wysylam ? 'disabled' : ''}>${s.wysylam ? 'Wysyłam…' : '✓ Zamawiam'}</button>`;
  return `${wstecz}<button type="button" class="glowny" data-akcja="dalej" ${n ? '' : 'disabled'}>Dalej →</button>`;
}

function render() {
  const w = $('#widok');
  const pasek = $('#pasek');
  if (!s.oferta) return;
  $('#kod-przycisk').textContent = s.oferta.klient ? (s.oferta.klient.nazwa || 'Twój kod') : 'Mam kod klienta';
  if (s.wyslane) { w.innerHTML = htmlGotowe(); pasek.hidden = true; return; }
  const tresc = { produkty: htmlProdukty, koszyk: htmlKoszyk, dostawa: htmlDostawa, dane: htmlDane }[s.krok]();
  w.innerHTML = htmlKrokow() + `<section class="krok krok-${s.krok}">${tresc}</section>`;
  pasek.innerHTML = htmlPaska();
  pasek.hidden = false;
}

/** Odświeżenie bez skoku przewijania (np. po zmianie ilości). */
function odswiez() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

// ───────────────────────── sprawdzanie i wysyłka ─────────────────────────

const telefonOk = t => {
  let v = String(t || '').replace(/[^\d+]/g, '');
  if (v.startsWith('00')) v = '+' + v.slice(2);
  if (/^\d{9}$/.test(v)) v = '+48' + v;
  if (/^48\d{9}$/.test(v)) v = '+' + v;
  return /^\+\d{8,15}$/.test(v);
};

function sprawdzKrok(krok) {
  if (krok === 'produkty' || krok === 'koszyk') return ileSztuk() ? '' : 'Wybierz co najmniej jeden produkt.';
  if (krok === 'dostawa') {
    const d = dostawa();
    if (s.oferta.wysylki.length && !d) return 'Wybierz sposób dostawy.';
    if (d?.adres && !s.adres.trim()) return czyPaczkomat(d) ? 'Wpisz numer paczkomatu.' : 'Wpisz adres dostawy.';
    return '';
  }
  if (krok === 'dane') {
    if (!s.dane.nazwa.trim()) return 'Wpisz imię i nazwisko.';
    if (!telefonOk(s.dane.telefon)) return 'Wpisz poprawny numer telefonu (9 cyfr albo z kierunkowym, np. +44…).';
    if (s.dane.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.dane.email.trim())) return 'Sprawdź adres e-mail.';
  }
  return '';
}

function pokazBlad(b) {
  toast(b, 'blad', 6000);
  const pole = /paczkomat|adres dostawy/i.test(b) ? 'adres' : /imię/i.test(b) ? 'nazwa' : /telefon/i.test(b) ? 'telefon' : /e-mail/i.test(b) ? 'email' : '';
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
  try {
    const wynik = await api('zamow', {
      kod: s.kod || '', www: $('[name=www]')?.value || '',
      klient: { nazwa: s.dane.nazwa.trim(), telefon: s.dane.telefon.trim(), email: s.dane.email.trim() },
      pozycje: pozycje().map(p => ({ symbol: p.w.s, ilosc: p.ilosc })),
      dostawa_id: d ? d.id : '', adres: d?.adres ? s.adres.trim() : '',
      forma_platnosci: d?.pobranie ? 'Pobranie' : s.forma, uwagi: s.dane.uwagi.trim(),
    });
    s.wyslane = { numer: wynik.numer, suma: wynik.suma, pobranie: Boolean(d?.pobranie) };
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

// ───────────────────────── zdarzenia ─────────────────────────

function ustawIlosc(sym, n) {
  const x = wariant(sym);
  if (!x) return;
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (x.w.q !== null && n > x.w.q) { n = x.w.q; toast(`Mamy tylko ${szt(x.w.q)}.`, '', 3000); }
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
    if (s.otwarty) { const el = $(`.produkt.otwarty`); if (el && el.getBoundingClientRect().top < 70) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  } else if (akcja === 'plus' || akcja === 'minus') {
    ustawIlosc(b.dataset.s, (s.koszyk[b.dataset.s] || 0) + (akcja === 'plus' ? 1 : -1));
    odswiez();
  } else if (akcja === 'usun') { ustawIlosc(b.dataset.s, 0); odswiez(); }
  else if (akcja === 'kategoria') { s.kategoria = b.dataset.k; s.szukaj = ''; s.otwarty = ''; s.ile = NA_STRONE; render(); window.scrollTo(0, 0); }
  else if (akcja === 'wiecej') { s.ile += NA_STRONE; odswiez(); }
  else if (akcja === 'dalej') {
    const bl = sprawdzKrok(s.krok);
    if (bl) { pokazBlad(bl); return; }
    s.krok = KROKI[KROKI.findIndex(([k]) => k === s.krok) + 1][0];
    render(); window.scrollTo(0, 0);
  } else if (akcja === 'wstecz') { s.krok = KROKI[Math.max(0, KROKI.findIndex(([k]) => k === s.krok) - 1)][0]; render(); window.scrollTo(0, 0); }
  else if (akcja === 'krok') { s.krok = b.dataset.k; render(); window.scrollTo(0, 0); }
  else if (akcja === 'wyslij') await wyslij();
  else if (akcja === 'nowe') { s.wyslane = null; render(); window.scrollTo(0, 0); }
  else if (akcja === 'kod') oknoKodu();
  else if (akcja === 'wyloguj') { s.kod = ''; s.dane = { nazwa: '', telefon: '', email: '', uwagi: '' }; s.adres = ''; await przeladuj(); }
});

document.addEventListener('input', e => {
  const pole = e.target.dataset?.pole;
  if (!pole) return;
  const v = e.target.value;
  if (pole === 'szukaj') {
    s.szukaj = v; s.otwarty = ''; s.ile = NA_STRONE;
    const slowa = norm(v).split(/\s+/).filter(Boolean);
    $('#lista').innerHTML = htmlListy(s.produkty.filter(g => (slowa.length ? slowa.every(x => g.szukaj.includes(x)) : g.kategoria === s.kategoria)));
    document.querySelectorAll('.kat').forEach(k => k.setAttribute('aria-pressed', String(!v && k.dataset.k === s.kategoria)));
  } else if (pole === 'ilosc') {
    if (v === '') return;               // pozwól wyczyścić pole i wpisać nową liczbę
    ustawIlosc(e.target.dataset.s, v);
    $('#pasek').innerHTML = htmlPaska();
  } else if (pole === 'adres') { s.adres = czyPaczkomat(dostawa()) ? v.toUpperCase() : v; zachowaj(); }
  else if (['nazwa', 'telefon', 'email', 'uwagi'].includes(pole)) { s.dane[pole] = v; zachowaj(); }
});

document.addEventListener('change', e => {
  const pole = e.target.dataset?.pole;
  if (pole === 'dostawa') { s.dostawa = e.target.value; zachowaj(); odswiez(); }
  else if (pole === 'forma') { s.forma = e.target.value; zachowaj(); }
  else if (pole === 'ilosc') { ustawIlosc(e.target.dataset.s, e.target.value); odswiez(); }
});

// ───────────────────────── kod klienta, komunikaty ─────────────────────────

async function oknoKodu() {
  const d = $('#okno');
  d.innerHTML = `<form method="dialog" class="okno-kod">
    <h2>Kod klienta</h2>
    <p>Stali klienci dostali od nas kod – po jego wpisaniu zobaczysz swoje ceny.</p>
    <label class="pole"><span>Kod</span><input name="kod" autocomplete="off" autocapitalize="characters" value="${esc(s.kod)}" placeholder="np. ABCD-1234"></label>
    <div class="przyciski"><button value="" class="drugi">Anuluj</button><button value="ok" class="glowny">Zastosuj</button></div>
  </form>`;
  d.showModal();
  d.addEventListener('close', async () => {
    if (d.returnValue !== 'ok') return;
    const kod = $('[name=kod]', d).value.trim();
    if (!kod) return;
    s.kod = kod;
    await przeladuj();
    if (s.oferta?.klient) toast(`Witaj, ${s.oferta.klient.nazwa}! Widzisz swoje ceny.`, 'ok', 4000);
  }, { once: true });
}

let toastCzas;
function toast(t, typ = '', ms = 3000) {
  const el = $('#toast');
  el.textContent = t;
  el.className = 'widoczny ' + typ;
  clearTimeout(toastCzas);
  toastCzas = setTimeout(() => { el.className = ''; }, ms);
}

async function przeladuj() {
  try {
    await wczytajOferte();
    render();
  } catch (err) {
    $('#widok').innerHTML = `<section class="krok"><h1>Nie udało się wczytać oferty</h1><p>${esc(err.message || err)}</p>
      <p><button type="button" class="glowny" onclick="location.reload()">Spróbuj ponownie</button></p></section>`;
  }
}

wczytajPamiec();
const kodZLinku = /[#&?]kod=([^&]+)/.exec(location.hash + '&' + location.search);
if (kodZLinku) {
  const nowy = decodeURIComponent(kodZLinku[1]);
  if (nowy !== s.kod) { s.dane = { nazwa: '', telefon: '', email: '', uwagi: '' }; s.adres = ''; }
  s.kod = nowy;
  history.replaceState(null, '', location.pathname);
}
przeladuj().then(() => { if (kodZLinku && s.oferta?.klient) toast(`Witaj, ${s.oferta.klient.nazwa}! Widzisz swoje ceny.`, 'ok', 5000); });
// link z innym kodem otwarty w tej samej karcie (zmienia się tylko #…) – wczytujemy od nowa
window.addEventListener('hashchange', () => { if (/[#&]kod=/.test(location.hash)) location.reload(); });
