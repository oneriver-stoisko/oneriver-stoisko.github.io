// „Lista mailingowa”: kontakty, które klienci sami wpisali w formularzu (lista.html – tablet na stoisku albo ich
// własny telefon po kodzie QR), wydarzenia pokazywane w formularzu i eksport do listy głównej.
// Zapis kontaktu robi skrypt arkusza (akcja publiczna „zapiszSie”), więc formularz nie zna tokenu Stoiska.
// Powtórzenia (ten sam e-mail lub telefon) są tylko oznaczane – nigdy łączone ani poprawiane automatycznie.

import { $, esc, toast, okno, dataKrotko, normalizuj, bezSkoku } from './util.js';
import { dane, PREFIKS_ZAPISOW } from './dane.js';
import { ustawienia } from './api.js';
import { ADRES_STOISKA } from './konfiguracja.js';
import * as sync from './sync.js';

const STATUSY = [['nowy', 'Nowy'], ['przeniesiony', 'Przeniesiony do listy głównej'], ['odrzucony', 'Odrzucony']];
const ZAINT = { sklep: 'Sklep', wyprawy: 'Wyprawy', ceremonie: 'Ceremonie i warsztaty' };
const JEZYKI = [['pl', 'PL'], ['en', 'EN'], ['es', 'ES'], ['fr', 'FR']];

const stan = { filtr: 'nowe', szukaj: '', edytowane: '', jezyk: 'pl' };
try { stan.jezyk = localStorage.getItem('or-stoisko-jezyk-listy') || 'pl'; } catch { /* bez znaczenia */ }

/** Link do formularza. kiosk = tablet podawany klientowi (tryb z wyjściem przez przytrzymanie, czyszczenie po zapisie). */
function linkFormularza(kiosk) {
  const u = ustawienia();
  const q = new URLSearchParams();
  q.set('api', u.url);
  if (u.wydarzenie) q.set('w', u.wydarzenie);
  if (u.wydarzenie_id) q.set('wid', u.wydarzenie_id);
  if (kiosk && u.kto) q.set('u', u.kto);
  q.set('j', stan.jezyk);
  if (kiosk) q.set('k', '1');
  return `${kiosk ? new URL('lista.html', location.href).href : ADRES_STOISKA + 'lista.html'}#${q.toString()}`;
}

const status = w => w.status || 'nowy';
const powtorzenie = w => String(w.powtorzenie || '').trim();

function pasuje(w) {
  if (stan.filtr === 'nowe' && status(w) !== 'nowy') return false;
  if (stan.filtr === 'powtorzenia' && !powtorzenie(w)) return false;
  if (stan.filtr.startsWith('zapis:') && !String(w.zapisy_id || '').split(/,\s*/).includes(stan.filtr.slice(6))) return false;
  if (stan.szukaj) {
    const t = normalizuj([w.imie_nazwisko, w.email, w.telefon, w.kraj, w.wydarzenie, w.zapisy].join(' '));
    if (!normalizuj(stan.szukaj).split(/\s+/).every(s => t.includes(s))) return false;
  }
  return true;
}
const lista = () => dane.listaMailingowa.filter(pasuje);

