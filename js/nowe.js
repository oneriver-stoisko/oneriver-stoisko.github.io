// Ekran „Nowe zamówienie” (#nowe) i edycja zamówienia (#edytuj/<numer>).
// Sprzedaż na miejscu albo wysyłka InPost: zrzuty z aplikacji InPost Mobile wypełniają dane klienta, paczkomat,
// numer przesyłki i kod nadania; transport (domyślnie 12 zł) jest osobną pozycją – trafi na paragon jako usługa.
// Produkty z katalogu (warianty, ceny klienta z poziomów, cena po rabacie), płatność także dzielona
// (np. część gotówką, część BLIK-iem). Zapis działa bez internetu; potem SMS/WhatsApp do klienta i wiadomość do grupy.

import { $, $$, esc, zaokr, kwotaTxt, iloscTxt, liczba, liczbaNaTekst, uuid, dataLok, toast, num, odmiana, okno } from './util.js';
import { dane, wczytaj, szukajProduktow, nastepnyNumer, zapamietajNumer, klientPoTelefonie, telefonE164, klient as klientId,
  produktSymbolu, cenaKlienta, opisCenKlienta, zamowienie, pozycjeZamowienia, ustawienieTekst } from './dane.js';
import { ustawienia, gotowe, wywolaj } from './api.js';
import { FORMY, POBRANIE, STATUSY, OSOBY_WYSYLKI, SYMBOL_TRANSPORTU, TRANSPORT_DOMYSLNY, czyTransport, symbolMagazynu, MAGAZYNY, PRZEWOZNICY, MIEDZYNARODOWY, czyInPost } from './konfiguracja.js';
import { rozpoznaj } from './inpost.js';
import * as sync from './sync.js';

const SZKIC = 'or-stoisko-szkic-2';
const ZAPLACONE_ZAWSZE = new Set(['Gotówka', 'Karta']);

const transportDomyslny = () => {
  const t = ustawienieTekst('transport_domyslny');
  return t !== '' && isFinite(liczba(t)) ? liczbaNaTekst(liczba(t)) : liczbaNaTekst(TRANSPORT_DOMYSLNY);
};
const pusty = () => ({
  tryb: 'nowe', edytowane: '', data: '', typ: 'miejsce', przewoznik: 'InPost', koszyk: [], klientId: '', telefon: '', nazwa: '', email: '', uwagi: '',
  szukaj: '', grupa: '', paczkomat: '', adres: '', nrPrzesylki: '', kodNadania: '', transportTxt: '', realizuje: '', magazyn: '',
  waluta: 'PLN', eurTxt: '', jezyk: '', oplacaOdbiorca: false, pobranieTxt: '',
  platnosci: [{ k: uuid(), forma: 'Przelew', kwotaTxt: '', zaplacone: false }],
});

let s = wczytajSzkic();
let zapisuje = false;
let ocrTrwa = false;

function wczytajSzkic() {
  try {
    const z = JSON.parse(localStorage.getItem(SZKIC));
    if (z && Array.isArray(z.koszyk)) return { ...pusty(), ...z, tryb: 'nowe', edytowane: '' };
  } catch { /* pusto */ }
  return pusty();
}
const zachowaj = () => { if (s.tryb === 'nowe') { try { localStorage.setItem(SZKIC, JSON.stringify(s)); } catch { /* bez znaczenia */ } } };

// ───────────────────────── ceny i sumy ─────────────────────────

const biezacyKlient = () => klientId(s.klientId);
const cenaBazowa = p => (p.symbol && p.cena_cennik !== '' ? cenaKlienta(biezacyKlient(), p.symbol, num(p.cena_cennik)) : NaN);

/** Cena sztuki: puste pole = cena klienta (albo z cennika); „10%” = rabat procentowy od ceny z cennika. */
function cena(p) {
  const t = String(p.cenaTxt ?? '').trim();
  const cennik = p.cena_cennik === '' ? NaN : num(p.cena_cennik);
  if (!t) return cenaBazowa(p);
  const proc = /^-?\s*(\d+(?:[.,]\d+)?)\s*%$/.exec(t);
  if (proc) return isFinite(cennik) ? zaokr(cennik * (1 - liczba(proc[1]) / 100)) : NaN;
  return zaokr(liczba(t));
}
const ilosc = p => liczba(p.iloscTxt ?? '1');
const wartosc = p => zaokr(cena(p) * ilosc(p));
const sumaProduktow = () => zaokr(s.koszyk.reduce((a, p) => a + (isFinite(wartosc(p)) ? wartosc(p) : 0), 0));
/** Poczta Polska „przesyłkę opłaca odbiorca” – klient płaci za przesyłkę przy odbiorze, więc transportu nie ma na paragonie. */
const odbiorcaPlaci = () => s.typ === 'wysylka' && s.przewoznik === 'Poczta Polska' && Boolean(s.oplacaOdbiorca);
function kosztTransportu() {
  if (s.typ !== 'wysylka' || odbiorcaPlaci()) return 0;
  const t = String(s.transportTxt ?? '').trim();
  const v = liczba(t === '' ? transportDomyslny() : t);
  return isFinite(v) ? zaokr(v) : NaN;
}
const suma = () => zaokr(sumaProduktow() + (isFinite(kosztTransportu()) ? kosztTransportu() : 0));

// ───────────────────────── euro i język wiadomości ─────────────────────────
// Zamówienie w EUR: ceny z katalogu (zł) przeliczone po kursie NBP i zaokrąglone do pełnych euro; kwotę można poprawić.
// W arkuszu zostają kwoty w złotych (paragon, rozliczenia), a obok: waluta, kurs, suma_eur.
const KLUCZ_KURSU = 'or-stoisko-kurs-eur';
const kursZapisany = () => { try { return JSON.parse(localStorage.getItem(KLUCZ_KURSU)) || null; } catch { return null; } };
let kursPobierany = false;
async function pobierzKurs() {
  if (kursPobierany || !navigator.onLine) return;
  kursPobierany = true;
  try {
    const jutro = dataLok(new Date(Date.now() + 86400000));   // tabela z dziś (NBP publikuje w dni robocze ok. 12:00)
    const w = await wywolaj('kursNBP', { waluta: 'EUR', data: jutro }, 30000);
    if (w && w.kurs > 0) {
      localStorage.setItem(KLUCZ_KURSU, JSON.stringify({ kurs: w.kurs, data: w.data_tabeli, tabela: w.tabela, pobrano: dataLok() }));
      if ($('#platnosci')) odswiezPlatnosci();
    }
  } catch { /* zostaje ostatni zapisany kurs */ } finally { kursPobierany = false; }
}
const kursEur = () => num(kursZapisany()?.kurs);
const sumaEurWyliczona = () => (kursEur() > 0 ? Math.round(suma() / kursEur()) : NaN);
function sumaEur() {
  const t = String(s.eurTxt || '').trim();
  return t ? zaokr(liczba(t)) : sumaEurWyliczona();
}
const jezykWiadomosci = () => s.jezyk || (s.waluta === 'EUR' || s.przewoznik === MIEDZYNARODOWY || (telefonE164(s.telefon) && !telefonE164(s.telefon).startsWith('+48')) ? 'en' : 'pl');
function htmlWaluty() {
  const k = kursZapisany();
  const eur = s.waluta === 'EUR';
  return `<div class="chipy male waluta">
      <button type="button" class="chip" data-akcja="waluta" data-v="PLN" aria-pressed="${!eur}">PLN</button>
      <button type="button" class="chip" data-akcja="waluta" data-v="EUR" aria-pressed="${eur}">EUR – przelew na konto w euro</button>
    </div>
    ${eur ? `<div class="eur-panel">
      <p class="podpowiedz">${k ? `Kurs NBP ${esc(String(k.kurs).replace('.', ','))} zł (tabela ${esc(k.tabela || '')} z ${esc(k.data || '')}).` : 'Pobieram kurs NBP…'}
        ${ustawienia().platnosc.kontoEur ? '' : '<b class="blad">Uzupełnij konto EUR (IBAN) w Ustawieniach.</b>'}</p>
      <label class="cena eur-kwota"><span>Do zapłaty w euro (zaokrąglone; możesz poprawić)</span>
        <input data-pole="eur" inputmode="decimal" autocomplete="off" value="${esc(s.eurTxt)}" placeholder="${esc(isFinite(sumaEurWyliczona()) ? String(sumaEurWyliczona()) : '')}"></label>
      <p class="podpowiedz">${esc(kwotaTxt(suma()))} ≈ <b id="suma-eur">${isFinite(sumaEur()) ? esc(String(sumaEur()).replace('.', ',')) + ' €' : '—'}</b></p>
    </div>` : ''}`;
}
function htmlJezyka() {
  const j = jezykWiadomosci();
  return `<span class="etykieta">Wiadomość do klienta</span>
    <div class="chipy male jezyk">${[['pl', 'po polsku'], ['en', 'po angielsku']].map(([w, e]) => `<button type="button" class="chip" data-akcja="jezyk" data-v="${w}" aria-pressed="${j === w}">${e}</button>`).join('')}</div>`;
}

