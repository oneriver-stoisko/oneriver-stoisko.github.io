// Podpowiedzi stałych klientów pod polem „Imię i nazwisko” / „Telefon” (Stoisko i sprzedaż Grażynki).

import { esc } from './util.js';
import { telefonCzytelny, podpowiedziKlientow, kluczNazwy, zamowieniaKlienta } from './dane.js';

/** Lista do dotknięcia; pusta, gdy nic nie pasuje albo wpisany tekst to już dokładnie ten klient. */
export function htmlPodpowiedzi(tekst, { wybranyId = '', filtr = null } = {}) {
  const l = podpowiedziKlientow(tekst, { filtr }).filter(k => !(String(k.id) === String(wybranyId) && kluczNazwy(k.nazwa) === kluczNazwy(tekst)));
  if (!l.length) return '';
  return `<ul class="podp-kl" role="listbox" aria-label="Stali klienci">${l.map(k => {
    const n = zamowieniaKlienta(k.id).length;
    return `<li><button type="button" data-akcja="wybierz-klienta" data-id="${esc(k.id)}">
      <b>${esc(k.nazwa || 'bez nazwy')}</b><small>${esc([telefonCzytelny(k.telefon), n ? `${n} zam.` : ''].filter(Boolean).join(' · ') || 'stały klient')}</small></button></li>`;
  }).join('')}</ul>`;
}
