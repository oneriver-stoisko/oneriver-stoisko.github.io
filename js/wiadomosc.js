// Treść podsumowania dla klienta oraz linki otwierające SMS i WhatsApp z gotową wiadomością.
// Wiadomość wysyła sprzedawca z telefonu – SMS działa także bez internetu (przez sieć komórkową).

import { ustawienia } from './api.js';
import { PLATNE_POZNIEJ, czyTransport, linkSledzeniaPrzewoznika, MIEDZYNARODOWY, czyInPost } from './konfiguracja.js';
import { kwotaTxt, iloscTxt, num } from './util.js';
import { telefonE164, klient } from './dane.js';

export const linkSledzenia = (nr, przewoznik = 'InPost') => linkSledzeniaPrzewoznika(przewoznik, nr);

const MAKS_POZYCJI = 8;
const produkty = pozycje => pozycje.filter(p => !czyTransport(p.symbol));

/** Płatności zamówienia: z kolumny „platnosci” (JSON), a dla starszych zamówień – z formy płatności i statusu. */
export function platnosciZamowienia(zam) {
  try {
    const l = JSON.parse(zam.platnosci || '[]');
    if (Array.isArray(l) && l.length) return l.map(p => ({ forma: p.forma, kwota: num(p.kwota), zaplacone: Boolean(p.zaplacone) }));
  } catch { /* starsze */ }
  return [{ forma: zam.forma_platnosci || 'Przelew', kwota: num(zam.suma_brutto), zaplacone: zam.status === 'opłacone' || !PLATNE_POZNIEJ.has(zam.forma_platnosci) }];
}
const doZaplatyPrzed = pl => pl.filter(p => !p.zaplacone).reduce((a, p) => a + p.kwota, 0);
const wDopelniaczu = f => ({ Gotówka: 'gotówką', Karta: 'kartą', BLIK: 'BLIK-iem', Przelew: 'przelewem' }[f] || String(f || '').toLowerCase());

/** Język wiadomości: zapisany przy zamówieniu, a gdy go brak – angielski dla InPost International i płatności w EUR. */
export const jezykZamowienia = zam => zam.jezyk === 'en' || zam.jezyk === 'pl' ? zam.jezyk
  : (zam.waluta === 'EUR' || zam.przewoznik === MIEDZYNARODOWY ? 'en' : 'pl');

/** Kwota w euro: „€ 125” albo „€ 125.50”. */
export const euroTxt = (k, en = true) => {
  const n = Math.round(num(k) * 100) / 100;
  const t = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return en ? `€${t}` : `${t.replace('.', ',')} €`;
};

export function tematWiadomosci(zam) {
  return jezykZamowienia(zam) === 'en' ? `ONE RIVER – order ${zam.id}` : `ONE RIVER – zamówienie ${zam.id}`;
}