function opisRabatu(p) {
  const c = cena(p);
  if (p.cena_cennik === '' || !isFinite(c)) return '';
  const r = zaokr(num(p.cena_cennik) - c);
  if (Math.abs(r) < 0.005) return '';
  if (r < 0) return `cena wyższa od cennika o ${kwotaTxt(-r)}`;
  return `rabat ${kwotaTxt(r * ilosc(p) || r)} (${Math.round((r / num(p.cena_cennik)) * 100)}%)`;
}

/** Kwoty płatności: wiersz z pustą kwotą dostaje resztę (tylko jeden może być pusty – ostatni). */
function kwotyPlatnosci() {
  const razem = suma();
  const wpisane = s.platnosci.map(p => (String(p.kwotaTxt || '').trim() === '' ? null : zaokr(liczba(p.kwotaTxt))));
  const iPusty = wpisane.lastIndexOf(null);
  const reszta = zaokr(razem - wpisane.reduce((a, v, i) => a + (i === iPusty || v === null ? 0 : v), 0));
  return s.platnosci.map((p, i) => ({ ...p, kwota: i === iPusty ? reszta : (wpisane[i] ?? 0), auto: i === iPusty }));
}
const zaplaconoNaMiejscu = kw => zaokr(kw.reduce((a, p) => a + (ZAPLACONE_ZAWSZE.has(p.forma) || p.zaplacone ? p.kwota : 0), 0));

// ───────────────────────── widok: produkty ─────────────────────────

function htmlWynikow() {
  if (!dane.produkty.length) return `<p class="pusto">Katalog jest pusty. Połącz się z internetem, żeby go pobrać, albo dodaj pozycję spoza cennika.</p>`;
  if (!s.szukaj.trim() && !s.grupa) return `<p class="podpowiedz-szukaj">Wpisz kilka liter nazwy lub symbolu – np. <b>wash 6</b>, <b>nukini</b>, <b>kuripe</b> – albo wybierz kategorię.</p>`;
  const lista = szukajProduktow(s.szukaj, s.grupa, 50);
  if (!lista.length) return `<p class="pusto">Nic nie pasuje do „${esc(s.szukaj)}”. Możesz dodać pozycję spoza cennika.</p>`;
  const wKoszyku = new Map();
  s.koszyk.forEach(p => { if (p.symbol) wKoszyku.set(p.symbol, (wKoszyku.get(p.symbol) || 0) + (ilosc(p) || 0)); });
  const k = biezacyKlient();
  const przycisk = w => {
    const c = cenaKlienta(k, w.symbol, w.cena);
    const ile = wKoszyku.get(w.symbol);
    const brak = w.stan !== null && w.stan <= 0;
    return `<button type="button" class="wariant${ile ? ' wybrany' : ''}${brak ? ' brak' : ''}" data-akcja="dodaj" data-symbol="${esc(w.symbol)}">
      <span class="w-nazwa">${esc(w.wariant || 'Dodaj')}${w.stan !== null ? ` · ${brak ? 'brak' : esc(iloscTxt(w.stan)) + ' szt.'}` : ''}</span>
      <b>${c !== w.cena ? `<s>${esc(kwotaTxt(w.cena))}</s> ` : ''}${esc(kwotaTxt(c))}</b>
      ${ile ? `<span class="w-ile">×${esc(iloscTxt(ile))}</span>` : ''}</button>`;
  };
  return `<ul class="produkty kompakt">${lista.map(p => `<li class="produkt">
      <div class="p-gora">
        <span class="p-nazwa">${esc(p.produkt)} <small>${esc(p.kategoria)}${p.warianty.length === 1 ? ' · ' + esc(p.warianty[0].symbol) : ''}</small></span>
      </div>
      <div class="warianty">${p.warianty.map(przycisk).join('')}</div>
    </li>`).join('')}</ul>`;
}

function htmlPozycji(p) {
  const c = cena(p);
  const w = wartosc(p);
  return `<li data-k="${esc(p.k)}">
    <div class="poz-gora">
      ${p.symbol
        ? `<span class="poz-nazwa">${esc(p.nazwa)}<small>${esc(p.symbol)} · cennik ${esc(kwotaTxt(num(p.cena_cennik)))}${cenaBazowa(p) !== num(p.cena_cennik) ? ' · dla klienta ' + esc(kwotaTxt(cenaBazowa(p))) : ''}</small></span>`
        : `<label class="poz-nazwa"><span class="sr">Nazwa</span><input data-pole="nazwa" value="${esc(p.nazwa)}" placeholder="Nazwa produktu" autocomplete="off"></label>`}
      <button type="button" class="usun" data-akcja="usun" aria-label="Usuń ${esc(p.nazwa || 'pozycję')}">×</button>
    </div>
    <div class="poz-dol">
      <div class="stepper">
        <button type="button" data-akcja="minus" aria-label="Mniej">−</button>
        <input data-pole="ilosc" inputmode="decimal" aria-label="Ilość" value="${esc(p.iloscTxt ?? '1')}">
        <button type="button" data-akcja="plus" aria-label="Więcej">+</button>
      </div>
      <label class="cena"><span>${p.symbol ? 'Cena szt. (po rabacie)' : 'Cena szt.'}</span>
        <input data-pole="cena" inputmode="decimal" autocomplete="off" value="${esc(p.cenaTxt ?? '')}"
          placeholder="${p.symbol ? esc(liczbaNaTekst(cenaBazowa(p))) : '0,00'}"></label>
      <b class="poz-wartosc">${isFinite(w) ? esc(kwotaTxt(w)) : '—'}</b>
    </div>
    <small class="poz-rabat${!isFinite(c) && p.cenaTxt ? ' blad' : ''}">${!isFinite(c) && p.cenaTxt ? 'Nieprawidłowa cena' : esc(opisRabatu(p))}</small>
  </li>`;
}

const htmlKoszyka = () => (s.koszyk.length
  ? `<ul class="pozycje">${s.koszyk.map(htmlPozycji).join('')}</ul>`
  : '<p class="pusto">Dotknij produktu, żeby dodać go do zamówienia.</p>');

// ───────────────────────── widok: klient, wysyłka, płatność ─────────────────────────

function opisKlienta() {
  const k = biezacyKlient();
  if (k) {
    const ceny = opisCenKlienta(k);
    return `Stały klient: ${k.nazwa || 'bez nazwy'}${k.email ? ' · ' + k.email : ''}${ceny ? ' · ' + ceny : ''}`;
  }
  if (!s.telefon) return 'Telefon jest potrzebny do wysłania SMS-a lub WhatsAppa.';
  if (!telefonE164(s.telefon)) return 'Sprawdź numer – 9 cyfr albo z kierunkowym, np. +44…';
  return 'Nowy klient – zapisze się na liście klientów.';
}

