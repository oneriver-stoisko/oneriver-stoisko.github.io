// Stałe aplikacji stoiska. Dane do płatności są domyślne dla wszystkich urządzeń;
// na danym urządzeniu można je zmienić w Ustawieniach.

export const WERSJA = '0.8.0';

// Stoisko ma własny adres (osobna „strona” dla telefonu – inaczej Chrome na Androidzie myli je z Finansami).
export const ADRES_STOISKA = 'https://oneriver-stoisko.github.io/';
export const WYMAGANE_API = 9; // tryb prosty (Grażynka) wymaga API 11

// Transport przy wysyłce: osobna pozycja zamówienia (na paragonie usługa) – symbol z Subiekta i domyślna kwota.
export const SYMBOL_TRANSPORTU = 'TRAN';
// Starsze zamówienia (do 0.4.5) miały transport pod symbolem TRANS.
export const czyTransport = symbol => symbol === 'TRAN' || symbol === 'TRANS';
export const TRANSPORT_DOMYSLNY = 12;

// Publiczny formularz zamówień dla klientów (link do wysłania klientowi).
export const ADRES_FORMULARZA = 'https://szczechu699.github.io/oneriver-finanse/zamow/';

export const PLATNOSC_DOMYSLNA = {
  odbiorca: 'Darius',
  konto: '96 1140 2004 0000 3402 7777 2198',
  blik: '739 001 013',
};

// [wartość w kolumnie forma_platnosci, etykieta na przycisku]
export const FORMY = [
  ['Przelew', 'Przelew'],
  ['BLIK', 'BLIK na telefon'],
  ['Gotówka', 'Gotówka'],
  ['Karta', 'Karta'],
];
// Formy, przy których klient płaci później – SMS zawiera dane do płatności.
export const PLATNE_POZNIEJ = new Set(['Przelew', 'BLIK']);

export const STATUSY = {
  nowe: 'nowe',                     // z formularza klienta – czeka na Twoje potwierdzenie
  czeka: 'czeka na płatność',
  oplacone: 'opłacone',
  anulowane: 'anulowane',
};

export const PODMIOTY = ['INCO', 'OFI'];

// Magazyn sprzedaży = kasa, do której trafia gotówka (rozliczenie kasy w Finansach). Wartość w ZAMOWIENIA.magazyn = symbol z Subiekta.
// Nazwy jak w Subiekcie GT (INCO: INC, GR; OFI: ONE). Kasa: INC i ONE – Elsterska, GR – Grażynka.
export const MAGAZYNY = [['INC', 'INC - Główny (Elsterska)'], ['GR', 'GR - Grażanka'], ['ONE', 'ONE - Główny (OFI)']];
/** Symbol magazynu z dawnego wpisu tekstowego („Główny”, „INC Główny”, „Grażanka” …). */
export const symbolMagazynu = m => {
  const t = String(m || '');
  if (/^\s*gr\b|gra[zż]/i.test(t)) return 'GR';
  if (/^\s*one\b/i.test(t)) return 'ONE';
  return 'INC';
};

// Kto realizuje wysyłkę zamówień (wybór przy zamówieniu; trafia do kolumny ZAMOWIENIA.realizuje).
export const OSOBY_WYSYLKI = ['Olek', 'Grażynka'];

// Przewoźnicy przy wysyłce: [wartość w ZAMOWIENIA.przewoznik, etykieta]. Monitoring statusów działa dla InPost.
export const PRZEWOZNICY = [['InPost', 'InPost'], ['Poczta Polska', 'Poczta Polska'], ['Inny', 'Inny przewoźnik']];
export const linkSledzeniaPrzewoznika = (przewoznik, nr) => {
  const n = encodeURIComponent(String(nr || '').replace(/\s+/g, ''));
  if (!n) return '';
  if (przewoznik === 'Poczta Polska') return `https://emonitoring.poczta-polska.pl/?numer=${n}`;
  if (przewoznik && przewoznik !== 'InPost') return '';
  return `https://inpost.pl/sledzenie-przesylek?number=${n.replace(/\D/g, '')}`;
};

export const ETYKIETY_STATUSOW = { nowe: 'do potwierdzenia' };

// Grupy produktów z poziomami cen: kategoria katalogu → grupa (kolumna KLIENCI.poziom_<grupa>).
export const GRUPY_POZIOMOW = { 'Rapé': 'rape', 'Zielarnia i olejki': 'zielarnia' };
export const NAZWY_GRUP_POZIOMOW = { rape: 'Rapé', zielarnia: 'Zielarnia i olejki' };
export const KATEGORIE_FORMULARZA_DOMYSLNE = ['Rapé', 'Akcesoria do rapé', 'Zielarnia i olejki'];

// Kolejność kategorii jak w sklepie oneriver.pl.
export const KOLEJNOSC_KATEGORII = ['Rapé', 'Akcesoria do rapé', 'Zielarnia i olejki', 'Biżuteria', 'Odzież', 'Wystrój wnętrz i inne', 'Instrumenty etniczne'];

// Gotowe metody wysyłki do szybkiego dodania (ceny uzupełniasz sam).
export const PRZYKLADOWE_WYSYLKI = [
  { nazwa: 'Paczkomat InPost', opis: 'Podaj numer paczkomatu, np. WAW123M', wymaga_adresu: true },
  { nazwa: 'Kurier', opis: 'Dostawa pod wskazany adres', wymaga_adresu: true },
  { nazwa: 'Odbiór osobisty – Elsterska 10, Warszawa', opis: '', wymaga_adresu: false },
  { nazwa: 'Wysyłka zagraniczna', opis: 'Podaj pełny adres z krajem', wymaga_adresu: true },
];