/** Wiadomość po angielsku (klienci zagraniczni). Przy płatności w EUR ceny podajemy łącznie w euro. */
function trescEN(zam, pozycje) {
  const { platnosc } = ustawienia();
  const eur = zam.waluta === 'EUR';
  const linie = [`ONE RIVER – order ${zam.id}`, ''];
  const prod = produkty(pozycje);
  prod.slice(0, MAKS_POZYCJI).forEach(p => {
    const ilosc = num(p.ilosc);
    linie.push(eur ? `${p.nazwa}${ilosc === 1 ? '' : ' × ' + iloscTxt(ilosc)}` : `${p.nazwa}: ${ilosc === 1 ? '' : iloscTxt(ilosc) + ' × '}${kwotaTxt(num(p.cena))}`);
  });
  if (prod.length > MAKS_POZYCJI) linie.push(`…and ${prod.length - MAKS_POZYCJI} more`);
  if (zam.dostawa) {
    const koszt = num(zam.koszt_dostawy);
    const nazwa = zam.przewoznik === MIEDZYNARODOWY || czyInPost(zam.przewoznik) ? zam.przewoznik || 'InPost' : zam.dostawa;
    linie.push(eur ? `Shipping – ${nazwa}${koszt ? '' : ': free'}` : `Shipping – ${nazwa}: ${koszt ? kwotaTxt(koszt) : 'free'}`);
    if (zam.adres_dostawy) linie.push(`${/paczkomat/i.test(zam.dostawa) ? 'Parcel locker / pickup point' : 'Address'}: ${String(zam.adres_dostawy).replace(/\s*\n\s*/g, ', ')}`);
    if (zam.nr_przesylki) {
      const link = linkSledzenia(zam.nr_przesylki, zam.przewoznik || 'InPost');
      linie.push(`Tracking number: ${zam.nr_przesylki}`);
      if (link) linie.push(`Track your parcel: ${link}`);
      if (czyInPost(zam.przewoznik) && /@/.test(klient(zam.klient_id)?.email || '')) linie.push('We will email you when the parcel has been sent.');
    }
  }
  linie.push(`Total: ${eur ? euroTxt(zam.suma_eur) : kwotaTxt(num(zam.suma_brutto))}`, '');

  const pl = platnosciZamowienia(zam);
  const doZaplaty = pl.filter(p => !p.zaplacone).reduce((a, p) => a + p.kwota, 0);
  if (doZaplaty <= 0.005) linie.push('Paid – thank you!');
  else if (eur) {
    linie.push(`To pay: ${euroTxt(zam.suma_eur)} by bank transfer (EUR)`);
    if (platnosc.odbiorcaEur || platnosc.odbiorca) linie.push(`Recipient: ${platnosc.odbiorcaEur || platnosc.odbiorca}`);
    if (platnosc.kontoEur) linie.push(`IBAN: ${platnosc.kontoEur}`);
    if (platnosc.swift) linie.push(`BIC/SWIFT: ${platnosc.swift}`);
    linie.push('Please put the order number in the transfer title:', zam.id);
  } else {
    linie.push(`To pay: ${kwotaTxt(Math.round(doZaplaty * 100) / 100)}`);
    if (platnosc.konto) linie.push(`• bank transfer: ${platnosc.odbiorca}, account ${platnosc.konto}`);
    if (platnosc.blik) linie.push(`• BLIK (Polish mobile payment) to: ${platnosc.blik}`);
    linie.push('Please put the order number in the transfer title:', zam.id);
  }
  linie.push('', 'Thank you! oneriver.pl');
  return linie.join('\n');
}

export function trescWiadomosci(zam, pozycje) {
  if (jezykZamowienia(zam) === 'en') return trescEN(zam, pozycje);
  const { platnosc } = ustawienia();
  const eur = zam.waluta === 'EUR';
  const linie = [`ONE RIVER – zamówienie ${zam.id}`, ''];
  const prod = produkty(pozycje);
  prod.slice(0, MAKS_POZYCJI).forEach(p => {
    const ilosc = num(p.ilosc);
    linie.push(eur ? `${p.nazwa}${ilosc === 1 ? '' : ' × ' + iloscTxt(ilosc)}` : `${p.nazwa}: ${ilosc === 1 ? '' : iloscTxt(ilosc) + ' × '}${kwotaTxt(num(p.cena))}`);
  });
  if (prod.length > MAKS_POZYCJI) linie.push(`…i jeszcze ${prod.length - MAKS_POZYCJI} poz.`);
  if (zam.dostawa) {
    const koszt = num(zam.koszt_dostawy);
    linie.push(eur ? `Dostawa – ${zam.dostawa}${koszt ? '' : ': gratis'}` : `Dostawa – ${zam.dostawa}: ${koszt ? kwotaTxt(koszt) : 'gratis'}`);
    if (zam.adres_dostawy) linie.push(`${/paczkomat/i.test(zam.dostawa) ? 'Paczkomat' : 'Adres'}: ${String(zam.adres_dostawy).replace(/\s*\n\s*/g, ', ')}`);
    if (zam.nr_przesylki) {
      const przew = zam.przewoznik || 'InPost';
      const link = linkSledzenia(zam.nr_przesylki, przew);
      linie.push(`Nr przesyłki${przew === 'Inny' ? '' : ' ' + przew}: ${zam.nr_przesylki}`);
      if (link) linie.push(`Śledzenie: ${link}`);
      if (czyInPost(przew) && /@/.test(klient(zam.klient_id)?.email || '')) linie.push('Gdy paczka zostanie nadana w paczkomacie, wyślemy Ci e-mail.');
    }
  }
  linie.push(`Razem: ${eur ? euroTxt(zam.suma_eur, false) : kwotaTxt(num(zam.suma_brutto))}`, '');

  const pl = platnosciZamowienia(zam);
  const zaplacone = pl.filter(p => p.zaplacone && p.kwota > 0);
  const doZaplaty = pl.filter(p => !p.zaplacone).reduce((a, p) => a + p.kwota, 0);
  if (zaplacone.length && !eur) linie.push(`Zapłacono: ${zaplacone.map(p => `${kwotaTxt(p.kwota)} ${wDopelniaczu(p.forma)}`).join(', ')}.`);
  if (eur && doZaplatyPrzed(pl) <= 0.005) linie.push('Zapłacono – dziękujemy!');
  if (doZaplaty > 0.005 && eur) {
    linie.push(`Do zapłaty: ${euroTxt(zam.suma_eur, false)} – przelew w euro`);
    if (platnosc.odbiorcaEur || platnosc.odbiorca) linie.push(`Odbiorca: ${platnosc.odbiorcaEur || platnosc.odbiorca}`);
    if (platnosc.kontoEur) linie.push(`IBAN: ${platnosc.kontoEur}`);
    if (platnosc.swift) linie.push(`BIC/SWIFT: ${platnosc.swift}`);
    linie.push('Prosimy wpisać w tytule przelewu numer zamówienia:', zam.id);
  } else if (doZaplaty > 0.005) {
    linie.push(`Do zapłaty: ${kwotaTxt(Math.round(doZaplaty * 100) / 100)}`);
    if (platnosc.konto) linie.push(`• przelew: ${platnosc.odbiorca}, nr konta ${platnosc.konto}`);
    if (platnosc.blik) linie.push(`• BLIK na telefon: ${platnosc.blik}`);
    // numer w osobnej linii – klient kopiuje go jednym przytrzymaniem
    linie.push('Prosimy wpisać w tytule przelewu numer zamówienia:', zam.id);
  }
  linie.push('', 'Dziękujemy! oneriver.pl');
  return linie.join('\n');
}