function htmlWysylki() {
  if (s.typ !== 'wysylka') return '';
  const t = kosztTransportu();
  const pp = !czyInPost(s.przewoznik);
  const chipyPrzewoznika = `<div class="chipy male przewoznik">${PRZEWOZNICY.map(([w, e]) => `<button type="button" class="chip" data-akcja="przewoznik" data-v="${esc(w)}" aria-pressed="${s.przewoznik === w}">${esc(e)}</button>`).join('')}</div>`;
  if (pp) {
    return `<article class="panel wysylka-panel">
    <header><h2>Wysyłka – ${esc(s.przewoznik)}</h2></header>
    ${chipyPrzewoznika}
    ${s.przewoznik === 'Poczta Polska' ? `<label class="przycisk szeroki zrzuty${ocrTrwa ? ' trwa' : ''}">
      <input type="file" accept="image/*" multiple data-pole="zrzuty" hidden>
      <span id="ocr-opis">${ocrTrwa ? 'Odczytuję…' : 'Wczytaj zrzut z e-nadawcy (Poczta Polska)'}</span>
    </label>` : ''}
    <p class="podpowiedz">${s.przewoznik === 'Poczta Polska' ? 'Nadaj przesyłkę w e-nadawcy, zrób zrzut ekranu formularza przesyłki (adresat + numer nadania) i wczytaj go – odbiorca, adres, telefon, e-mail i numer nadania wpiszą się same. Sprawdź je przed zapisem.' : 'Wpisz adres i numer przesyłki od przewoźnika.'}
      <button type="button" class="link" data-akcja="wyczysc-wysylke">Wyczyść dane wysyłki i klienta</button></p>
    <label class="pole"><span class="etykieta">Adres dostawy (z krajem)</span>
      <textarea data-pole="adres" rows="3" autocomplete="off" placeholder="ulica i numer, kod, miejscowość, kraj">${esc(s.adres)}</textarea></label>
    <label class="pole"><span class="etykieta">Numer nadania / przesyłki</span>
      <input data-pole="nrPrzesylki" autocomplete="off" autocapitalize="characters" value="${esc(s.nrPrzesylki)}" placeholder="np. RR123456789PL, PX1234567890"></label>
    ${s.przewoznik === 'Poczta Polska' ? `<label class="przelacznik"><input type="checkbox" data-pole="oplacaOdbiorca" ${s.oplacaOdbiorca ? 'checked' : ''}> Przesyłkę opłaca odbiorca (płaci przy odbiorze – bez transportu na paragonie)</label>` : ''}
    ${odbiorcaPlaci() ? '' : `<label class="pole"><span class="etykieta">Transport (pozycja na paragonie)</span>
      <input data-pole="transport" inputmode="decimal" autocomplete="off" value="${esc(s.transportTxt)}" placeholder="${esc(transportDomyslny())}">
      ${!isFinite(t) ? '<span class="podpowiedz blad">Sprawdź kwotę transportu.</span>' : ''}</label>`}
    ${s.platnosci.some(p => p.forma === POBRANIE) ? `<label class="pole"><span class="etykieta">Kwota pobrania wpisana w e-nadawcy (do sprawdzenia)</span>
      <input data-pole="pobranie" inputmode="decimal" autocomplete="off" value="${esc(s.pobranieTxt)}" placeholder="np. 1560,00"></label>` : ''}
    <span class="etykieta">Kto wysyła</span>
    <div class="chipy">${OSOBY_WYSYLKI.map(o => `<button type="button" class="chip" data-akcja="realizuje" data-osoba="${esc(o)}" aria-pressed="${s.realizuje === o}">${esc(o)}</button>`).join('')}</div>
  </article>`;
  }
  return `<article class="panel wysylka-panel">
    <header><h2>Wysyłka ${esc(s.przewoznik || 'InPost')}</h2></header>
    ${chipyPrzewoznika}
    <label class="przycisk szeroki zrzuty${ocrTrwa ? ' trwa' : ''}">
      <input type="file" accept="image/*" multiple data-pole="zrzuty" hidden>
      <span id="ocr-opis">${ocrTrwa ? 'Odczytuję…' : 'Wczytaj 2 zrzuty z InPost: odbiorca + etykieta'}</span>
    </label>
    <p class="podpowiedz">Zaznacz oba zrzuty naraz: 1) ekran z zapisanym odbiorcą (imię, nazwisko, telefon, e-mail, paczkomat), 2) etykietę – „Szczegóły przesyłki” (nr przesyłki, kod nadania). Dane wpiszą się w pola poniżej i w dane klienta – sprawdź je przed zapisem.
      <button type="button" class="link" data-akcja="wyczysc-wysylke">Wyczyść dane wysyłki i klienta</button></p>
    <label class="pole"><span class="etykieta">${s.przewoznik === MIEDZYNARODOWY ? 'Paczkomat / punkt za granicą' : 'Paczkomat'}</span>
      <input data-pole="paczkomat" autocomplete="off" autocapitalize="characters" value="${esc(s.paczkomat)}" placeholder="${s.przewoznik === MIEDZYNARODOWY ? 'np. FR004437' : 'np. WAWR01BAPP (puste = kurier)'}"></label>
    <label class="pole"><span class="etykieta">Adres ${s.paczkomat ? 'paczkomatu' : 'dostawy'}</span>
      <input data-pole="adres" autocomplete="off" value="${esc(s.adres)}" placeholder="ulica, kod, miejscowość"></label>
    <div class="dwa-pola">
      <label class="pole"><span class="etykieta">Numer przesyłki</span><input data-pole="nrPrzesylki" inputmode="numeric" autocomplete="off" value="${esc(s.nrPrzesylki)}"></label>
      <label class="pole"><span class="etykieta">Kod nadania</span><input data-pole="kodNadania" inputmode="numeric" autocomplete="off" value="${esc(s.kodNadania)}"></label>
    </div>
    <label class="pole"><span class="etykieta">Transport (pozycja na paragonie)</span>
      <input data-pole="transport" inputmode="decimal" autocomplete="off" value="${esc(s.transportTxt)}" placeholder="${esc(transportDomyslny())}">
      ${!isFinite(t) ? '<span class="podpowiedz blad">Sprawdź kwotę transportu.</span>' : ''}</label>
    <span class="etykieta">Kto wysyła</span>
    <div class="chipy">${OSOBY_WYSYLKI.map(o => `<button type="button" class="chip" data-akcja="realizuje" data-osoba="${esc(o)}" aria-pressed="${s.realizuje === o}">${esc(o)}</button>`).join('')}</div>
  </article>`;
}

function htmlPlatnosci() {
  const kw = kwotyPlatnosci();
  const zapl = zaplaconoNaMiejscu(kw);
  const razem = suma();
  return `${kw.map((p, i) => `<div class="platnosc" data-k="${esc(p.k)}">
      <div class="chipy male">${FORMY.filter(([w]) => w !== POBRANIE || s.typ === 'wysylka' || p.forma === POBRANIE).map(([w, e]) => `<button type="button" class="chip" data-akcja="forma" data-forma="${esc(w)}" aria-pressed="${p.forma === w}">${esc(e)}</button>`).join('')}</div>
      <div class="platnosc-dol">
        <label class="cena"><span>Kwota${p.auto ? ' (reszta)' : ''}</span>
          <input data-pole="kwota" inputmode="decimal" autocomplete="off" value="${esc(p.kwotaTxt)}" placeholder="${esc(liczbaNaTekst(p.kwota))}"></label>
        ${p.forma === POBRANIE ? '<span class="podpowiedz">klient płaci przy odbiorze</span>' : ZAPLACONE_ZAWSZE.has(p.forma) ? '<span class="znacznik-ok">zapłacone</span>'
          : `<label class="przelacznik"><input type="checkbox" data-pole="zaplacone" ${p.zaplacone ? 'checked' : ''}> zapłacone na miejscu (pokazał potwierdzenie)</label>`}
        ${kw.length > 1 ? `<button type="button" class="usun" data-akcja="usun-platnosc" aria-label="Usuń płatność">×</button>` : ''}
      </div>
    </div>`).join('')}
    <button type="button" class="link" data-akcja="podziel">+ Podziel płatność</button>
    <p class="podpowiedz" id="opis-platnosci">${razem - zapl > 0.005
      ? `Zapłacone teraz: ${kwotaTxt(zapl)} · do zapłaty: <b>${kwotaTxt(zaokr(razem - zapl))}</b> – w wiadomości będą dane do przelewu i BLIK.`
      : 'Całość zapłacona – wiadomość będzie potwierdzeniem zakupu.'}</p>`;
}

/** Magazyn zamówienia: wybrany ręcznie → przy wysyłce wg osoby wysyłającej (Grażynka = GR, Olek = INC) → z Ustawień. */
function magazynZamowienia() {
  if (s.magazyn) return s.magazyn;
  if (s.typ === 'wysylka' && s.realizuje) return s.realizuje === 'Grażynka' ? 'GR' : 'INC';
  return symbolMagazynu(ustawienia().magazyn);
}
function htmlMagazynu() {
  const m = magazynZamowienia();
  return `<span class="etykieta-mag">Magazyn:</span>${MAGAZYNY.map(([sym, e]) =>
    `<button type="button" class="chip" data-akcja="magazyn" data-mag="${sym}" aria-pressed="${m === sym}" title="${esc(e)}">${sym}${sym === 'GR' ? ' Grażynka' : sym === 'INC' ? ' Elsterska' : ''}</button>`).join('')}
    ${!s.magazyn && s.typ === 'wysylka' && s.realizuje ? `<small>wg „kto wysyła”</small>` : ''}`;
}
const odswiezMagazyn = () => { const el = $('#magazyn-zam'); if (el) el.innerHTML = htmlMagazynu(); };

