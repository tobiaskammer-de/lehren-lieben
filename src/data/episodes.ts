import { XMLParser } from 'fast-xml-parser';

export type Episode = {
  show: 'Bester Job der Welt' | 'Ausgezeichnete Lehrkräfte';
  cls: 'amber' | 'teal';
  ep: string;         // e.g. "#17" — empty if not provided
  title: string;
  desc: string;       // plain text, truncated
  dur: string;        // e.g. "42 min" — empty if not parseable
  url: string;        // episode page URL (podigee)
  pubDate: Date;
};

type FeedConfig = {
  show: Episode['show'];
  cls: Episode['cls'];
  url: string;
};

const FEEDS: FeedConfig[] = [
  {
    show: 'Bester Job der Welt',
    cls: 'amber',
    url: 'https://lehrkraftbesterjobderwelt.podigee.io/feed/mp3',
  },
  {
    show: 'Ausgezeichnete Lehrkräfte',
    cls: 'teal',
    url: 'https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/feed/mp3',
  },
];

/**
 * Fallback data if the RSS fetch fails at build time.
 * Never shown in normal operation — only if Podigee is unreachable
 * during the GitHub Actions build.
 */
const FALLBACK: Episode[] = [
  {
    show: 'Bester Job der Welt',
    cls: 'amber',
    ep: '#17',
    title: 'Ferien-Talk: Rebellentreff und Rückenwind',
    desc: 'Alex und Tobi nehmen euch hinter die Kulissen — und verraten die erste Maxime guter Lehrkraftarbeit.',
    dur: '42 min',
    url: 'https://lehrkraftbesterjobderwelt.podigee.io',
    pubDate: new Date('2026-04-16'),
  },
  {
    show: 'Ausgezeichnete Lehrkräfte',
    cls: 'teal',
    ep: '',
    title: 'Monika Ried-Broschwitz — Preisträgerin des Deutschen Lehrkräftepreises 2024',
    desc: 'Tobi und Alex sprechen mit Monika Ried-Broschwitz über Haltung, Vorbilder und das, was Schüler:innen wirklich brauchen.',
    dur: '58 min',
    url: 'https://deutschlandsausgezeichnetelaehrkraefte.podigee.io',
    pubDate: new Date('2026-04-10'),
  },
];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max = 220): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 120 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[.,;:!?\s]+$/, '') + '…';
}

function parseDuration(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  const s = String(raw).trim();
  if (!s) return '';

  if (s.includes(':')) {
    const parts = s.split(':').map((n) => Number(n));
    if (parts.some(Number.isNaN)) return '';
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else seconds = parts[0];
    return `${Math.round(seconds / 60)} min`;
  }

  const num = Number(s);
  if (!Number.isNaN(num) && num > 0) {
    return `${Math.round(num / 60)} min`;
  }
  return '';
}

function extractText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o['#text'] === 'string') return o['#text'];
    if (typeof o['_'] === 'string') return o['_'] as string;
  }
  return String(node);
}

async function fetchFeed(feed: FeedConfig): Promise<Episode[]> {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': 'lehrenlieben.de static site builder' },
  });
  if (!res.ok) {
    throw new Error(`${feed.url} → HTTP ${res.status}`);
  }
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml);
  const channel = (parsed as any)?.rss?.channel;
  if (!channel) throw new Error(`no <channel> in ${feed.url}`);

  const items = Array.isArray(channel.item)
    ? channel.item
    : channel.item
      ? [channel.item]
      : [];

  const episodes: Episode[] = [];
  for (const it of items) {
    const title = stripHtml(extractText(it.title));
    const link = extractText(it.link);
    const pubRaw = extractText(it.pubDate);
    const pubDate = pubRaw ? new Date(pubRaw) : new Date(0);
    if (isNaN(pubDate.getTime())) continue;

    const rawDesc =
      extractText(it['itunes:subtitle']) ||
      extractText(it['itunes:summary']) ||
      extractText(it.description) ||
      '';
    const descText = truncate(stripHtml(rawDesc), 220);

    const epNumRaw = extractText(it['itunes:episode']);
    const ep = epNumRaw ? `#${epNumRaw}` : '';

    const dur = parseDuration(it['itunes:duration']);

    if (!title || !link) continue;

    episodes.push({
      show: feed.show,
      cls: feed.cls,
      ep,
      title,
      desc: descText,
      dur,
      url: link,
      pubDate,
    });
  }

  return episodes;
}

async function loadAllEpisodes(): Promise<Episode[]> {
  try {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const all = results.flat();
    if (all.length === 0) throw new Error('no episodes parsed from any feed');

    all.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

    // eslint-disable-next-line no-console
    console.log(
      `[episodes] loaded ${all.length} from RSS (${results
        .map((r, i) => `${FEEDS[i].show}: ${r.length}`)
        .join(', ')})`,
    );

    return all;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[episodes] RSS fetch failed, using fallback.', err);
    return FALLBACK;
  }
}

// Top-level await — resolved once during Astro build.
export const episodes: Episode[] = await loadAllEpisodes();

/**
 * Latest two episodes: one from each show if possible (so the "Frisch raus"
 * section always shows both podcasts), otherwise just the two newest overall.
 */
export function latestTwo(): Episode[] {
  const newest = {
    amber: episodes.find((e) => e.cls === 'amber'),
    teal: episodes.find((e) => e.cls === 'teal'),
  };
  if (newest.amber && newest.teal) {
    return [newest.amber, newest.teal].sort(
      (a, b) => b.pubDate.getTime() - a.pubDate.getTime(),
    );
  }
  return episodes.slice(0, 2);
}

export function latestFor(cls: Episode['cls']): Episode | undefined {
  return episodes.find((e) => e.cls === cls);
}
