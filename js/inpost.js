// Odczyt danych z zrzutów ekranu aplikacji InPost Mobile („Nadaj przesyłkę” i „Szczegóły przesyłki”).
// Rozpoznawanie tekstu działa w telefonie (Tesseract.js, bez AI i bez opłat); pliki są w ../vendor/ocr
// i pobierają się przy pierwszym użyciu (ok. 6 MB), potem zostają w pamięci urządzenia.

const DOMENY = 'gmail|wp|o2|onet|interia|op|yahoo|hotmail|outlook|icloud|live|tlen|vp|poczta|gazeta|me|proton|protonmail|aol|gmx|mail';

/** Poprawki typowych pomyłek rozpoznawania. */
function poprawEmail(t) {
  // wielkie „I” w adresie e-mail to prawie zawsze odczytane „l” (adresy pisze się małymi literami)
  const s = String(t || '').replace(/\s+/g, '').replace(/I/g, 'l');
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase();
  // „@” bywa odczytane jako „Q”, „Qa”, „©”, „G” – szukamy znanej domeny i wstawiamy „@” przed nią
  const m = new RegExp(`^(.+?)(?:Qa|@a|Q|©|@|G|\\(a\\)|a)?((?:${DOMENY})\\.[a-z.]{2,})$`, 'i').exec(s);
  if (m) return (m[1] + '@' + m[2]).toLowerCase();
  // Nieznana domena: ostatnie „q/Q/©” przed „domena.pl” traktujemy jako „@” (do sprawdzenia przez Ciebie)
  const g = /^(.+)[qQ©]([a-z0-9-]+\.[a-z]{2,})$/.exec(s);
  if (g && !s.includes('@')) return (g[1] + '@' + g[2]).toLowerCase();
  return s.toLowerCase();
}

/** Kod paczkomatu: litera O obok cyfry to zero (WAWRO1BAPP → WAWR01BAPP). */
function poprawPaczkomat(t) {
  return String(t || '').toUpperCase().replace(/O(?=\d)|(?<=\d)O/g, '0');
}

const tylkoCyfry = t => String(t || '').replace(/\D/g, '');

/**
 * Z tekstu rozpoznanego z jednego lub kilku zrzutów wyciąga: imię, nazwisko, telefon, e-mail, paczkomat (kod + adres),
 * numer przesyłki (24 cyfry) i kod nadania (9 cyfr). Czego nie znajdzie – zostawia puste.
 */
