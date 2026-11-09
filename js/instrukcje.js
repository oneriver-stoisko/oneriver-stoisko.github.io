// „Instrukcje”: procedury i informacje dla Grażynki, wpisane przez Dariusa.
// Zapis: karta USTAWIENIA, wiersze z id „instr:…” (opis = tytuł, tresc = treść). Grażynka tylko czyta,
// Darius (pełne Stoisko, Sklep → Instrukcje dla Grażynki) dodaje, poprawia, przestawia i usuwa.

import { $, esc, toast, okno } from './util.js';
import { dane, PREFIKS_INSTRUKCJI } from './dane.js';
import { trybProsty } from './api.js';
import * as sync from './sync.js';

let edytowana = '';   // id instrukcji otwartej do edycji ('nowa' – nowa)

/** Tekst → HTML: akapity, nowe linie, linki i „• ” na początku linii jako lista. */
function tekstNaHtml(t) {
  const linki = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return String(t || '').trim().split(/\n\s*\n/).map(akapit => {
    const linie = akapit.split('\n');
    if (linie.every(l => /^\s*([-•*]|\d+[.)])\s+/.test(l))) {
      const numerowana = /^\s*\d/.test(linie[0]);
      return `<${numerowana ? 'ol' : 'ul'}>${linie.map(l => `<li>${linki(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ''))}</li>`).join('')}</${numerowana ? 'ol' : 'ul'}>`;
    }
    return `<p>${linie.map(linki).join('<br>')}</p>`;
  }).join('');
}

function htmlEdycji(w) {
  return `<form class="in-edycja" data-forma="instrukcja" data-id="${esc(w ? w.id : 'nowa')}">
    <label class="pole szeroka"><span class="etykieta">Tytuł</span><input name="opis" value="${esc(w ? w.opis : '')}" placeholder="np. Jak przyjąć zwrot" autocomplete="off" required></label>
    <label class="pole szeroka"><span class="etykieta">Treść</span>
      <textarea name="tresc" rows="10" placeholder="Pisz zwykłym tekstem. Pusta linia = nowy akapit. Linie zaczynające się od „- ” albo „1. ” będą listą.">${esc(w ? w.tresc : '')}</textarea></label>
    <div class="przyciski">
      <button type="submit">Zapisz</button>
      <button type="button" class="drugorzedny" data-akcja="anuluj">Anuluj</button>
      ${w ? '<button type="button" class="drugorzedny niebezpieczny" data-akcja="usun">Usuń</button>' : ''}
    </div>
  </form>`;
}

function render() {
  const prosty = trybProsty();
  const lista = dane.instrukcje;
  $('#widok').innerHTML = `<section class="ekran ${prosty ? 'prosty-ekran' : 'ustawienia'} instrukcje-ekran">
    <h1 class="pr-tytul">${prosty ? 'Instrukcje' : 'Instrukcje dla Grażynki'}</h1>
    ${prosty ? '' : '<p class="podpowiedz">Grażynka widzi je w zakładce „Instrukcje” na swoim telefonie (po synchronizacji). Kolejność zmienisz strzałkami.</p>'}
    ${lista.length ? `<ul class="in-lista">${lista.map((w, i) => `<li data-id="${esc(w.id)}">
      ${!prosty && edytowana === w.id ? htmlEdycji(w) : `<details class="in-pozycja"${lista.length === 1 ? ' open' : ''}>
        <summary>${esc(w.opis || '(bez tytułu)')}</summary>
        <div class="in-tresc">${tekstNaHtml(w.tresc)}</div>
      </details>
      ${prosty ? '' : `<div class="przyciski in-przyciski">
          <button type="button" class="maly" data-akcja="edytuj">Popraw</button>
          <button type="button" class="maly drugorzedny" data-akcja="gora" ${i ? '' : 'disabled'} aria-label="Wyżej">↑</button>
          <button type="button" class="maly drugorzedny" data-akcja="dol" ${i < lista.length - 1 ? '' : 'disabled'} aria-label="Niżej">↓</button>
        </div>`}`}
    </li>`).join('')}</ul>` : `<p class="pr-info">${prosty ? 'Darius nie dodał jeszcze instrukcji.' : 'Nie ma jeszcze instrukcji.'}</p>`}
    ${prosty ? '<p class="in-ustawienia"><a href="#ustawienia">⚙︎ Ustawienia telefonu (połączenie, powiadomienia)</a></p>' : ''}
    ${prosty ? '' : (edytowana === 'nowa' ? htmlEdycji(null) : '<div class="przyciski"><button type="button" data-akcja="dodaj">+ Dodaj instrukcję</button><a class="przycisk drugorzedny" href="#sklep">← Sklep</a></div>')}
  </section>`;
}

const teraz = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

async function zapiszWiersze(wiersze) {
  await sync.zapisz([{ karta: 'USTAWIENIA', wiersze }]);
  const { wczytaj } = await import('./dane.js');
  await wczytaj();
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b || trybProsty()) return;
  const id = b.closest('[data-id]')?.dataset.id;
  const w = dane.instrukcje.find(x => x.id === id);
  const akcja = b.dataset.akcja;
  if (akcja === 'dodaj') edytowana = 'nowa';
  else if (akcja === 'edytuj') edytowana = id;
  else if (akcja === 'anuluj') edytowana = '';
  else if (akcja === 'usun' && w) {
    const tak = await okno('Usunąć instrukcję?', `<p>„${esc(w.opis)}” zniknie też u Grażynki.</p>`, [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Usuń', wartosc: true }]);
    if (!tak) return;
    await zapiszWiersze([{ id: w.id, opis: '', tresc: '' }]);
    edytowana = '';
    toast('Instrukcja usunięta.', 'ok');
  } else if ((akcja === 'gora' || akcja === 'dol') && w) {
    // kolejność = id; zamiana miejsc dwóch instrukcji = zamiana ich treści
    const lista = dane.instrukcje;
    const i = lista.indexOf(w);
    const j = akcja === 'gora' ? i - 1 : i + 1;
    if (j < 0 || j >= lista.length) return;
    const a = lista[i], c = lista[j];
    await zapiszWiersze([{ id: a.id, opis: c.opis, tresc: c.tresc }, { id: c.id, opis: a.opis, tresc: a.tresc }]);
  } else return;
  render();
}

async function submit(form) {
  if (form.dataset.forma !== 'instrukcja') return;
  const opis = form.opis.value.trim();
  const tresc = form.tresc.value.replace(/\s+$/, '');
  if (!opis) { toast('Wpisz tytuł instrukcji.', 'blad'); return; }
  const id = form.dataset.id === 'nowa' ? PREFIKS_INSTRUKCJI + teraz() : form.dataset.id;
  await zapiszWiersze([{ id, opis, tresc }]);
  edytowana = '';
  toast('Instrukcja zapisana – Grażynka zobaczy ją po synchronizacji.', 'ok');
  render();
}

export const ekran = { render, klik, submit };
