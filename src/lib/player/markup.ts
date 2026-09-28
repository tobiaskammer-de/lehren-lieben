// Markup der Abspiel-Buttons — eine Quelle für Server (Astro) und Browser
// (z. B. die Zufallsfolge). Reiner String-Code, ohne DOM-Zugriff.

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Play-Dreieck, Pause-Balken, Equalizer (läuft) und Ladering — per CSS umgeschaltet. */
export const GLYPH = `<span class="ep-play-glyph" aria-hidden="true"><svg class="g-play" viewBox="0 0 24 24"><path d="M8.5 5.9v12.2c0 .8.9 1.3 1.6.9l9.3-6.1a1 1 0 0 0 0-1.7L10.1 5c-.7-.4-1.6.1-1.6.9z"/></svg><svg class="g-pause" viewBox="0 0 24 24"><rect x="6.2" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.6" y="5" width="4.2" height="14" rx="1.3"/></svg><span class="g-eq"><i></i><i></i><i></i></span><span class="g-wait"></span></span>`;

type ButtonEp = { id: string; cls: string; title: string };

export function playButtonHTML(
  ep: ButtonEp,
  variant: 'pill' | 'round' = 'pill',
  labelNew = 'Abspielen',
): string {
  const label =
    variant === 'pill'
      ? `<span class="ep-play-label" data-play-label data-label-new="${esc(labelNew)}">${esc(labelNew)}</span>`
      : '';
  return `<button type="button" class="ep-play ep-play--${variant} ${esc(ep.cls)}" data-play="${esc(ep.id)}" data-state="new" aria-pressed="false" aria-label="${esc(`${labelNew}: ${ep.title}`)}">${GLYPH}${label}</button>`;
}
