// Baut die Wissensbasis des Lehrkraftmentors: mentor-api/corpus.json
//
// Zwei Schichten (Hybrid):
//   A) Insight-Karten   (transcripts/distilled/*.json)  -> kind:"insight"
//   B) Roh-Häppchen     (transcripts/extracted/*.txt)   -> kind:"raw"
// Metadaten (show, ep, Titel, URL) je Folge aus transcripts/episode-map.json.
// Jede Einheit trägt eine Zeitmarke + Deeplink (?t=Sekunden) für „minutengenau".
//
// Embeddings sind OPTIONAL: liegt OPENAI_API_KEY vor, wird jede Einheit
// embedded (text-embedding-3-small, 512 dims — muss zu mentor-api/lib/rag.ts
// passen); fehlt der Key, wird corpus.json OHNE Vektoren geschrieben und die
// Laufzeit nutzt die lexikalische Suche (keyless). Später Key setzen +
// `npm run build:corpus` erneut -> Vektor-Suche wird automatisch aktiv.
//
// Aufruf: npm run build:corpus

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const DISTILLED = new URL('transcripts/distilled/', ROOT);
const EXTRACTED = new URL('transcripts/extracted/', ROOT);
const MAP = new URL('transcripts/episode-map.json', ROOT);
const OUT = new URL('mentor-api/corpus.json', ROOT);
const CACHE = new URL('scripts/.embed-cache.json', ROOT);

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 512; // muss zu mentor-api/lib/rag.ts passen
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 200;

const apiKey = process.env.OPENAI_API_KEY || '';

/** "12:30" / "12:30.500" / "1:05:20" / "0:08" -> Sekunden (ganzzahlig). */
function tsToSeconds(ts) {
  if (!ts) return null;
  const m = String(ts).trim().match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]), c = m[3] !== undefined ? Number(m[3]) : null;
  return c !== null ? a * 3600 + b * 60 + c : a * 60 + b; // H:MM:SS vs (M)M:SS
}

function deeplink(url, seconds) {
  if (!url) return '';
  if (seconds == null) return url;
  // Podigee springt NUR über den URL-Hash zur Zeit (#t=Sekunden) — ?t= wird ignoriert.
  return `${url}#t=${seconds}`;
}

/** Header (4 Zeilen + Trennlinie) vom Body trennen. */
function stripHeader(txt) {
  const i = txt.indexOf('='.repeat(60));
  return i === -1 ? txt : txt.slice(i + 60).trim();
}

const FIRST_TS = /\((\d{1,3}:\d{2}(?:[.,]\d+)?)\)/;

/** Text an Satzgrenzen in ~CHUNK_CHARS-Häppchen mit Überlappung zerlegen. */
function chunkText(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
      if (lastStop > CHUNK_CHARS * 0.5) end = i + lastStop + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = end - CHUNK_OVERLAP;
  }
  return chunks;
}

async function main() {
  const episodes = JSON.parse(await readFile(MAP, 'utf8'));
  const byId = Object.fromEntries(episodes.map((e) => [e.id, e]));
  const corpus = [];

  // ---------- Schicht A: Insight-Karten ----------
  let cardCount = 0;
  const distFiles = (await readdir(DISTILLED)).filter((f) => f.endsWith('.json'));
  for (const f of distFiles.sort()) {
    const id = f.slice(0, -5);
    const ep = byId[id];
    if (!ep) { console.warn(`  [WARN] keine Episode-Metadaten für ${id}`); continue; }
    const cards = JSON.parse(await readFile(new URL(f, DISTILLED), 'utf8'));
    for (const c of cards) {
      const tsClean = (c.tsDisplay || '').replace(/[()[\]]/g, '').trim();
      const sec = tsToSeconds(tsClean);
      const text =
        `Thema: ${c.topic || ''}\n${c.insight || ''}\n` +
        `O-Ton ${c.speaker || '?'}${c.role ? ` (${c.role})` : ''}: »${c.quote || ''}«`;
      corpus.push({
        kind: 'insight',
        text,
        topic: c.topic || '',
        insight: c.insight || '',
        quote: c.quote || '',
        speaker: c.speaker || '',
        role: c.role || '',
        category: c.category || '',
        show: ep.show,
        ep: ep.ep || '',
        episodeTitle: ep.title,
        url: ep.url || '',
        tsDisplay: tsClean,
        tStart: sec,
        deeplink: deeplink(ep.url, sec),
        embedding: [],
      });
      cardCount++;
    }
  }

  // ---------- Schicht B: Roh-Häppchen ----------
  let rawCount = 0;
  for (const ep of episodes) {
    const path = new URL(`${ep.id}.txt`, EXTRACTED);
    if (!existsSync(path)) continue;
    const body = stripHeader(await readFile(path, 'utf8'));
    for (const piece of chunkText(body)) {
      const m = piece.match(FIRST_TS);
      const sec = m ? tsToSeconds(m[1]) : null;
      corpus.push({
        kind: 'raw',
        text: piece,
        topic: '', insight: '', quote: '', speaker: '', role: '', category: '',
        show: ep.show,
        ep: ep.ep || '',
        episodeTitle: ep.title,
        url: ep.url || '',
        tsDisplay: m ? m[1] : '',
        tStart: sec,
        deeplink: deeplink(ep.url, sec),
        embedding: [],
      });
      rawCount++;
    }
  }

  // ---------- Optional: Embeddings ----------
  if (apiKey) {
    const cache = existsSync(CACHE) ? JSON.parse(await readFile(CACHE, 'utf8')) : {};
    let embedded = 0, cached = 0;
    for (const item of corpus) {
      const h = createHash('sha1').update(EMBED_MODEL + '|' + item.text).digest('hex');
      if (cache[h]) { item.embedding = cache[h]; cached++; continue; }
      item.embedding = await embed(item.text);
      cache[h] = item.embedding;
      embedded++;
      if (embedded % 50 === 0) console.log(`  ...${embedded} embedded`);
    }
    await writeFile(CACHE, JSON.stringify(cache));
    console.log(`Embeddings: ${embedded} neu, ${cached} aus Cache.`);
  } else {
    console.log('OPENAI_API_KEY fehlt -> corpus.json OHNE Vektoren (lexikalische Laufzeit-Suche).');
  }

  await writeFile(OUT, JSON.stringify(corpus));
  const mb = (JSON.stringify(corpus).length / 1e6).toFixed(2);
  console.log(`\ncorpus.json geschrieben: ${corpus.length} Einheiten (${cardCount} Karten + ${rawCount} Roh-Häppchen), ${mb} MB`);
  console.log(`Embeddings im Corpus: ${apiKey ? 'JA' : 'nein (lexikalisch)'}`);
}

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text, dimensions: EMBED_DIMENSIONS }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data[0].embedding;
}

main().catch((e) => { console.error(e); process.exit(1); });
