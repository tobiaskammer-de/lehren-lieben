// Markup der Abspiel-Elemente — eine Quelle für Server (Astro) und Browser
// (z. B. die Zufallsfolge). Reiner String-Code, ohne DOM-Zugriff.

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const dateFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function dateLabel(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? '' : dateFmt.format(date);
}

/** Play-Dreieck, Pause-Balken, Equalizer (läuft) und Ladering — per CSS umgeschaltet. */
export const GLYPH = `<span class="ep-play-glyph" aria-hidden="true"><svg class="g-play" viewBox="0 0 24 24"><path d="M8.5 5.9v12.2c0 .8.9 1.3 1.6.9l9.3-6.1a1 1 0 0 0 0-1.7L10.1 5c-.7-.4-1.6.1-1.6.9z"/></svg><svg class="g-pause" viewBox="0 0 24 24"><rect x="6.2" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.6" y="5" width="4.2" height="14" rx="1.3"/></svg><span class="g-eq"><i></i><i></i><i></i></span><span class="g-wait"></span></span>`;

type StripEp = { id: string; cls: string; title: string; audio: string; url: string };

const STRIP_NEW = 'Jetzt anhören';

/**
 * Player-Leiste für Folgen-Karten: großer Play-Kreis, Aufforderung, Zeitleiste
 * und Dauer bzw. Restzeit. Beschriftung je Zustand übernimmt syncCards(),
 * die Leiste füllt sich über --ep-progress der Karte.
 * Ohne Audio-Datei wird daraus ein Link zu Podigee im selben Look.
 */
export function playStripHTML(ep: StripEp, durText = ''): string {
  const inner = (label: string, labelAttrs: string) =>
    GLYPH +
    `<span class="ep-strip-label"${labelAttrs}>${label}</span>` +
    `<span class="ep-strip-track" aria-hidden="true"><span class="ep-strip-fill"></span></span>` +
    `<span class="ep-strip-dur"${ep.audio ? ' data-ep-dur' : ''}>${esc(durText)}</span>`;

  if (!ep.audio) {
    return `<a class="ep-strip ${esc(ep.cls)}" href="${esc(ep.url)}" target="_blank" rel="noopener">${inner('Bei Podigee anhören', '')}</a>`;
  }
  return (
    `<button type="button" class="ep-strip ${esc(ep.cls)}" data-play="${esc(ep.id)}" data-state="new" aria-pressed="false" aria-label="${esc(`${STRIP_NEW}: ${ep.title}`)}">` +
    inner(
      STRIP_NEW,
      ` data-play-label data-label-new="${STRIP_NEW}" data-label-playing="Läuft gerade" data-label-loading="Lädt …"`,
    ) +
    `</button>`
  );
}

/** Zeile unter der Leiste: Datum links, Shownotes rechts. */
export function listenMetaHTML(ep: { url: string }, date: string): string {
  return (
    `<div class="ep-listen-meta">` +
    (date ? `<span class="ep-date">${esc(date)}</span>` : '') +
    `<a class="ep-link" href="${esc(ep.url)}" target="_blank" rel="noopener">Shownotes</a>` +
    `</div>`
  );
}