export function rozbierzTekst(tekst) {
  const linie = String(tekst || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const po = etykieta => {
    // najpierw linia, która jest samą etykietą (np. „Adres e-mail*”), potem dowolna zawierająca etykietę
    let i = linie.findIndex(l => etykieta.test(l) && l.replace(etykieta, '').replace(/[*:\s]/g, '') === '');
    if (i < 0) i = linie.findIndex(l => etykieta.test(l));
    return i >= 0 ? linie[i + 1] || '' : '';
  };
  const w = { imie: '', nazwisko: '', nazwa: '', telefon: '', email: '', paczkomat: '', adres: '', nrPrzesylki: '', kodNadania: '', kraj: '', miedzynarodowa: false };

  w.imie = po(/^imi[eę]\*?$/i).replace(/[^\p{L}\s-]/gu, '').trim();
  w.nazwisko = po(/^nazwisko\*?$/i).replace(/[^\p{L}\s-]/gu, '').trim();
  if (!w.imie && !w.nazwisko) {
    const odb = po(/^odbiorca\b/i);                 // „Szczegóły przesyłki”: ODBIORCA ROZMIAR / Jarosław Koch Mini
    if (odb) w.nazwa = odb.replace(/\s+(mini|gabaryt\s*[abc]|[abc]|mał[ya]|średni[a]?|duż[ya]|small|medium|large)$/i, '').trim();
  }
  if (!w.nazwa) w.nazwa = [w.imie, w.nazwisko].filter(Boolean).join(' ');

  // InPost International: „Prefiks / +33 v 7 82 05 48 85” – numer zagraniczny z kierunkowym
  const zPref = linie.find(l => /^\+\s?(\d{1,3})\b/.test(l) && !/^\+\s?48\b/.test(l));
  const tel = zPref ? '' : linie.find(l => /\+?48\D{0,4}\d{3}\D?\d{3}\D?\d{3}/.test(l)) || po(/numer telefonu/i);
  if (zPref) {
    const pref = /^\+\s?(\d{1,3})\b/.exec(zPref)[1];
    let reszta = tylkoCyfry(zPref.replace(/^\+\s?\d{1,3}\b/, ''));
    if (reszta.length < 6) reszta = tylkoCyfry(linie[linie.indexOf(zPref) + 1] || '');
    if (reszta.length >= 6 && reszta.length <= 12) { w.telefon = '+' + pref + reszta.replace(/^0/, ''); w.miedzynarodowa = true; }
  } else if (tel) {
    const m = /(\d{3})\D?(\d{3})\D?(\d{3})(?!.*\d{3}\D?\d{3})/.exec(tel.replace(/^\D*\+?48/, ''));
    if (m) w.telefon = m[1] + m[2] + m[3];
  }
  const em = linie.find(l => /[@Q©]\s*a?\s*(?:[a-z]+\.)?[a-z]+\.[a-z]{2,}/i.test(l) && !/http/i.test(l)) || po(/adres e-?mail/i);
  if (em) w.email = poprawEmail(em.split(/\s+/).find(x => /\.[a-z]{2,}$/i.test(x)) || em);
  if (!/@/.test(w.email)) w.email = '';               // nie udało się odczytać adresu – lepiej puste niż błędne

  // paczkomat: linia z kodem (np. WAW01M, WAWR01BAPP) i „Zmień”, potem ulica i kod pocztowy
  const iP = linie.findIndex(l => /^[A-Z0-9O]{5,12}\b/.test(l) && /zmie[nń]|>|→/i.test(l));
  const iP2 = iP >= 0 ? iP : linie.findIndex(l => /^[A-Z]{3}[A-Z0-9O]{2,9}$/.test(l) && /\d|O/.test(l.slice(3)));
  if (iP2 >= 0) {
    w.paczkomat = poprawPaczkomat(/^[A-Z0-9O]{5,12}/.exec(linie[iP2])[0]);
    const adres = [];
    for (let i = iP2 + 1; i < linie.length && adres.length < 2; i++) {
      if (/do zap[łl]aty|dalej|zł/i.test(linie[i])) break;
      adres.push(linie[i]);
    }
    w.adres = adres.join(', ').replace(/\s+PL$/, '');
    // kraj na końcu adresu (np. „65-400 ARGELES GAZOST FR”) albo w kodzie punktu (FR004437)
    const kraj = (/\s([A-Z]{2})$/.exec(adres[adres.length - 1] || '') || [])[1] || (/^([A-Z]{2})\d{4,}$/.exec(w.paczkomat) || [])[1] || '';
    if (kraj && kraj !== 'PL') { w.kraj = kraj; w.miedzynarodowa = true; }
  }

  const nr = linie.map(tylkoCyfry).find(c => c.length === 24);
  if (nr) w.nrPrzesylki = nr;
  const iKod = linie.findIndex(l => /kod nadania/i.test(l));
  if (iKod >= 0) {
    const c = tylkoCyfry(linie[iKod + 1]);
    if (c.length >= 6 && c.length <= 12) w.kodNadania = c;
  }
  return w;
}

let pracownik = null;

/** Rozpoznaje tekst ze zdjęć (File/Blob). postep(0–1, opis) pokazuje postęp. */
export async function rozpoznaj(pliki, postep = () => {}) {
  if (!window.Tesseract) {
    postep(0, 'Wczytuję rozpoznawanie tekstu (pierwszy raz ok. 6 MB)…');
    await new Promise((ok, blad) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/ocr/tesseract.min.js', import.meta.url).href;
      s.onload = ok;
      s.onerror = () => blad(new Error('Nie udało się wczytać rozpoznawania tekstu – sprawdź internet.'));
      document.head.append(s);
    });
  }
  if (!pracownik) {
    const baza = new URL('../vendor/ocr/', import.meta.url).href;
    pracownik = await window.Tesseract.createWorker('pol', 1, {
      workerPath: baza + 'worker.min.js', corePath: baza, langPath: baza, gzip: true,
      logger: m => { if (m.status === 'recognizing text') postep(m.progress, 'Odczytuję zrzut…'); },
    });
  }
  const teksty = [];
  for (let i = 0; i < pliki.length; i++) {
    postep(0, `Odczytuję zrzut ${i + 1} z ${pliki.length}…`);
    const { data } = await pracownik.recognize(pliki[i]);
    teksty.push(data.text);
  }
  return { tekst: teksty.join('\n'), dane: rozbierzTekst(teksty.join('\n')) };
}
