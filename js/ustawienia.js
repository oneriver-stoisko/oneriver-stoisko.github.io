// Ekran „Ustawienia”: połączenie z arkuszem, kod urządzenia (początek numerów zamówień),
// wydarzenie i magazyn, dane do płatności w wiadomości, synchronizacja.

import * as db from './db.js';
import * as sync from './sync.js';
import { ustawienia, zapiszUstawienia, polaczone, gotowe, wywolaj, wersjaApi, adresZFinansow, trybProsty } from './api.js';
import { wypelnijPanele, klikPanelu } from './powiadomienia.js';
import { $, esc, toast, okno, dataKrotko } from './util.js';
import { dane, wczytaj, nastepnyNumer, kodUzywanyPrzez } from './dane.js';
import { WERSJA, WYMAGANE_API, PODMIOTY, PLATNOSC_DOMYSLNA, MAGAZYNY, symbolMagazynu } from './konfiguracja.js';

const KLUCZ_MOTYWU = 'or-stoisko-motyw';

/** Lista wydarzeń z Finansów: trwające i przyszłe (zakończone ponad tydzień temu i zamknięte – ukryte). */
function opcjeWydarzen(u) {
  const tydzien = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const lista = dane.wydarzenia.filter(w => w.id === u.wydarzenie_id || (w.status !== 'zakończony' && (!w.do || w.do >= tydzien)));
  const daty = w => (w.od ? ` · ${dataKrotko(w.od)}${w.do && w.do !== w.od ? '–' + dataKrotko(w.do) : ''}` : '');
  const reczne = u.wydarzenie && !lista.some(w => w.id === u.wydarzenie_id)
    ? `<option value="txt:${esc(u.wydarzenie)}" selected>${esc(u.wydarzenie)} (wpisane ręcznie)</option>` : '';
  return `<option value="">— bez wydarzenia (sprzedaż w magazynie) —</option>${reczne}${lista.map(w =>
    `<option value="${esc(w.id)}" ${w.id === u.wydarzenie_id ? 'selected' : ''}>${esc(w.nazwa + daty(w))}</option>`).join('')}`;
}
function wybraneWydarzenie(v, stare) {
  if (!v) return { id: '', nazwa: '' };
  if (v.startsWith('txt:')) return { id: '', nazwa: v.slice(4) };
  const w = dane.wydarzenia.find(x => x.id === v);
  return w ? { id: w.id, nazwa: w.nazwa } : { id: stare.wydarzenie_id || '', nazwa: stare.wydarzenie || '' };
}
const motyw = () => { try { return localStorage.getItem(KLUCZ_MOTYWU) || 'auto'; } catch { return 'auto'; } };
function ustawMotyw(m) {
  try { if (m === 'auto') localStorage.removeItem(KLUCZ_MOTYWU); else localStorage.setItem(KLUCZ_MOTYWU, m); } catch { /* tylko na teraz */ }
  if (m === 'auto') delete document.documentElement.dataset.motyw; else document.documentElement.dataset.motyw = m;
}