const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mobilne = () => ios() || /Android/i.test(navigator.userAgent);

/** sms: – iOS przyjmuje treść po „&body=”, Android po „?body=”. */
export function linkSms(telefon, tresc) {
  const nr = telefonE164(telefon);
  return `sms:${nr}${ios() ? '&' : '?'}body=${encodeURIComponent(tresc)}`;
}

/** Na telefonie i tablecie otwiera aplikację WhatsApp bezpośrednio (działa też bez internetu – wiadomość czeka w WhatsAppie). */
export function linkWhatsApp(telefon, tresc) {
  const cyfry = telefonE164(telefon).replace('+', '');
  return mobilne()
    ? `whatsapp://send?phone=${cyfry}&text=${encodeURIComponent(tresc)}`
    : `https://wa.me/${cyfry}?text=${encodeURIComponent(tresc)}`;
}

/** Wiadomość dla osoby wysyłającej (grupa ZAMÓWIENIA na Messengerze albo WhatsApp). */
export function trescDlaWysylki(zam, pozycje, klient) {
  const linie = [`Zamówienie ${zam.id} – do wysyłki`, `Klient: ${klient?.nazwa || '—'}`, 'Produkty:'];
  produkty(pozycje).forEach(p => linie.push(`• ${p.nazwa}${num(p.ilosc) === 1 ? '' : ' × ' + iloscTxt(num(p.ilosc))}`));
  if (zam.kod_nadania) linie.push(`Kod nadania: ${zam.kod_nadania}`);
  if (zam.realizuje) linie.push(`Wysyła: ${zam.realizuje}`);
  if (zam.uwagi) linie.push(`Uwagi: ${zam.uwagi}`);
  return linie.join('\n');
}

/** E-mail: otwiera aplikację pocztową w telefonie z gotowym tematem i treścią (wysyłasz ze swojej skrzynki). */
export const linkEmail = (adres, temat, tresc) =>
  `mailto:${encodeURIComponent(String(adres || '').trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(temat)}&body=${encodeURIComponent(tresc)}`;

/** WhatsApp bez numeru – otwiera wybór czatu (np. grupy) z gotową wiadomością. */
export const linkWhatsAppDoGrupy = tresc => `https://wa.me/?text=${encodeURIComponent(tresc)}`;

/** Otwiera link przez kliknięcie w niewidoczny odnośnik – działa z aplikacjami SMS i WhatsApp na telefonach. */
export function otworzLink(href) {
  const a = document.createElement('a');
  a.href = href;
  if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
