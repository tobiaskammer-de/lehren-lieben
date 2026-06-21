// Baut die "Datenbank" des Lehrkraftmentors:
//   Podigee-Feeds → Transkript-JSON je Folge → Häppchen → OpenAI-Embeddings
//   → mentor-api/corpus.json
//
// Aufruf (Node 22+):
//   node --env-file=.env --experimental-strip-types scripts/build-corpus.ts
// Benötigt OPENAI_API_KEY (in .env oder als Umgebungsvariable).
//
// Ein Embedding-Cache (scripts/.embed-cache.json) sorgt dafür, dass nur neue/
// geänderte Häppchen neu embedded werden — wiederholte Läufe kosten ~0.

import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

type Feed = { show: string; url: string };
type Chunk = {
  text: string;
  episodeTitle: string;
  show: string;
  ep: string;
  url: string;
  embedding: number[];
};

const FEEDS: Feed[] = [
  { show: 'Bester Job der Welt', url: 'https://lehrkraftbesterjobderwelt.podigee.io/feed/mp3' },
  { show: 'Ausgezeichnete Lehrkräfte', url: 'https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/feed/mp3' },
];

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 512; // muss zu mentor-api/lib/rag.ts passen
const CHUNK_CHARS = 1800; // ~500 Token
const CHUNK_OVERLAP = 200;

const OUT = new URL('../mentor-api/corpus.json', import.meta.url);
const CACHE = new URL('./.embed-cache.json', import.meta.url);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error(
    'OPENAI_API_KEY fehlt.\n' +
      'Aufruf: node --env-file=.env --experimental-strip-types scripts/build-corpus.ts',
  );
  process.exit(1);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

function extractText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o['#text'] === 'string') return o['#text'];
  }
  return String(node);
}

type TranscriptJob = { episodeTitle: string; ep: string; show: string; url: string; transcriptUrl: string };

function transcriptJobsFromFeed(xml: string, show: string): TranscriptJob[] {
  const parsed = parser.parse(xml) as any;
  const channel = parsed?.rss?.channel;
  const items = Array.isArray(channel?.item) ? channel.item : channel?.item ? [channel.item] : [];
  const jobs: TranscriptJob[] = [];

  for (const it of items) {
    const title = extractText(it.title).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const url = extractText(it.link);
    const epNum = extractText(it['itunes:episode']);
    const ep = epNum ? `#${epNum}` : '';

    let tags = it['podcast:transcript'];
    if (!tags) continue;
    if (!Array.isArray(tags)) tags = [tags];

    // JSON-Transkript bevorzugen (sauber strukturiert), sonst VTT.
    const json = tags.find((t: any) => String(t?.['@_type']).includes('json'));
    const chosen = json ?? tags[0];
    const transcriptUrl = chosen?.['@_url'];
    if (!transcriptUrl || !title) continue;

    jobs.push({ episodeTitle: title, ep, show, url, transcriptUrl });
  }
  return jobs;
}

async function fetchTranscriptText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'lehrenlieben.de corpus builder' } });
  if (!res.ok) throw new Error(`transcript ${res.status}`);

  if (url.endsWith('.json')) {
    const segments = (await res.json()) as { text?: string }[];
    return segments.map((s) => s.text ?? '').join(' ');
  }
  // VTT: Zeitstempel/Cue-Nummern grob entfernen.
  const vtt = await res.text();
  return vtt
    .split('\n')
    .filter((l) => l && !l.includes('-->') && !/^\d+$/.test(l.trim()) && l.trim() !== 'WEBVTT')
    .join(' ');
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
      if (stop > CHUNK_CHARS * 0.5) end = start + stop + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

type Cache = Record<string, number[]>;

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(CACHE, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

function cacheKey(text: string): string {
  return createHash('sha256').update(`${EMBED_MODEL}:${EMBED_DIMENSIONS}:${text}`).digest('hex');
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text, dimensions: EMBED_DIMENSIONS }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data: { embedding: number[] }[] };
  return j.data[0].embedding;
}

async function main(): Promise<void> {
  const cache = await loadCache();
  const jobs: TranscriptJob[] = [];

  for (const feed of FEEDS) {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'lehrenlieben.de corpus builder' } });
    if (!res.ok) {
      console.warn(`Feed ${feed.url} → HTTP ${res.status}, übersprungen`);
      continue;
    }
    const found = transcriptJobsFromFeed(await res.text(), feed.show);
    console.log(`[${feed.show}] ${found.length} Folgen mit Transkript`);
    jobs.push(...found);
  }

  const corpus: Chunk[] = [];
  let embedded = 0;
  let cached = 0;

  for (const job of jobs) {
    let raw: string;
    try {
      raw = await fetchTranscriptText(job.transcriptUrl);
    } catch (err) {
      console.warn(`  Transkript fehlgeschlagen (${job.episodeTitle}):`, err);
      continue;
    }
    const chunks = chunkText(raw);
    for (const text of chunks) {
      const key = cacheKey(text);
      let embedding = cache[key];
      if (embedding) {
        cached++;
      } else {
        embedding = await embed(text);
        cache[key] = embedding;
        embedded++;
      }
      corpus.push({ text, episodeTitle: job.episodeTitle, show: job.show, ep: job.ep, url: job.url, embedding });
    }
    console.log(`  ✓ ${job.episodeTitle} (${chunks.length} Häppchen)`);
  }

  await writeFile(OUT, JSON.stringify(corpus));
  await writeFile(CACHE, JSON.stringify(cache));
  console.log(
    `\nFertig: ${corpus.length} Häppchen aus ${jobs.length} Folgen → mentor-api/corpus.json ` +
      `(${embedded} neu embedded, ${cached} aus Cache)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
