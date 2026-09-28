// Verbindet die Seite mit dem Player:
// - Klicks auf [data-play], auf ganze Folgen-Karten und auf Mentor-Links
//   ("▶ an dieser Stelle anhören")
// - hält alle Karten ([data-ep-card]) und Buttons mit dem Wiedergabestand synchron.
// Die Listener hängen am document und überleben daher Seitenwechsel (ClientRouter).

import { catalog, normalizeUrl, type CatalogEpisode } from './catalog';
import { getProgress, getState, init, play, subscribe, toggle } from './store';
import { dateLabel, esc, listenMetaHTML, playStripHTML } from './markup';

type CardState = 'new' | 'started' | 'loading' | 'playing' | 'paused' | 'done';

/** Was ein Klick bewirkt — für Screenreader immer die Aktion. */
const LABEL: Record<CardState, string> = {
  new: 'Jetzt anhören',
  started: 'Weiterhören',
  paused: 'Weiterhören',
  loading: 'Pause',
  playing: 'Pause',
  done: 'Nochmal hören',
};

/** Ab so vielen Sekunden gilt eine Folge als angefangen. */
const STARTED_AFTER = 15;

function stateFor(id: string): { st: CardState; t: number; d: number } {
  const s = getState();
  const prog = getProgress(id);
  const d = (s.ep?.id === id && s.duration) || prog?.d || catalog().byId.get(id)?.dur || 0;
  if (s.ep?.id === id) {
    const st = s.status === 'playing' ? 'playing' : s.status === 'loading' ? 'loading' : 'paused';
    return { st, t: s.time, d };
  }
  if (prog?.done) return { st: 'done', t: d, d };
  if (prog && prog.t >= STARTED_AFTER) return { st: 'started', t: prog.t, d };
  return { st: 'new', t: 0, d };
}

export function syncCards() {
  if (!catalog().list.length) return;

  document.querySelectorAll<HTMLElement>('[data-play]').forEach((btn) => {
    const id = btn.dataset.play!;
    const { st } = stateFor(id);
    btn.dataset.state = st;
    btn.setAttribute('aria-pressed', st === 'playing' || st === 'loading' ? 'true' : 'false');
    const label = btn.querySelector<HTMLElement>('[data-play-label]');
    const action = st === 'new' ? label?.dataset.labelNew || LABEL.new : LABEL[st];
    // Sichtbar darf ein Zustand stehen ("Läuft gerade"), vorgelesen wird die Aktion.
    const key = `label${st[0].toUpperCase()}${st.slice(1)}`;
    const text = label?.dataset[key] || action;
    if (label && label.textContent !== text) label.textContent = text;
    const title = catalog().byId.get(id)?.title;
    if (title) btn.setAttribute('aria-label', `${action}: ${title}`);
  });

  document.querySelectorAll<HTMLElement>('[data-ep-card]').forEach((card) => {
    const { st, t, d } = stateFor(card.dataset.epCard!);
    card.dataset.state = st;
    card.style.setProperty('--ep-progress', d ? String(Math.min(1, t / d)) : '0');
    const dur = card.querySelector<HTMLElement>('[data-ep-dur]');
    if (!dur) return;
    const base = dur.dataset.base ?? (dur.dataset.base = dur.textContent ?? '');
    const text =
      st === 'done'
        ? 'Gehört'
        : st === 'new' || !d
          ? base
          : `noch ${Math.max(1, Math.round((d - t) / 60))} min`; // gerundet wie die Gesamtdauer
    if (dur.textContent !== text) dur.textContent = text;
  });
}

/** Zeitmarke aus einem Link: "#t=754" (Podigee) oder "?t=12:34". */
function parseT(href: string): number | undefined {
  try {
    const u = new URL(href, window.location.href);
    const raw = new URLSearchParams(u.hash.replace(/^#/, '')).get('t') ?? u.searchParams.get('t');
    if (!raw) return undefined;
    const n = raw.includes(':')
      ? raw.split(':').map(Number).reduce((acc, part) => acc * 60 + part, 0)
      : parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0) return;
  const target = e.target as Element | null;
  if (!target?.closest) return;

  const btn = target.closest<HTMLElement>('[data-play]');
  if (btn) {
    e.preventDefault();
    toggle(btn.dataset.play);
    return;
  }

  // Verweise auf eine Folge (Mentor, Folgenbeschreibung) direkt hier abspielen.
  // Cmd/Strg-Klick öffnet weiterhin Podigee.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = target.closest<HTMLAnchorElement>('a.mentor-link, a[data-play-link]');
  if (link) {
    const ep = catalog().byUrl.get(normalizeUrl(link.href));
    if (!ep?.audio) return;
    e.preventDefault();
    play(ep.id, parseT(link.href));
    return;
  }

  // Die ganze Karte ist Abspielfläche — außer Links (Shownotes) und markiertem Text.
  // Per Tastatur bleibt die Player-Leiste der Weg; die Karte selbst ist kein Button.
  const card = target.closest<HTMLElement>('[data-ep-card]');
  if (!card || target.closest('a, button')) return;
  if (window.getSelection()?.toString()) return;
  const id = card.querySelector<HTMLElement>('[data-play]')?.dataset.play;
  if (id) toggle(id);
}

let lastKey = '';
let lastSync = 0;

function onStoreChange() {
  const s = getState();
  const key = `${s.ep?.id}|${s.status}`;
  const now = performance.now();
  // Zustandswechsel sofort, Fortschritt höchstens einmal pro Sekunde.
  if (key !== lastKey || now - lastSync > 1000) {
    lastKey = key;
    lastSync = now;
    syncCards();
  }
}

let bound = false;

export function initPlayer() {
  if (bound) return;
  bound = true;
  init();
  document.addEventListener('click', onClick);
  subscribe(onStoreChange);
  document.addEventListener('astro:page-load', syncCards);
  syncCards();
}

/** Karte für die Zufallsfolge — gleiches Markup wie die Karten aus Episodes.astro. */
export function episodeCardHTML(ep: CatalogEpisode): string {
  return `
    <article class="ep-card ep-card--pick" data-ep-card="${esc(ep.id)}" data-cls="${esc(ep.cls)}">
      <div class="ep-top-bar ${esc(ep.cls)}"></div>
      <div class="ep-show-row">
        <span class="ep-show ${esc(ep.cls)}">${esc(ep.show)}</span>
        ${ep.ep ? `<span class="ep-num">${esc(ep.ep)}</span>` : ''}
      </div>
      <h3 class="ep-title">${esc(ep.title)}</h3>
      <p class="ep-desc">${esc(ep.desc)}</p>
      <div class="ep-listen">
        ${playStripHTML(ep, ep.dur ? `${Math.max(1, Math.round(ep.dur / 60))} min` : '')}
        ${listenMetaHTML(ep, dateLabel(ep.date))}
      </div>
    </article>`;
}