export function render(arg) {
  if (!gotowe()) { location.replace('#ustawienia'); return; }
  if (s.waluta === 'EUR' && kursZapisany()?.pobrano !== dataLok()) pobierzKurs();
  if (location.hash.startsWith('#edytuj/')) {
    if (s.tryb !== 'edycja' || s.edytowane !== arg) {
      const wynik = zaladujDoEdycji(arg);
      if (!wynik) { $('#widok').innerHTML = '<section class="ekran"><h1>Nie ma takiego zamówienia</h1><p><a href="#lista">Wróć do listy</a></p></section>'; return; }
    }
  } else if (s.tryb === 'edycja') {
    s = wczytajSzkic();
  }
  const u = ustawienia();
  const edycja = s.tryb === 'edycja';
  const kontekst = [u.wydarzenie, symbolMagazynu(u.magazyn), u.podmiot].filter(Boolean).join(' · ');
  $('#widok').innerHTML = `
  <section class="ekran nowe">
    <header class="naglowek-zam">
      <div><span class="etykieta">${edycja ? 'Edycja zamówienia' : 'Nowe zamówienie'}</span><h1 class="numer">${esc(edycja ? s.edytowane : nastepnyNumer())}</h1>
        <label class="data-zam"><span>Data</span><input type="date" data-pole="data" value="${esc(s.data || dataLok())}" max="${esc(dataLok())}"></label></div>
      ${edycja ? `<span class="naglowek-akcje"><button type="button" class="zapisz-gora" data-akcja="zatwierdz" data-kanal="">Zapisz zmiany</button>
           <a class="kontekst" href="#zamowienie/${encodeURIComponent(s.edytowane)}">Porzuć zmiany</a></span>`
        : `<span class="naglowek-akcje"><a class="kontekst" href="#ustawienia" title="Zmień w Ustawieniach">${esc(kontekst || 'Ustaw wydarzenie i magazyn')}</a>
           <button type="button" class="drugorzedny maly" data-akcja="wyczysc-wszystko">Wyczyść zamówienie</button></span>`}
    </header>
    <div class="chipy typ-sprzedazy">
      <button type="button" class="chip" data-akcja="typ" data-typ="miejsce" aria-pressed="${s.typ === 'miejsce'}">Na miejscu</button>
      <button type="button" class="chip" data-akcja="typ" data-typ="wysylka" aria-pressed="${s.typ === 'wysylka'}">Wysyłka</button>
    </div>
    <div class="chipy male magazyn-zam" id="magazyn-zam">${htmlMagazynu()}</div>
    <div class="uklad-zam">
      <div class="kolumna-produkty">
        <div id="wysylka">${htmlWysylki()}</div>
        <div class="szukaj-wiersz">
          <label class="pole szukaj"><span class="sr">Szukaj produktu</span>
            <input type="search" data-pole="szukaj" value="${esc(s.szukaj)}" placeholder="Szukaj produktu: nazwa, symbol, gramatura" autocomplete="off" enterkeyhint="search"></label>
          <button type="button" class="wyczysc-szukaj" data-akcja="wyczysc-szukaj" aria-label="Wyczyść wyszukiwanie"${s.szukaj ? '' : ' hidden'}>×</button>
        </div>
        ${dane.grupy.length ? `<div class="chipy male grupy">${dane.grupy.map(g => `<button type="button" class="chip" data-akcja="grupa" data-grupa="${esc(g)}" aria-pressed="${s.grupa === g}">${esc(g)}</button>`).join('')}</div>` : ''}
        <div id="wyniki">${htmlWynikow()}</div>
        <button type="button" class="drugorzedny szeroki" data-akcja="spoza">+ Pozycja spoza cennika</button>
      </div>

      <div class="kolumna-koszyk">
        <article class="panel koszyk" id="panel-koszyka">
          <header><h2>Zamówienie</h2>${s.koszyk.length ? '<button type="button" class="link" data-akcja="wyczysc">Wyczyść</button>' : ''}</header>
          <div id="koszyk">${htmlKoszyka()}</div>
          <div class="suma"><span>Razem<small id="suma-opis">${esc(opisSumy())}</small></span><b id="suma">${esc(kwotaTxt(suma()))}</b></div>
        </article>

        <article class="panel">
          <h2>Klient</h2>
          <label class="pole"><span class="etykieta">Telefon</span>
            <input data-pole="telefon" type="tel" inputmode="tel" autocomplete="off" value="${esc(s.telefon)}" placeholder="np. 600 100 200">
            <span class="podpowiedz" id="opis-klienta">${esc(opisKlienta())}</span></label>
          <label class="pole"><span class="etykieta">Imię i nazwisko</span>
            <input data-pole="nazwa-klienta" autocomplete="off" list="lista-klientow" value="${esc(s.nazwa)}" placeholder="Wpisz albo wybierz stałego klienta">
            <datalist id="lista-klientow">${dane.klienci.filter(k => k.nazwa).map(k => `<option value="${esc(k.nazwa)}">`).join('')}</datalist></label>
          <label class="pole"><span class="etykieta">E-mail (nieobowiązkowo)</span>
            <input data-pole="email" type="email" inputmode="email" autocomplete="off" value="${esc(s.email)}"></label>
          <div id="jezyk">${htmlJezyka()}</div>
        </article>

        <article class="panel">
          <h2>Płatność</h2>
          <div id="waluta">${htmlWaluty()}</div>
          <div id="platnosci">${htmlPlatnosci()}</div>
          <label class="pole"><span class="etykieta">Uwagi (nieobowiązkowo)</span>
            <textarea data-pole="uwagi" rows="2">${esc(s.uwagi)}</textarea></label>
        </article>

        <div class="blad-zapisu" id="blad-zapisu" role="alert" hidden></div>
        <div class="zatwierdz">
          ${edycja ? `<button type="button" class="glowny" data-akcja="zatwierdz" data-kanal="">Zapisz zmiany</button>
            <button type="button" class="link" data-akcja="zatwierdz" data-kanal="sms">Zapisz i wyślij klientowi nowe podsumowanie SMS</button>`
          : `<button type="button" class="glowny" data-akcja="zatwierdz" data-kanal="sms">Zatwierdź i wyślij SMS</button>
            <button type="button" class="whatsapp" data-akcja="zatwierdz" data-kanal="wa">Zatwierdź i wyślij WhatsApp</button>
            <button type="button" class="drugorzedny" data-akcja="zatwierdz" data-kanal="email">Zatwierdź i wyślij e-mail</button>
            <button type="button" class="link" data-akcja="zatwierdz" data-kanal="">Zatwierdź bez wiadomości</button>`}
        </div>
      </div>
    </div>
    <button type="button" class="pasek-sumy" data-akcja="do-koszyka" ${s.koszyk.length ? '' : 'hidden'}>${htmlPaska()}</button>
  </section>`;
}

