import { XMLParser } from 'fast-xml-parser';

export type Episode = {
  id: string;         // stable id (RSS guid) — used by the player & progress storage
  show: 'Bester Job der Welt' | 'Ausgezeichnete Lehrkräfte';
  cls: 'amber' | 'teal';
  ep: string;         // e.g. "#17" — empty if not provided
  title: string;
  desc: string;       // plain text, truncated
  summary: string;    // plain text, full length, paragraphs separated by "\n"
  dur: string;        // e.g. "42 min" — empty if not parseable
  durSec: number;     // duration in seconds — 0 if unknown
  url: string;        // episode page URL (podigee)
  audio: string;      // mp3 enclosure — empty if missing
  image: string;      // episode artwork, falls back to the show artwork
  transcript: string; // JSON transcript (timestamped segments) — empty if none
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
    id: 'fallback-bjdw',
    show: 'Bester Job der Welt',
    cls: 'amber',
    ep: '#17',
    title: 'Ferien-Talk: Rebellentreff und Rückenwind',
    desc: 'Alex und Tobi nehmen euch hinter die Kulissen — und verraten die erste Maxime guter Lehrkraftarbeit.',
    summary: 'Alex und Tobi nehmen euch hinter die Kulissen — und verraten die erste Maxime guter Lehrkraftarbeit.',
    dur: '42 min',
    durSec: 2520,
    url: 'https://lehrkraftbesterjobderwelt.podigee.io',
    audio: '',
    image: '',
    transcript: '',
    pubDate: new Date('2026-04-16'),
  },
  {
    id: 'fallback-al',
    show: 'Ausgezeichnete Lehrkräfte',
    cls: 'teal',
    ep: '',
    title: 'Monika Ried-Broschwitz — Preisträgerin des Deutschen Lehrkräftepreises 2024',
    desc: 'Tobi und Alex sprechen mit Monika Ried-Broschwitz über Haltung, Vorbilder und das, was Schüler:innen wirklich brauchen.',
    summary: 'Tobi und Alex sprechen mit Monika Ried-Broschwitz über Haltung, Vorbilder und das, was Schüler:innen wirklich brauchen.',
    dur: '58 min',
    durSec: 3480,
    url: 'https://deutschlandsausgezeichnetelaehrkraefte.podigee.io',
    audio: '',
    image: '',
    transcript: '',
    pubDate: new Date('2026-04-10'),
  },
];

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Like stripHtml, but keeps paragraph breaks as "\n". */
function toParagraphs(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Manche Beschreibungen kommen mit Markdown aus Podigee ("### **Willkommen…").
 * Wir zeigen Klartext: Überschriften-Rauten und Fett-Markierungen raus, Links als
 * "Text (URL)". Einzelne Sternchen bleiben — sonst verschwände das Gendersternchen.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*|__/g, '');
}

function truncate(text: string, max = 220): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 120 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[.,;:!?\s]+$/, '') + '…';
}

function parseDurationSec(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;

  if (s.includes(':')) {
    const parts = s.split(':').map((n) => Number(n));
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  const num = Number(s);
  return !Number.isNaN(num) && num > 0 ? num : 0;
}

function formatDuration(seconds: number): string {
  return seconds > 0 ? `${Math.max(1, Math.round(seconds / 60))} min` : '';
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

function attr(node: unknown, name: string): string {
  if (node && typeof node === 'object') {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    if (typeof v === 'string') return v;
  }
  return '';
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
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

  const showImage = attr(asArray(channel['itunes:image'])[0], 'href');
  const items = asArray<any>(channel.item);

  const episodes: Episode[] = [];
  for (const it of items) {
    const title = stripHtml(extractText(it.title));
    const link = extractText(it.link);
    const pubRaw = extractText(it.pubDate);
    const pubDate = pubRaw ? new Date(pubRaw) : new Date(0);
    if (isNaN(pubDate.getTime())) continue;
    if (!title || !link) continue;

    const rawDesc =
      extractText(it['itunes:subtitle']) ||
      extractText(it['itunes:summary']) ||
      extractText(it.description) ||
      '';
    const rawSummary =
      extractText(it['itunes:summary']) || extractText(it.description) || rawDesc;

    const epNumRaw = extractText(it['itunes:episode']);
    const durSec = parseDurationSec(it['itunes:duration']);
    const transcript =
      asArray<any>(it['podcast:transcript']).find((t) => attr(t, 'type').includes('json'));

    episodes.push({
      id: extractText(it.guid) || link,
      show: feed.show,
      cls: feed.cls,
      ep: epNumRaw ? `#${epNumRaw}` : '',
      title,
      desc: truncate(stripHtml(stripMarkdown(rawDesc)), 220),
      summary: stripMarkdown(toParagraphs(rawSummary)),
      dur: formatDuration(durSec),
      durSec,
      url: link,
      audio: attr(asArray(it.enclosure)[0], 'url'),
      image: attr(asArray(it['itunes:image'])[0], 'href') || showImage,
      transcript: transcript ? attr(transcript, 'url') : '',
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