function render(komunikat = '', klasa = '') {
  const u = ustawienia();
  const s = sync.stanSynchronizacji();
  const pierwszy = !gotowe();
  const api = wersjaApi();
  const url = u.url || adresZFinansow();
  $('#widok').innerHTML = `
  <section class="ekran ustawienia">
    ${pierwszy ? `<div class="powitanie"><h1>Przygotuj stoisko</h1>
      <p>Połącz aplikację z arkuszem „One River – Finanse” i nadaj temu urządzeniu kod. Ustawienia zapiszą się tylko tutaj.</p></div>` : '<h1>Ustawienia</h1>'}
    ${api && api < WYMAGANE_API ? `<p class="pasek-info blad">Skrypt arkusza ma wersję ${api}, a stoisko potrzebuje ${WYMAGANE_API}.</p>` : ''}

    <form class="panel" data-forma="ustawienia" novalidate>
      <h2>Połączenie z arkuszem</h2>
      <label class="pole"><span class="etykieta">Adres API (kończy się na /exec)</span>
        <input name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec">
        ${!u.url && url ? '<span class="podpowiedz">Adres wzięty z aplikacji Finanse na tym urządzeniu.</span>' : ''}</label>
      <label class="pole"><span class="etykieta">Token</span>
        <span class="z-przyciskiem"><input name="token" type="password" autocomplete="off" spellcheck="false" value="${esc(u.token)}">
        <button type="button" class="drugorzedny" data-akcja="pokaz-token">Pokaż</button></span></label>

      <h2>To urządzenie</h2>
      <label class="pole"><span class="etykieta">Nazwa urządzenia</span>
        <input name="kto" autocomplete="off" value="${esc(u.kto)}" placeholder="np. Tablet kiermasz">
        <span class="podpowiedz">Trafia do kolumny „kto” i do dziennika zmian.</span></label>
      <label class="pole"><span class="etykieta">Kod urządzenia (początek numerów zamówień)</span>
        <input name="kod" autocomplete="off" autocapitalize="characters" maxlength="4" value="${esc(u.kod)}" placeholder="np. K1">
        <span class="podpowiedz">1–4 litery lub cyfry. Każde urządzenie musi mieć inny kod – wtedy numery nigdy się nie powtórzą, nawet bez internetu.${u.kod ? ` Następny numer: <b>${esc(nastepnyNumer())}</b>.` : ''}</span></label>

      <h2>Sprzedaż</h2>
      <label class="pole"><span class="etykieta">Podmiot</span>
        <select name="podmiot">${PODMIOTY.map(p => `<option ${u.podmiot === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="pole"><span class="etykieta">Magazyn</span>
        <select name="magazyn">${MAGAZYNY.map(([s, e]) => `<option value="${s}" ${symbolMagazynu(u.magazyn) === s ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
        <span class="podpowiedz">Gotówka ze sprzedaży bez wydarzenia rozlicza się w kasie tego magazynu.</span></label>
      <label class="pole"><span class="etykieta">Wydarzenie</span>
        <select name="wydarzenie">${opcjeWydarzen(u)}</select>
        <span class="podpowiedz">Zapisuje się przy każdym zamówieniu: sprzedaż i gotówka liczą się w budżecie i kasie tego wydarzenia. „Bez wydarzenia” = sprzedaż w magazynie. Nowe wydarzenie dodaje się w aplikacji Finanse → Budżety i cele → Nowe wydarzenie.</span></label>

      <h2>Dane do płatności w wiadomości</h2>
      <label class="pole"><span class="etykieta">Odbiorca przelewu</span>
        <input name="odbiorca" autocomplete="off" value="${esc(u.platnosc.odbiorca)}"></label>
      <label class="pole"><span class="etykieta">Numer konta</span>
        <input name="konto" inputmode="numeric" autocomplete="off" value="${esc(u.platnosc.konto)}"></label>
      <label class="pole"><span class="etykieta">Telefon do BLIK</span>
        <input name="blik" inputmode="tel" autocomplete="off" value="${esc(u.platnosc.blik)}"></label>

      <h2>Przelew w euro (klienci zagraniczni)</h2>
      <label class="pole"><span class="etykieta">Odbiorca przelewu EUR</span>
        <input name="odbiorcaEur" autocomplete="off" value="${esc(u.platnosc.odbiorcaEur)}" placeholder="np. ONE RIVER sp. z o.o."></label>
      <label class="pole"><span class="etykieta">Konto EUR (IBAN)</span>
        <input name="kontoEur" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(u.platnosc.kontoEur)}" placeholder="PL00 0000 0000 0000 0000 0000 0000"></label>
      <label class="pole"><span class="etykieta">BIC / SWIFT</span>
        <input name="swift" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(u.platnosc.swift)}" placeholder="np. BREXPLPWMBK"></label>
      <span class="podpowiedz">Trafia do wiadomości przy zamówieniach płatnych w euro.</span>

      <div class="przyciski"><button type="submit">Zapisz</button>
        ${!pierwszy ? '<a class="przycisk drugorzedny" href="#nowe">Wróć</a>' : ''}</div>
      <p class="komunikat ${klasa}" aria-live="polite">${komunikat}</p>
    </form>

    <div class="panel">
      <h2>Wygląd</h2>
      <div class="chipy">${[['auto', 'Jak w telefonie'], ['jasny', '☀︎ Jasny'], ['ciemny', '☾ Ciemny']].map(([k, e]) =>
        `<button type="button" class="chip" data-akcja="motyw" data-v="${k}" aria-pressed="${motyw() === k}">${e}</button>`).join('')}</div>
      <p class="podpowiedz">„Jak w telefonie” – aplikacja przełącza się razem z trybem ciemnym telefonu. Wybór dotyczy tylko tego urządzenia.</p>
    </div>

    ${polaczone() ? `<div class="panel">
      <h2>Synchronizacja</h2>
      <dl class="info">
        <div><dt>Ostatnia</dt><dd>${s.ostatnia ? esc(new Date(s.ostatnia).toLocaleString('pl-PL')) : 'jeszcze nie było'}</dd></div>
        <div><dt>Zmiany do wysłania</dt><dd>${s.oczekujace || 0}</dd></div>
        <div><dt>Produkty w cenniku</dt><dd>${dane.cennik.length}</dd></div>
        <div><dt>Zamówienia na urządzeniu</dt><dd>${dane.zamowienia.length}</dd></div>
        <div><dt>Wersja skryptu arkusza</dt><dd>${api || 'nieznana'}</dd></div>
        ${s.blad ? `<div><dt>Ostatni błąd</dt><dd class="blad">${esc(s.blad)}</dd></div>` : ''}
      </dl>
      <div class="przyciski">
        <button type="button" data-akcja="synchronizuj">Synchronizuj teraz</button>
        <button type="button" class="drugorzedny" data-akcja="pelna">Pobierz wszystko od nowa</button>
      </div>
    </div>
    <div class="panel" data-push="panel"></div>
    <div class="panel">
      <h2>Aplikacja</h2>
      <p>One River Stoisko ${WERSJA}. Zamówienia zapisują się bez internetu i wysyłają same, gdy wróci połączenie.</p>
      <div class="przyciski"><button type="button" class="niebezpieczny" data-akcja="wyczysc">Usuń dane z tego urządzenia</button></div>
    </div>` : ''}
  </section>`;
  wypelnijPanele(trybProsty());
}

async function zapisz(form) {
  const f = form.elements;
  const stare = ustawienia();
  const url = f.url.value.trim();
  const token = f.token.value.trim();
  const kod = f.kod.value.trim().toUpperCase();
  const kto = f.kto.value.trim();
  const blad = !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url) ? 'Adres musi zaczynać się od https://script.google.com/ i kończyć na /exec.'
    : !token ? 'Wpisz token.'
    : !kto ? 'Wpisz nazwę urządzenia.'
    : !/^[A-Z0-9]{1,4}$/.test(kod) ? 'Kod urządzenia: 1–4 litery lub cyfry, np. K1.'
    : '';
  if (blad) { render(esc(blad), 'blad'); return; }

  const platnosc = {
    odbiorca: f.odbiorca.value.trim() || PLATNOSC_DOMYSLNA.odbiorca,
    konto: f.konto.value.trim(),
    blik: f.blik.value.trim(),
    odbiorcaEur: f.odbiorcaEur.value.trim(),
    kontoEur: f.kontoEur.value.trim().toUpperCase(),
    swift: f.swift.value.trim().toUpperCase(),
  };
  const wyd = wybraneWydarzenie(f.wydarzenie.value, stare);
  zapiszUstawienia({ url, token, kto, kod, podmiot: f.podmiot.value, magazyn: f.magazyn.value, wydarzenie: wyd.nazwa, wydarzenie_id: wyd.id, platnosc });

  const nowePolaczenie = url !== stare.url || token !== stare.token;
  if (nowePolaczenie) {
    render('Sprawdzam połączenie…');
    try {
      const p = await wywolaj('ping', {}, 30000);
      render(`Połączono z arkuszem „${esc(p.arkusz)}”. Pobieram cennik i zamówienia…`, 'ok');
      await sync.synchronizuj({ pelna: true });
      await wczytaj();
    } catch (e) {
      render(esc(e.message), 'blad');
      return;
    }
  }
  const inne = kodUzywanyPrzez(kod, kto);
  if (inne.length) {
    await okno(`Kod ${kod} ma już inne urządzenie`,
      `<p>Zamówienia z kodem <b>${esc(kod)}</b> wystawiało: ${esc(inne.join(', '))}. Jeśli to inne urządzenie, nadaj temu inny kod (np. ${esc(kod.replace(/\d+$/, n => String(Number(n) + 1)) || kod + '2')}), żeby numery się nie powtarzały.</p>`,
      [{ etykieta: 'Rozumiem', wartosc: true, autofocus: true }]);
  }
  toast(`Zapisano. Następny numer: ${nastepnyNumer()}.`, 'ok');
  location.hash = '#nowe';
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  if (await klikPanelu(b, toast, trybProsty())) return;
  if (b.dataset.akcja === 'motyw') {
    ustawMotyw(b.dataset.v);
    document.querySelectorAll('[data-akcja="motyw"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    return;
  }
  const akcja = b.dataset.akcja;
  if (akcja === 'pokaz-token') {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.textContent = i.type === 'password' ? 'Pokaż' : 'Ukryj';
  } else if (akcja === 'synchronizuj' || akcja === 'pelna') {
    b.disabled = true;
    await sync.synchronizuj({ pelna: akcja === 'pelna' });
    await wczytaj();
    const s = sync.stanSynchronizacji();
    render(s.blad ? esc(s.blad) : 'Zsynchronizowano.', s.blad ? 'blad' : 'ok');
  } else if (akcja === 'wyczysc') {
    const s = sync.stanSynchronizacji();
    const tak = await okno('Usunąć dane z tego urządzenia?',
      s.oczekujace
        ? `<p class="blad"><b>${s.oczekujace} zmian nie zostało jeszcze wysłanych i przepadną.</b> Najpierw połącz się z internetem.</p>`
        : '<p>Arkusz zostaje bez zmian. Z urządzenia znikną kopie danych i ustawienia stoiska.</p>',
      [{ etykieta: 'Zostaw dane', wartosc: false, klasa: 'drugorzedny', autofocus: true },
       { etykieta: s.oczekujace ? 'Usuń mimo to' : 'Usuń dane', wartosc: true, klasa: 'niebezpieczny' }]);
    if (!tak) return;
    await db.wyczyscWszystko();
    Object.keys(localStorage).filter(k => k.startsWith('or-stoisko')).forEach(k => localStorage.removeItem(k));
    location.hash = '#ustawienia';
    location.reload();
  }
}

export const ekran = { render, klik, submit: form => { if (form.dataset.forma === 'ustawienia') zapisz(form); } };