function opisSumy() {
  if (s.typ !== 'wysylka') return '';
  const t = kosztTransportu();
  if (odbiorcaPlaci()) return `produkty ${kwotaTxt(sumaProduktow())}, przesyłkę opłaca odbiorca`;
  return `produkty ${kwotaTxt(sumaProduktow())} + transport ${isFinite(t) ? kwotaTxt(t) : '?'}`;
}
function htmlPaska() {
  const n = s.koszyk.length;
  return `<span>${n} ${odmiana(n, 'pozycja', 'pozycje', 'pozycji')} · zobacz zamówienie ↓</span><b>${esc(kwotaTxt(suma()))}</b>`;
}
function odswiezPasek() {
  const p = $('.pasek-sumy');
  if (!p) return;
  p.hidden = !s.koszyk.length;
  p.innerHTML = htmlPaska();
}
function odswiezPlatnosci() {
  const el = document.activeElement;
  const pole = el?.dataset?.pole === 'kwota' ? el.closest('.platnosc')?.dataset.k : null;
  const pos = pole ? el.selectionStart : 0;
  $('#platnosci').innerHTML = htmlPlatnosci();
  const w = $('#waluta');
  if (w && document.activeElement?.dataset?.pole !== 'eur') w.innerHTML = htmlWaluty();
  else { const se = $('#suma-eur'); if (se) se.textContent = isFinite(sumaEur()) ? String(sumaEur()).replace('.', ',') + ' €' : '—'; }
  if (pole) { const i = $(`.platnosc[data-k="${pole}"] [data-pole="kwota"]`); i?.focus(); i?.setSelectionRange(pos, pos); }
}
function odswiezSume() {
  $('#suma').textContent = kwotaTxt(suma());
  $('#suma-opis').textContent = opisSumy();
  odswiezPasek();
  odswiezPlatnosci();
}
function odswiezWyniki() { $('#wyniki').innerHTML = htmlWynikow(); }
function odswiezWysylke() { $('#wysylka').innerHTML = htmlWysylki(); }
function odswiezKoszyk() {
  $('#koszyk').innerHTML = htmlKoszyka();
  odswiezSume();
  const nag = $('.koszyk header');
  const w = $('[data-akcja="wyczysc"]', nag);
  if (s.koszyk.length && !w) nag.insertAdjacentHTML('beforeend', '<button type="button" class="link" data-akcja="wyczysc">Wyczyść</button>');
  if (!s.koszyk.length && w) w.remove();
}
function odswiezPozycje(li, p) {
  const c = cena(p);
  const w = wartosc(p);
  $('.poz-wartosc', li).textContent = isFinite(w) ? kwotaTxt(w) : '—';
  const r = $('.poz-rabat', li);
  const zla = !isFinite(c) && String(p.cenaTxt || '').trim();
  r.textContent = zla ? 'Nieprawidłowa cena' : opisRabatu(p);
  r.classList.toggle('blad', Boolean(zla));
  odswiezSume();
}
function ustawKlienta(k) {
  const nowyId = k ? String(k.id) : '';
  if (nowyId === s.klientId) return;
  s.klientId = nowyId;
  odswiezKoszyk();
  odswiezWyniki();
}

// ───────────────────────── zrzuty InPost ─────────────────────────

async function wczytajZrzuty(pliki) {
  if (!pliki.length || ocrTrwa) return;
  ocrTrwa = true;
  odswiezWysylke();
  const opis = t => { const el = $('#ocr-opis'); if (el) el.textContent = t; };
  try {
    const { dane: d } = await rozpoznaj([...pliki], (p, t) => opis(p ? `${t} ${Math.round(p * 100)}%` : t));
    const znalezione = [];
    if (d.poczta) {
      s.przewoznik = 'Poczta Polska';
      s.paczkomat = ''; s.kodNadania = '';
      znalezione.push('Poczta Polska' + (d.krajNazwa ? ` (${d.krajNazwa})` : '') + (d.usluga ? ` – ${d.usluga}` : ''));
      if (d.oplacaOdbiorca) { s.oplacaOdbiorca = true; znalezione.push('przesyłkę opłaca odbiorca'); }
      if (d.pobranie > 0) {
        s.pobranieTxt = liczbaNaTekst(d.pobranie);
        s.platnosci = [{ k: uuid(), forma: POBRANIE, kwotaTxt: '', zaplacone: false }];
        znalezione.push(`za pobraniem ${kwotaTxt(d.pobranie)}`);
      }
    }
    if (d.nazwa) { s.nazwa = d.nazwa; znalezione.push('odbiorca'); }
    if (d.telefon) { s.telefon = d.telefon; znalezione.push('telefon'); }
    if (d.email) { s.email = d.email; znalezione.push('e-mail'); }
    if (d.paczkomat) { s.paczkomat = d.paczkomat; znalezione.push('paczkomat'); }
    if (d.adres) s.adres = d.adres;
    if (d.nrPrzesylki) { s.nrPrzesylki = d.nrPrzesylki; znalezione.push('nr przesyłki'); }
    if (d.kodNadania) { s.kodNadania = d.kodNadania; znalezione.push('kod nadania'); }
    if (d.miedzynarodowa && !d.poczta) {
      s.przewoznik = MIEDZYNARODOWY;
      if (s.waluta !== 'EUR') { s.waluta = 'EUR'; pobierzKurs(); }
      znalezione.push(`InPost International${d.kraj ? ' (' + d.kraj + ')' : ''} – płatność w EUR, wiadomość po angielsku`);
    }
    const k = klientPoTelefonie(s.telefon);
    if (k) { s.klientId = String(k.id); if (!s.email && k.email) s.email = k.email; }
    toast(znalezione.length ? `Odczytano: ${znalezione.join(', ')}. Sprawdź dane.` : 'Nie udało się odczytać danych – wpisz je ręcznie.', znalezione.length ? 'ok' : 'blad', 5000);
  } catch (e) {
    toast(e.message, 'blad', 7000);
  } finally {
    ocrTrwa = false;
    zachowaj();
    render(s.edytowane);
  }
}

// ───────────────────────── zdarzenia ─────────────────────────

const pozycjaZ = el => {
  const li = el.closest('li[data-k]');
  return li ? [li, s.koszyk.find(p => p.k === li.dataset.k)] : [null, null];
};
const platnoscZ = el => s.platnosci.find(p => p.k === el.closest('.platnosc')?.dataset.k);

function wejscie(e) {
  const pole = e.target.dataset.pole;
  if (!pole || pole === 'zrzuty') return;
  const v = e.target.value;
  if (pole === 'szukaj') { s.szukaj = v; odswiezWyniki(); const x = $('.wyczysc-szukaj'); if (x) x.hidden = !v; }
  else if (pole === 'telefon') {
    s.telefon = v;
    const k = klientPoTelefonie(v);
    if (k) {
      if (!s.nazwa && k.nazwa) { s.nazwa = k.nazwa; $('[data-pole="nazwa-klienta"]').value = k.nazwa; }
      if (!s.email && k.email) { s.email = k.email; $('[data-pole="email"]').value = k.email; }
    }
    ustawKlienta(k || (biezacyKlient() && !telefonE164(biezacyKlient().telefon) ? biezacyKlient() : null));
    $('#opis-klienta').textContent = opisKlienta();
    const j = $('#jezyk'); if (j && !s.jezyk) j.innerHTML = htmlJezyka();
  } else if (pole === 'nazwa-klienta') {
    s.nazwa = v;
    const k = dane.klienci.find(x => x.nazwa && String(x.nazwa).trim().toLowerCase() === v.trim().toLowerCase());
    if (k && String(k.id) !== s.klientId) {
      ustawKlienta(k);
      if (k.telefon) { s.telefon = telefonE164(k.telefon) || k.telefon; $('[data-pole="telefon"]').value = s.telefon; }
      if (!s.email && k.email) { s.email = k.email; $('[data-pole="email"]').value = k.email; }
      $('#opis-klienta').textContent = opisKlienta();
    }
  } else if (['email', 'uwagi', 'adres', 'nrPrzesylki', 'kodNadania'].includes(pole)) s[pole] = v;
  else if (pole === 'paczkomat') s.paczkomat = v.toUpperCase();
  else if (pole === 'pobranie') s.pobranieTxt = v;
  else if (pole === 'oplacaOdbiorca') { s.oplacaOdbiorca = e.target.checked; zachowaj(); render(); return; }
  else if (pole === 'transport') { s.transportTxt = v; $('#suma').textContent = kwotaTxt(suma()); $('#suma-opis').textContent = opisSumy(); odswiezPasek(); odswiezPlatnosci(); }
  else if (pole === 'kwota') { const p = platnoscZ(e.target); if (p) { p.kwotaTxt = v; odswiezPlatnosci(); } }
  else if (pole === 'eur') { s.eurTxt = v; const se = $('#suma-eur'); if (se) se.textContent = isFinite(sumaEur()) ? String(sumaEur()).replace('.', ',') + ' €' : '—'; }
  else if (pole === 'zaplacone') { const p = platnoscZ(e.target); if (p) { p.zaplacone = e.target.checked; odswiezPlatnosci(); } }
  else {
    const [li, p] = pozycjaZ(e.target);
    if (!p) return;
    if (pole === 'ilosc') p.iloscTxt = v;
    if (pole === 'cena') p.cenaTxt = v;
    if (pole === 'nazwa') p.nazwa = v;
    odswiezPozycje(li, p);
  }
  zachowaj();
}