function htmlWpisu(w) {
  const wczesniejsze = powtorzenie(w).split(/,\s*/).filter(Boolean)
    .map(id => dane.listaMailingowa.find(x => String(x.id) === id)).filter(Boolean);
  const zaint = String(w.zainteresowania || '').split(/,\s*/).filter(Boolean).map(z => ZAINT[z] || z).join(', ');
  return `<li class="ml-wpis" data-id="${esc(w.id)}">
    <div class="ml-glowa">
      <b>${esc(w.imie_nazwisko || '(bez imienia)')}</b>
      <span class="ml-status ml-${esc(status(w))}">${esc((STATUSY.find(s => s[0] === status(w)) || STATUSY[0])[1].split(' ')[0])}</span>
    </div>
    <div class="ml-dane">
      <a href="mailto:${esc(w.email)}">${esc(w.email)}</a>${w.telefon ? ` · <a href="tel:${esc(w.telefon)}">${esc(w.telefon)}</a>` : ''}
      ${w.kraj ? ` · ${esc(w.kraj)}` : ''}${w.jezyk ? ` · ${esc(String(w.jezyk).toUpperCase())}` : ''}
    </div>
    ${zaint ? `<div class="ml-info">Interesuje się: ${esc(zaint)}</div>` : ''}
    ${w.zapisy ? `<div class="ml-zapis">Chce się zapisać: <b>${esc(w.zapisy)}</b></div>` : ''}
    <div class="ml-info">${esc(dataKrotko(String(w.data || w.utworzono || '')))}${w.wydarzenie ? ` · ${esc(w.wydarzenie)}` : ''}${w.zrodlo ? ` · ${esc(w.zrodlo)}` : ''}</div>
    ${wczesniejsze.length ? `<div class="ml-powt">⚠︎ Ten sam e-mail lub telefon co: ${wczesniejsze.map(x =>
      `${esc(x.imie_nazwisko || '(bez imienia)')} (${esc(x.email)}${x.telefon ? ', ' + esc(x.telefon) : ''}, ${esc(dataKrotko(String(x.data || '')))})`).join('; ')}.
      Sprawdź, czy to ta sama osoba – nic nie zostało połączone.</div>` : ''}
    <div class="chipy male ml-statusy">${STATUSY.map(([s, e]) =>
      `<button type="button" class="chip" data-akcja="status" data-status="${s}" aria-pressed="${status(w) === s}">${esc(e.replace(' do listy głównej', ''))}</button>`).join('')}</div>
  </li>`;
}

// ───────────── wydarzenia w formularzu ─────────────

function htmlEdycjiWydarzenia(w) {
  const zFinansow = dane.wydarzenia.filter(x => x.status !== 'zakończony' && (x.do || x.od || '9') >= new Date().toISOString().slice(0, 10));
  return `<form class="ml-wyd-edycja" data-forma="zapis-wyd" data-id="${esc(w ? w.id : 'nowe')}">
    ${!w && zFinansow.length ? `<label class="pole szeroka"><span class="etykieta">Wydarzenie z Finansów (podpowie nazwę i daty)</span>
      <select name="zfinansow"><option value="">— wpiszę sam —</option>${zFinansow.map(x => `<option value="${esc(x.id)}">${esc(x.nazwa)}${x.od ? ' · ' + esc(x.od) : ''}</option>`).join('')}</select></label>` : ''}
    <label class="pole szeroka"><span class="etykieta">Nazwa (tak zobaczy ją klient)</span><input name="nazwa" value="${esc(w ? w.nazwa : '')}" required placeholder="np. Wyprawa do Kolumbii i Wenezueli 2027"></label>
    <div class="ml-daty">
      <label class="pole"><span class="etykieta">Od</span><input type="date" name="od" value="${esc(w ? w.od : '')}"></label>
      <label class="pole"><span class="etykieta">Do</span><input type="date" name="do" value="${esc(w ? w.do : '')}"></label>
    </div>
    <label class="pole szeroka"><span class="etykieta">Link do strony zapisów (nieobowiązkowo)</span><input type="url" name="link" value="${esc(w ? w.link : '')}" placeholder="https://oneriver.pl/…" inputmode="url"></label>
    <label class="pole szeroka"><span class="etykieta">Krótki opis (nieobowiązkowo)</span><input name="opis" value="${esc(w ? w.opis : '')}" maxlength="300" placeholder="np. Kolumbia i Wenezuela, 3 tygodnie"></label>
    <div class="przyciski">
      <button type="submit">Zapisz</button>
      <button type="button" class="drugorzedny" data-akcja="anuluj-wyd">Anuluj</button>
      ${w ? '<button type="button" class="drugorzedny niebezpieczny" data-akcja="usun-wyd">Usuń</button>' : ''}
    </div>
  </form>`;
}

