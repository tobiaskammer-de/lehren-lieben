// Folgen-Katalog für den Player. Wird beim Build als JSON in jede Seite
// geschrieben (<script id="ll-catalog">) und hier einmalig eingelesen.

export type CatalogEpisode = {
  id: string;
  show: string;
  cls: 'amber' | 'teal';
  ep: string;
  title: string;
  desc: string;
  url: string;
  audio: string;
  dur: number; // Sekunden
  image: string;
  transcript: string;
  date: string; // ISO
};

type Catalog = {
  list: CatalogEpisode[];
  byId: Map<string, CatalogEpisode>;
  byUrl: Map<string, CatalogEpisode>;
};

let cache: Catalog | null = null;

/** Vergleichbare Form einer Folgen-URL: Origin + Pfad, ohne Hash/Query/Slash. */
export function normalizeUrl(href: string): string {
  try {
    const u = new URL(href, window.location.href);
    return (u.origin + u.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

export function catalog(): Catalog {
  if (cache) return cache;
  let list: CatalogEpisode[] = [];
  try {
    list = JSON.parse(document.getElementById('ll-catalog')?.textContent || '[]');
  } catch {
    list = [];
  }
  const built: Catalog = {
    list,
    byId: new Map(list.map((e) => [e.id, e])),
    byUrl: new Map(list.map((e) => [normalizeUrl(e.url), e])),
  };
  // Nur ein befüllter Katalog wird gemerkt — ein leerer Versuch darf später wiederholt werden.
  if (list.length) cache = built;
  return built;
}