function zmiana(e) {
  const pole = e.target.dataset.pole;
  if (pole === 'zrzuty') { wczytajZrzuty(e.target.files); return; }
  if (pole === 'data') {
    const v = e.target.value || '';
    s.data = s.tryb === 'edycja' ? v : (v !== dataLok() ? v : '');
    zachowaj();
    if (s.tryb === 'edycja') {
      const b = $('.zapisz-gora');
      if (b) { b.classList.add('zmieniono'); b.focus({ preventScroll: true }); }
      toast('Zmieniono datę – dotknij „Zapisz zmiany” u góry.', 'ok', 4000);
    }
    return;
  }
  if (pole === 'zaplacone') { wejscie(e); return; }
  if (pole !== 'cena') return;
  const [li, p] = pozycjaZ(e.target);
  if (!p || !/%/.test(p.cenaTxt || '')) return;
  const c = cena(p);
  if (isFinite(c)) { p.cenaTxt = liczbaNaTekst(c); e.target.value = p.cenaTxt; odswiezPozycje(li, p); zachowaj(); }
}

function dodaj(symbol) {
  const prod = produktSymbolu(symbol);
  if (!prod) return;
  const jest = s.koszyk.find(p => p.symbol === symbol && !String(p.cenaTxt || '').trim());
  if (jest) jest.iloscTxt = liczbaNaTekst((ilosc(jest) || 0) + 1);
  else s.koszyk.push({ k: uuid(), symbol, nazwa: prod.nazwa, grupa: prod.kategoria, jm: prod.jm, cena_cennik: prod.cena, iloscTxt: '1', cenaTxt: '' });
  odswiezKoszyk();
  odswiezWyniki();
  toast(`Dodano: ${prod.nazwa}`, 'ok', 1500);
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const akcja = b.dataset.akcja;
  if (akcja === 'dodaj') dodaj(b.dataset.symbol);
  else if (akcja === 'wyczysc-szukaj') {
    s.szukaj = ''; zachowaj();
    const i = $('[data-pole=szukaj]'); i.value = ''; b.hidden = true; odswiezWyniki(); i.focus();
  }
  else if (akcja === 'do-koszyka') $('#panel-koszyka').scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (akcja === 'typ') {
    s.typ = b.dataset.typ;
    $$('.typ-sprzedazy .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.typ === s.typ)));
    odswiezWysylke();
    odswiezSume();
    odswiezMagazyn();
  } else if (akcja === 'przewoznik') {
    s.przewoznik = b.dataset.v;
    if (s.przewoznik === MIEDZYNARODOWY && s.waluta !== 'EUR') { s.waluta = 'EUR'; pobierzKurs(); odswiezPlatnosci(); }
    zachowaj(); odswiezWysylke();
    const j = $('#jezyk'); if (j) j.innerHTML = htmlJezyka();
  } else if (akcja === 'waluta') {
    s.waluta = b.dataset.v;
    if (s.waluta === 'EUR') pobierzKurs(); else s.eurTxt = '';
    odswiezPlatnosci();
    const j = $('#jezyk'); if (j) j.innerHTML = htmlJezyka();
  } else if (akcja === 'jezyk') {
    s.jezyk = b.dataset.v;
    const j = $('#jezyk'); if (j) j.innerHTML = htmlJezyka();
  } else if (akcja === 'realizuje') {
    s.realizuje = s.realizuje === b.dataset.osoba ? '' : b.dataset.osoba;
    $$('[data-akcja="realizuje"]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.osoba === s.realizuje)));
    odswiezMagazyn();
  } else if (akcja === 'magazyn') {
    s.magazyn = magazynZamowienia() === b.dataset.mag && s.magazyn ? '' : b.dataset.mag;
    odswiezMagazyn(); zachowaj();
  } else if (akcja === 'grupa') {
    s.grupa = s.grupa === b.dataset.grupa ? '' : b.dataset.grupa;
    $$('.grupy .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.grupa === s.grupa)));
    odswiezWyniki();
  } else if (akcja === 'spoza') {
    s.koszyk.push({ k: uuid(), symbol: '', nazwa: '', grupa: '', jm: 'szt.', cena_cennik: '', iloscTxt: '1', cenaTxt: '' });
    odswiezKoszyk();
    $(`li[data-k="${s.koszyk[s.koszyk.length - 1].k}"] [data-pole="nazwa"]`)?.focus();
  } else if (akcja === 'usun' && b.closest('.platnosc')) {
    // obsługiwane niżej jako usun-platnosc
  } else if (akcja === 'usun' || akcja === 'minus' || akcja === 'plus') {
    const [li, p] = pozycjaZ(b);
    if (!p) return;
    if (akcja === 'usun') { s.koszyk = s.koszyk.filter(x => x !== p); odswiezKoszyk(); odswiezWyniki(); }
    else {
      const n = Math.max(1, Math.round(((ilosc(p) || 0) + (akcja === 'plus' ? 1 : -1)) * 1000) / 1000);
      p.iloscTxt = liczbaNaTekst(n);
      $('[data-pole="ilosc"]', li).value = p.iloscTxt;
      odswiezPozycje(li, p);
      odswiezWyniki();
    }
  } else if (akcja === 'wyczysc') {
    s.koszyk = [];
    odswiezKoszyk();
    odswiezWyniki();
  } else if (akcja === 'forma') {
    const p = platnoscZ(b);
    if (p) { p.forma = b.dataset.forma; if (ZAPLACONE_ZAWSZE.has(p.forma)) p.zaplacone = true; else p.zaplacone = false; odswiezPlatnosci(); }
  } else if (akcja === 'podziel') {
    // poprzednia „reszta” dostaje wyliczoną kwotę, nowy wiersz przejmuje resztę
    const kw = kwotyPlatnosci();
    s.platnosci.forEach((p, i) => { if (kw[i].auto) p.kwotaTxt = liczbaNaTekst(kw[i].kwota); });
    const uzyte = new Set(s.platnosci.map(p => p.forma));
    const forma = ['Gotówka', 'BLIK', 'Przelew', 'Karta'].find(f => !uzyte.has(f)) || 'Gotówka';
    s.platnosci.push({ k: uuid(), forma, kwotaTxt: '', zaplacone: ZAPLACONE_ZAWSZE.has(forma) });
    const ost = s.platnosci[s.platnosci.length - 2];
    ost.kwotaTxt = '';   // pierwsza część do wpisania, ostatnia liczy się sama
    odswiezPlatnosci();
    $(`.platnosc[data-k="${ost.k}"] [data-pole="kwota"]`)?.focus();
  } else if (akcja === 'usun-platnosc') {
    const p = platnoscZ(b);
    s.platnosci = s.platnosci.filter(x => x !== p);
    if (s.platnosci.length === 1) s.platnosci[0].kwotaTxt = '';
    odswiezPlatnosci();
  } else if (akcja === 'wyczysc-wysylke') {
    Object.assign(s, { paczkomat: '', adres: '', nrPrzesylki: '', kodNadania: '', klientId: '', telefon: '', nazwa: '', email: '' });
    zachowaj();
    render();
    toast('Wyczyszczono dane wysyłki i klienta.', 'ok', 2000);
    return;
  } else if (akcja === 'wyczysc-wszystko') {
    if (!(await okno('Wyczyścić zamówienie?', '<p>Znikną produkty, dane klienta, wysyłki i płatności z tego szkicu. Zapisane zamówienia zostają bez zmian.</p>',
      [{ etykieta: 'Zostaw', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Wyczyść', wartosc: true, klasa: 'niebezpieczny' }]))) return;
    s = { ...pusty(), typ: s.typ, realizuje: s.realizuje };
    zachowaj();
    render();
    return;
  } else if (akcja === 'zatwierdz') {
    await zatwierdz(b.dataset.kanal, b);
    return;
  }
  zachowaj();
}

// ───────────────────────── edycja ─────────────────────────

function zaladujDoEdycji(id) {
  const z = zamowienie(id);
  if (!z) return false;
  const poz = pozycjeZamowienia(z.id);
  const k = klientId(z.klient_id);
  const trans = poz.find(p => czyTransport(p.symbol));
  let platnosci = [];
  try { platnosci = JSON.parse(z.platnosci || '[]'); } catch { /* starsze zamówienie */ }
  if (!platnosci.length) platnosci = [{ forma: ['Mieszana', ''].includes(z.forma_platnosci) ? 'Przelew' : z.forma_platnosci, kwota: num(z.suma_brutto), zaplacone: z.status === STATUSY.oplacone }];
  const [paczkomat, ...resztaAdresu] = /^[A-Z]{2,3}[A-Z0-9]{2,9}(,|$)/.test(String(z.adres_dostawy || '')) ? String(z.adres_dostawy).split(/,\s*/) : ['', z.adres_dostawy || ''];
  s = {
    ...pusty(), tryb: 'edycja', edytowane: z.id, typ: z.typ === 'wysylka' || trans || z.dostawa ? 'wysylka' : 'miejsce',
    koszyk: poz.filter(p => !czyTransport(p.symbol)).map(p => ({
      k: uuid(), posId: p.id, symbol: p.symbol || '', nazwa: p.nazwa, grupa: p.kategoria || '', jm: p.jm || 'szt.',
      cena_cennik: p.cena_cennik === '' ? '' : num(p.cena_cennik), iloscTxt: liczbaNaTekst(num(p.ilosc)),
      cenaTxt: p.symbol && p.cena_cennik !== '' && num(p.cena) === cenaKlienta(k, p.symbol, num(p.cena_cennik)) ? '' : liczbaNaTekst(num(p.cena)),
    })),
    transPosId: trans?.id || '', transportTxt: trans ? liczbaNaTekst(num(trans.cena)) : (num(z.koszt_dostawy) ? liczbaNaTekst(num(z.koszt_dostawy)) : ''),
    klientId: k ? String(k.id) : '', telefon: k?.telefon || '', nazwa: k?.nazwa || '', email: k?.email || '', uwagi: z.uwagi || '',
    przewoznik: z.przewoznik || (/poczta/i.test(z.dostawa || '') ? 'Poczta Polska' : 'InPost'),
    paczkomat: !czyInPost(z.przewoznik) ? '' : paczkomat,
    adres: !czyInPost(z.przewoznik) ? String(z.adres_dostawy || '') : resztaAdresu.join(', '),
    oplacaOdbiorca: z.oplaca_odbiorca === 'tak', pobranieTxt: (() => { const p = platnosci.find(x => x.forma === POBRANIE); return p ? liczbaNaTekst(num(p.kwota)) : ''; })(),
    waluta: z.waluta === 'EUR' ? 'EUR' : 'PLN', eurTxt: z.waluta === 'EUR' && z.suma_eur !== '' && z.suma_eur != null ? liczbaNaTekst(num(z.suma_eur)) : '', jezyk: z.jezyk || '', nrPrzesylki: z.nr_przesylki || '', kodNadania: z.kod_nadania || '', realizuje: z.realizuje || '', magazyn: z.magazyn ? symbolMagazynu(z.magazyn) : '', data: String(z.data || '').slice(0, 10),
    platnosci: platnosci.map((p, i) => ({ k: uuid(), forma: p.forma, kwotaTxt: i === platnosci.length - 1 ? '' : liczbaNaTekst(num(p.kwota)), zaplacone: Boolean(p.zaplacone) })),
  };
  return true;
}

// ───────────────────────── zapis ─────────────────────────

function sprawdz(kanal) {
  if (!s.koszyk.length) return 'Dodaj przynajmniej jeden produkt.';
  for (const p of s.koszyk) {
    if (!String(p.nazwa || '').trim()) return 'Wpisz nazwę pozycji spoza cennika.';
    if (!(ilosc(p) > 0)) return `Sprawdź ilość: ${p.nazwa}.`;
    if (!isFinite(cena(p)) || cena(p) < 0) return `Sprawdź cenę: ${p.nazwa}.`;
  }
  if (s.typ === 'wysylka') {
    if (!isFinite(kosztTransportu()) || kosztTransportu() < 0) return 'Sprawdź kwotę transportu.';
    const naPobranie = kwotyPlatnosci().filter(p => p.forma === POBRANIE).reduce((a, p) => a + p.kwota, 0);
    if (naPobranie > 0 && String(s.pobranieTxt || '').trim() && Math.abs(liczba(s.pobranieTxt) - naPobranie) > 0.009) {
      return `Kwota pobrania w e-nadawcy (${kwotaTxt(liczba(s.pobranieTxt))}) różni się od kwoty „za pobraniem” w zamówieniu (${kwotaTxt(zaokr(naPobranie))}). Popraw produkty lub kwotę – albo przesyłkę w e-nadawcy.`;
    }
    if (czyInPost(s.przewoznik) && !s.paczkomat.trim() && !s.adres.trim()) return 'Wpisz paczkomat albo adres dostawy.';
    if (!czyInPost(s.przewoznik) && !s.adres.trim()) return 'Wpisz adres dostawy.';
  }
  if (s.telefon && !telefonE164(s.telefon)) return 'Sprawdź numer telefonu klienta.';
  if (kanal === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) return 'Wpisz e-mail klienta, żeby wysłać wiadomość e-mailem.';
  if (kanal && kanal !== 'email' && !telefonE164(s.telefon)) return `Wpisz telefon klienta, żeby wysłać ${kanal === 'wa' ? 'WhatsApp' : 'SMS'}.`;
  if (s.waluta === 'EUR' && !(sumaEur() > 0)) return navigator.onLine ? 'Brak kursu euro – wpisz kwotę w euro albo spróbuj za chwilę.' : 'Bez internetu nie ma kursu euro – wpisz kwotę w euro ręcznie.';
  if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) return 'Sprawdź adres e-mail.';
  const kw = kwotyPlatnosci();
  if (kw.some(p => !isFinite(p.kwota) || p.kwota < 0)) return 'Sprawdź kwoty płatności – suma części nie może przekraczać kwoty zamówienia.';
  if (Math.abs(kw.reduce((a, p) => a + p.kwota, 0) - suma()) > 0.009) return 'Kwoty płatności nie sumują się do kwoty zamówienia.';
  return '';
}

/** Zapisuje bieżące zamówienie (stan „s”) do kolejki synchronizacji. Zwraca numer, tryb edycji i zapisane wiersze. */
async function zapiszStan() {
    const u = ustawienia();
    const edycja = s.tryb === 'edycja';
    const stare = edycja ? zamowienie(s.edytowane) : null;
    const numer = edycja ? s.edytowane : nastepnyNumer();
    const paczki = { KLIENCI: [], ZAMOWIENIA: [], ZAMOWIENIA_POZ: [] };

    // klient: wybrany, po telefonie albo e-mailu, inaczej nowy
    let klientIdZ = '';
    let nowy = '';
    const tel = telefonE164(s.telefon);
    const email = s.email.trim();
    const nazwa = s.nazwa.trim();
    const adresKlienta = s.typ === 'wysylka' ? [s.paczkomat.trim(), s.adres.trim()].filter(Boolean).join(', ') : '';
    if (tel || nazwa || email) {
      const k = biezacyKlient() || (tel && klientPoTelefonie(tel)) || (email && dane.klienci.find(x => String(x.email || '').toLowerCase() === email.toLowerCase())) || null;
      if (k) {
        klientIdZ = k.id;
        const uzup = {};
        if (!k.nazwa && nazwa) uzup.nazwa = nazwa;
        if (!k.email && email) uzup.email = email;
        if (!k.telefon && tel) uzup.telefon = tel;
        if (adresKlienta && k.adres !== adresKlienta) uzup.adres = adresKlienta;
        if (Object.keys(uzup).length) paczki.KLIENCI.push({ ...k, ...uzup });
      } else {
        klientIdZ = uuid();
        nowy = 'tak';
        paczki.KLIENCI.push({ id: klientIdZ, symbol_sgt: '', nazwa, nip: '', email, telefon: tel, miasto: '', zrodlo: 'stoisko', adres: adresKlienta });
      }
    }

    // pozycje: przy edycji zostają dotychczasowe numery, usunięte dostają status „usunięta”
    const istniejace = edycja ? pozycjeZamowienia(numer) : [];
    let nastepny = Math.max(0, ...istniejace.map(p => Number(String(p.id).split('-').pop()) || 0)) + 1;
    const noweId = () => `${numer}-${nastepny++}`;
    const wierszPoz = (id, p) => {
      const c = cena(p);
      const cennik = p.cena_cennik === '' ? '' : num(p.cena_cennik);
      return { id, zamowienie_id: numer, symbol: p.symbol, nazwa: String(p.nazwa).trim(), kategoria: p.grupa || '', podkategoria: '',
        ilosc: ilosc(p), jm: p.jm || 'szt.', cena_cennik: cennik, cena: c, cena_reczna: cennik === '' || Math.abs(cennik - c) >= 0.005,
        wartosc: wartosc(p), status: '' };
    };
    const uzyteId = new Set();
    s.koszyk.forEach(p => {
      const id = p.posId && istniejace.some(x => x.id === p.posId) ? p.posId : noweId();
      uzyteId.add(id);
      paczki.ZAMOWIENIA_POZ.push(wierszPoz(id, p));
    });
    const transport = kosztTransportu();
    if (s.typ === 'wysylka' && !odbiorcaPlaci()) {
      const id = s.transPosId && istniejace.some(x => x.id === s.transPosId) ? s.transPosId : noweId();
      uzyteId.add(id);
      paczki.ZAMOWIENIA_POZ.push({ id, zamowienie_id: numer, symbol: SYMBOL_TRANSPORTU, nazwa: 'Transport', kategoria: 'Usługi', podkategoria: '',
        ilosc: 1, jm: 'szt.', cena_cennik: '', cena: transport, cena_reczna: false, wartosc: transport, status: '' });
    }
    istniejace.filter(p => !uzyteId.has(p.id)).forEach(p => paczki.ZAMOWIENIA_POZ.push({ ...p, status: 'usunięta' }));

    const kw = kwotyPlatnosci();
    const zapl = zaplaconoNaMiejscu(kw);
    const razem = suma();
    const formy = [...new Set(kw.filter(p => p.kwota > 0).map(p => p.forma))];
    const sumaFormy = f => zaokr(kw.filter(p => p.forma === f).reduce((a, p) => a + p.kwota, 0));
    const wysylka = s.typ === 'wysylka';
    paczki.ZAMOWIENIA.push({
      ...(stare || {}),
      id: numer, urzadzenie: stare?.urzadzenie || u.kto, podmiot: stare?.podmiot || u.podmiot, zrodlo: stare?.zrodlo || 'stoisko',
      data: s.data || stare?.data || dataLok(), klient_id: klientIdZ, klient_nowy: stare ? stare.klient_nowy : nowy,
      wydarzenie: stare?.wydarzenie ?? u.wydarzenie, wydarzenie_id: stare ? (stare.wydarzenie_id || '') : (u.wydarzenie_id || ''), magazyn: magazynZamowienia(),
      typ: wysylka ? 'wysylka' : 'miejsce',
      forma_platnosci: formy.length > 1 ? 'Mieszana' : (formy[0] || kw[0].forma),
      platnosci: JSON.stringify(kw.map(p => ({ forma: p.forma, kwota: p.kwota, zaplacone: ZAPLACONE_ZAWSZE.has(p.forma) || Boolean(p.zaplacone) }))),
      kw_gotowka: sumaFormy('Gotówka'), kw_blik: sumaFormy('BLIK'), kw_przelew: zaokr(sumaFormy('Przelew') + sumaFormy(POBRANIE)), kw_karta: sumaFormy('Karta'),
      zaplacono: zapl, suma_brutto: razem, wartosc_produktow: sumaProduktow(),
      dostawa_id: '', dostawa: wysylka ? (!czyInPost(s.przewoznik) ? s.przewoznik : (s.paczkomat.trim() ? 'Paczkomat ' : 'Kurier ') + (s.przewoznik || 'InPost')) : '',
      przewoznik: wysylka ? s.przewoznik : '', oplaca_odbiorca: odbiorcaPlaci() ? 'tak' : '',
      koszt_dostawy: wysylka ? transport : 0,
      adres_dostawy: wysylka ? (!czyInPost(s.przewoznik) ? s.adres.trim() : [s.paczkomat.trim(), s.adres.trim()].filter(Boolean).join(', ')) : '',
      waluta: s.waluta === 'EUR' ? 'EUR' : '', kurs: s.waluta === 'EUR' ? (stare?.waluta === 'EUR' && stare.kurs ? stare.kurs : kursEur() || '') : '', suma_eur: s.waluta === 'EUR' ? sumaEur() : '',
      jezyk: jezykWiadomosci(),
      nr_przesylki: wysylka ? s.nrPrzesylki.trim() : '', kod_nadania: wysylka ? s.kodNadania.trim() : '',
      realizuje: wysylka ? s.realizuje : '',
      status: stare?.status === STATUSY.anulowane ? stare.status : (zapl >= razem - 0.005 ? STATUSY.oplacone : STATUSY.czeka),
      nr_dok_sgt: stare?.nr_dok_sgt || '', uwagi: s.uwagi.trim(),
    });

    await sync.zapisz(Object.entries(paczki).map(([karta, wiersze]) => ({ karta, wiersze })));
    if (!edycja) zapamietajNumer(numer);
    await wczytaj();
    return { numer, edycja, paczki };
}

/**
 * Zapis z prostego ekranu (tryb Grażynki): sprzedaż na miejscu.
 * koszyk – pozycje w formacie ekranu „Nowe” ({ symbol, nazwa, grupa, jm, cena_cennik, iloscTxt, cenaTxt }).
 * platnosci – [{ forma, kwotaTxt, zaplacone }]; ostatnia bez kwoty = reszta (podzielona płatność).
 */
export async function zapiszProste({ koszyk, forma, zaplacone, platnosci, telefon, nazwa, magazyn }) {
  const poprzedni = s;
  s = { ...pusty(), typ: 'miejsce', magazyn: magazyn || '', telefon: telefon || '', nazwa: nazwa || '',
    koszyk: koszyk.map(p => ({ k: uuid(), posId: '', ...p })),
    platnosci: (platnosci && platnosci.length ? platnosci : [{ forma, kwotaTxt: '', zaplacone }])
      .map((x, i, l) => ({ k: uuid(), forma: x.forma, kwotaTxt: i === l.length - 1 ? '' : String(x.kwotaTxt || ''), zaplacone: Boolean(x.zaplacone) })) };
  try {
    const blad = sprawdz('');
    if (blad) throw new Error(blad);
    return (await zapiszStan()).numer;
  } finally {
    s = poprzedni;
  }
}

/** Błąd widoczny przy przyciskach (zostaje, dopóki go nie poprawisz) + komunikat i przejście do pola. */
function pokazBlad(blad) {
  const el = $('#blad-zapisu');
  if (el) { el.textContent = blad; el.hidden = !blad; }
  if (!blad) return;
  toast(blad, 'blad', 7000);
  const pole = /telefon/i.test(blad) ? 'telefon' : /e-mail/i.test(blad) ? 'email' : /paczkomat|adres/i.test(blad) ? 'paczkomat' : '';
  const p = pole && $(`[data-pole="${pole}"]`);
  if (p) { p.scrollIntoView({ block: 'center' }); p.focus(); p.classList.add('pole-blad'); setTimeout(() => p.classList.remove('pole-blad'), 4000); }
}

async function zatwierdz(kanal, przycisk) {
  if (zapisuje) return;
  const blad = sprawdz(kanal);
  pokazBlad(blad);
  if (blad) return;
  zapisuje = true;
  przycisk.disabled = true;
  try {
    const { numer, edycja, paczki } = await zapiszStan();
    if (edycja) {
      s = wczytajSzkic();
    } else {
      const forma = s.platnosci[0]?.forma || 'Przelew';
      s = { ...pusty(), typ: s.typ, przewoznik: s.przewoznik, realizuje: s.realizuje, waluta: s.waluta, platnosci: [{ k: uuid(), forma, kwotaTxt: '', zaplacone: ZAPLACONE_ZAWSZE.has(forma) }] };
      zachowaj();
    }
    const ile = paczki.ZAMOWIENIA_POZ.filter(p => p.status !== 'usunięta').length;
    toast(`${edycja ? 'Zapisano zmiany' : 'Zapisano zamówienie'} ${numer} (${ile} ${odmiana(ile, 'pozycja', 'pozycje', 'pozycji')}).`, 'ok');
    location.hash = `#zamowienie/${encodeURIComponent(numer)}${kanal ? '/' + kanal : ''}`;
  } catch (err) {
    console.error(err);
    pokazBlad('Nie udało się zapisać zamówienia: ' + (err?.message || err) + ' – spróbuj jeszcze raz; jeśli się powtarza, wyślij zrzut tego komunikatu.');
  } finally {
    zapisuje = false;
    przycisk.disabled = false;
  }
}

export const ekran = { render, klik, wejscie, zmiana };