function htmlWydarzen() {
  const dzis = new Date().toISOString().slice(0, 10);
  const w = dane.zapisyWydarzen;
  const ileChce = id => dane.listaMailingowa.filter(x => String(x.zapisy_id || '').split(/,\s*/).includes(id)).length;
  return `<section class="panel">
    <h2>Wydarzenia w formularzu</h2>
    <p class="podpowiedz">Klient zaznacza, na które chce się zapisać. Przeszłe wydarzenia znikają z formularza same.
      Na tablecie link nie jest klikalny (klient nie wychodzi z formularza) – dostanie go od Ciebie; na własnym telefonie może od razu otworzyć stronę zapisów.</p>
    ${w.length ? `<ul class="ml-wydarzenia">${w.map(x => stan.edytowane === x.id ? `<li>${htmlEdycjiWydarzenia(x)}</li>` : `<li data-id="${esc(x.id)}">
      <div><b>${esc(x.nazwa)}</b>${x.od ? ` · ${esc(dataKrotko(x.od))}${x.do && x.do !== x.od ? ' – ' + esc(dataKrotko(x.do)) : ''}` : ''}
        ${(x.do || x.od || '9') < dzis ? ' <span class="ml-status ml-odrzucony">minęło</span>' : ''}${!x.pokaz ? ' <span class="ml-status ml-odrzucony">ukryte</span>' : ''}</div>
      ${x.opis ? `<div class="ml-info">${esc(x.opis)}</div>` : ''}
      ${x.link ? `<div class="ml-info"><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.link)}</a></div>` : ''}
      <div class="ml-info">Chętnych: <b>${ileChce(x.id)}</b>${ileChce(x.id) ? ` · <a href="#" data-akcja="pokaz-chetnych" data-wyd="${esc(x.id)}">pokaż</a>` : ''}</div>
      <div class="przyciski">
        <button type="button" class="maly" data-akcja="edytuj-wyd">Popraw</button>
        <button type="button" class="maly drugorzedny" data-akcja="pokaz-wyd">${x.pokaz ? 'Ukryj w formularzu' : 'Pokaż w formularzu'}</button>
      </div>
    </li>`).join('')}</ul>` : '<p class="pr-info">Nie ma jeszcze wydarzeń – dodaj np. wyprawę ze stroną zapisów albo najbliższe spotkania.</p>'}
    ${stan.edytowane === 'nowe' ? htmlEdycjiWydarzenia(null) : '<div class="przyciski"><button type="button" data-akcja="dodaj-wyd">+ Dodaj wydarzenie</button></div>'}
  </section>`;
}

// ───────────── ekran ─────────────

function htmlListy() {
  const l = lista();
  return l.length ? `<ul class="ml-lista">${l.map(htmlWpisu).join('')}</ul>`
    : `<p class="pr-info">${dane.listaMailingowa.length ? 'Brak wpisów dla tego filtra.' : 'Nikt się jeszcze nie zapisał. Otwórz formularz i podaj tablet klientowi.'}</p>`;
}

function render() {
  const u = ustawienia();
  const wszystkie = dane.listaMailingowa;
  const nowe = wszystkie.filter(w => status(w) === 'nowy').length;
  const powt = wszystkie.filter(w => powtorzenie(w)).length;
  const filtry = [['nowe', `Nowe (${nowe})`], ['wszystkie', `Wszystkie (${wszystkie.length})`], ['powtorzenia', `Powtórzenia (${powt})`],
    ...dane.zapisyWydarzen.filter(x => wszystkie.some(w => String(w.zapisy_id || '').split(/,\s*/).includes(x.id))).map(x => ['zapis:' + x.id, '→ ' + x.nazwa])];
  $('#widok').innerHTML = `<section class="ekran ustawienia mailing">
    <h1>Lista mailingowa</h1>
    <section class="panel">
      <h2>Formularz dla klientów</h2>
      ${u.url ? `<p class="podpowiedz">Klient wpisuje imię, e-mail, telefon, kraj, zainteresowania i zaznacza zgodę.
        ${u.wydarzenie ? `Wpisy zapiszą się z wydarzeniem <b>${esc(u.wydarzenie)}</b> (zmienisz w Ustawieniach).` : 'Bez wydarzenia – możesz je wybrać w Ustawieniach.'}</p>
      <div class="chipy male"><span class="etykieta-mag">Język na start:</span>${JEZYKI.map(([j, e]) => `<button type="button" class="chip" data-akcja="jezyk" data-jezyk="${j}" aria-pressed="${stan.jezyk === j}">${e}</button>`).join('')}</div>
      <div class="przyciski ml-przyciski">
        <button type="button" data-akcja="otworz">📝 Otwórz formularz – podaj tablet klientowi</button>
        <button type="button" class="drugorzedny" data-akcja="qr">Kod QR na telefon klienta</button>
      </div>
      <p class="podpowiedz">Na tablecie formularz czyści się sam po każdym zapisie (i po 3 minutach bez dotyku). Do Stoiska wrócisz, przytrzymując <b>⋯</b> w prawym dolnym rogu przez 2 sekundy.
        Bez internetu wpisy czekają na tablecie i wyślą się same.</p>`
      : '<p class="blad">Najpierw połącz Stoisko z arkuszem w Ustawieniach.</p>'}
    </section>
    ${htmlWydarzen()}
    <section class="panel">
      <h2>Zapisani</h2>
      <div class="chipy male">${filtry.map(([f, e]) => `<button type="button" class="chip" data-filtr="${esc(f)}" aria-pressed="${stan.filtr === f}">${esc(e)}</button>`).join('')}</div>
      <label class="pole szukaj"><span class="etykieta">Szukaj</span><input type="search" name="szukaj-ml" value="${esc(stan.szukaj)}" placeholder="imię, e-mail, telefon, kraj…" autocomplete="off"></label>
      <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="csv">⬇︎ Pobierz CSV (widoczne wpisy)</button></div>
      <div id="ml-lista">${htmlListy()}</div>
    </section>
  </section>`;
}

const odswiezListe = () => { const el = $('#ml-lista'); if (el) el.innerHTML = htmlListy(); };

async function zapiszWiersze(karta, wiersze) {
  await sync.zapisz([{ karta, wiersze }]);
  const { wczytaj } = await import('./dane.js');
  await wczytaj();
}

function pobierzCsv(wiersze) {
  const kol = [['email', 'E-mail'], ['imie_nazwisko', 'Imię i nazwisko'], ['telefon', 'Telefon'], ['kraj', 'Kraj'], ['jezyk', 'Język'],
    ['zainteresowania', 'Zainteresowania'], ['zapisy', 'Chce się zapisać'], ['wydarzenie', 'Gdzie się zapisał'], ['data', 'Data'],
    ['zgoda', 'Zgoda'], ['zgoda_tresc', 'Wersja zgody'], ['powtorzenie', 'Powtórzenie (id)'], ['status', 'Status'], ['id', 'id']];
  const pole = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const tekst = '﻿' + [kol.map(k => pole(k[1])).join(','), ...wiersze.map(w => kol.map(([k]) => pole(k === 'status' ? status(w) : w[k])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([tekst], { type: 'text/csv;charset=utf-8' }));
  a.download = `lista-mailingowa-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function zaladujQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((ok, nie) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js';
    s.onload = () => ok(window.qrcode);
    s.onerror = () => nie(new Error('Nie udało się wczytać generatora kodów QR.'));
    document.head.appendChild(s);
  });
}

async function klik(e) {
  const f = e.target.closest('[data-filtr]');
  if (f) {
    stan.filtr = f.dataset.filtr;
    document.querySelectorAll('[data-filtr]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filtr === stan.filtr)));
    odswiezListe(); return;
  }
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const a = b.dataset.akcja;
  const id = b.closest('[data-id]')?.dataset.id;
  if (a === 'jezyk') {
    stan.jezyk = b.dataset.jezyk;
    try { localStorage.setItem('or-stoisko-jezyk-listy', stan.jezyk); } catch { /* bez znaczenia */ }
    document.querySelectorAll('[data-akcja="jezyk"]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.jezyk === stan.jezyk)));
  } else if (a === 'otworz') {
    // replace – przycisk „wstecz” na tablecie nie wróci do Stoiska (klient nie zobaczy zamówień)
    location.replace(linkFormularza(true));
  } else if (a === 'qr') {
    try {
      const qr = (await zaladujQr())(0, 'M');
      const link = linkFormularza(false);
      qr.addData(link); qr.make();
      await okno('Kod QR – lista mailingowa', `<div class="ml-qr">${qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true })}</div>
        <p class="podpowiedz">Klient skanuje kod aparatem telefonu i zapisuje się u siebie. ${ustawienia().wydarzenie ? `Wpis będzie z wydarzeniem „${esc(ustawienia().wydarzenie)}”.` : ''}</p>`,
        [{ etykieta: 'Zamknij', wartosc: true }]);
    } catch (err) { toast(err.message, 'blad'); }
  } else if (a === 'status' && id) {
    await zapiszWiersze('LISTA_MAILINGOWA', [{ id, status: b.dataset.status }]);
    bezSkoku(odswiezListe);
  } else if (a === 'csv') {
    const w = lista();
    if (!w.length) { toast('Brak wpisów do pobrania.', 'blad'); return; }
    pobierzCsv(w);
    const doPrzeniesienia = w.filter(x => status(x) === 'nowy');
    if (doPrzeniesienia.length) {
      const tak = await okno('Oznaczyć jako przeniesione?', `<p>Pobrano ${w.length} wpisów. Czy oznaczyć ${doPrzeniesienia.length} nowych jako <b>przeniesione do listy głównej</b>?
        Zrób to dopiero, gdy wkleisz je do listy głównej.</p>`, [{ etykieta: 'Jeszcze nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Oznacz', wartosc: true }]);
      if (tak) { await zapiszWiersze('LISTA_MAILINGOWA', doPrzeniesienia.map(x => ({ id: x.id, status: 'przeniesiony' }))); render(); toast('Oznaczono jako przeniesione.', 'ok'); }
    }
  } else if (a === 'dodaj-wyd') { stan.edytowane = 'nowe'; render(); }
  else if (a === 'edytuj-wyd' && id) { stan.edytowane = id; render(); }
  else if (a === 'anuluj-wyd') { stan.edytowane = ''; render(); }
  else if (a === 'pokaz-chetnych') {
    e.preventDefault();
    stan.filtr = 'zapis:' + b.dataset.wyd;
    render();
    $('#ml-lista')?.scrollIntoView({ behavior: 'smooth' });
  } else if ((a === 'pokaz-wyd' || a === 'usun-wyd') && (id || stan.edytowane)) {
    const w = dane.zapisyWydarzen.find(x => x.id === (id || stan.edytowane));
    if (!w) return;
    if (a === 'usun-wyd') {
      const tak = await okno('Usunąć wydarzenie?', `<p>„${esc(w.nazwa)}” zniknie z formularza. Zapisy klientów zostają na liście.</p>`,
        [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Usuń', wartosc: true }]);
      if (!tak) return;
      await zapiszWiersze('USTAWIENIA', [{ id: PREFIKS_ZAPISOW + w.id, opis: '', tresc: '' }]);
      stan.edytowane = '';
    } else {
      await zapiszWiersze('USTAWIENIA', [{ id: PREFIKS_ZAPISOW + w.id, opis: w.nazwa, tresc: JSON.stringify({ od: w.od, do: w.do, link: w.link, opis: w.opis, pokaz: !w.pokaz, wydarzenie_id: w.wydarzenie_id }) }]);
    }
    render();
  }
}

function zmiana(e) {
  const s = e.target;
  if (s.name === 'zfinansow') {
    const w = dane.wydarzenia.find(x => x.id === s.value);
    const f = s.form;
    if (w) { f.nazwa.value = w.nazwa; f.od.value = w.od || ''; f.do.value = w.do || ''; }
  }
}

function wejscie(e) {
  if (e.target.name !== 'szukaj-ml') return;
  stan.szukaj = e.target.value;
  odswiezListe();
}

async function submit(form) {
  if (form.dataset.forma !== 'zapis-wyd') return;
  const nazwa = form.nazwa.value.trim();
  const link = form.link.value.trim();
  if (!nazwa) { toast('Wpisz nazwę wydarzenia.', 'blad'); return; }
  if (link && !/^https?:\/\/\S+$/.test(link)) { toast('Link musi zaczynać się od https://', 'blad'); return; }
  if (form.od.value && form.do.value && form.do.value < form.od.value) { toast('Data „do” jest wcześniejsza niż „od”.', 'blad'); return; }
  const stary = dane.zapisyWydarzen.find(x => x.id === form.dataset.id);
  const id = stary ? stary.id : (form.zfinansow?.value || normalizuj(nazwa).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Date.now().toString(36));
  await zapiszWiersze('USTAWIENIA', [{ id: PREFIKS_ZAPISOW + id, opis: nazwa,
    tresc: JSON.stringify({ od: form.od.value, do: form.do.value, link, opis: form.opis.value.trim(), pokaz: stary ? stary.pokaz : true, wydarzenie_id: stary ? stary.wydarzenie_id : (form.zfinansow?.value || '') }) }]);
  stan.edytowane = '';
  toast('Zapisano – klienci zobaczą je w formularzu.', 'ok');
  render();
}

export const ekran = { render, klik, zmiana, wejscie, submit };
