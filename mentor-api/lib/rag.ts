// Retrieval-Helfer für den Lehrkraftmentor.
//
// Zwei Modi:
//  1) Vektor-Suche (Embeddings) — wenn corpus.json Vektoren enthält UND zur
//     Laufzeit ein OPENAI_API_KEY vorliegt. Embedding-Parameter MÜSSEN mit
//     scripts/build-corpus.mjs übereinstimmen.
//  2) Lexikalische Suche (keyless) — Fallback, wenn keine Vektoren/kein Key da
//     sind. Funktioniert ohne externe API über Stichwort-Treffer.

export type Chunk = {
  kind?: 'insight' | 'raw';
  text: string;
  // Insight-Felder (bei kind:"raw" leer):
  topic?: string;
  insight?: string;
  quote?: string;
  speaker?: string;
  role?: string;
  category?: string;
  // Quellen-Metadaten:
  episodeTitle: string;
  show: string;
  ep: string;
  url: string;
  // Minutengenauigkeit:
  tsDisplay?: string;
  tStart?: number | null;
  deeplink?: string;
  embedding: number[];
};

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 512; // muss zu scripts/build-corpus.mjs passen

/** Embedded die Nutzerfrage über OpenAI (Anthropic hat keine Embeddings-API). */
export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
      dimensions: EMBED_DIMENSIONS,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

/** Enthält der Corpus brauchbare Vektoren? */
export function hasEmbeddings(corpus: Chunk[]): boolean {
  return corpus.length > 0 && Array.isArray(corpus[0].embedding) && corpus[0].embedding.length > 0;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Die k ähnlichsten Häppchen zur Frage per Cosine (nur mit Embeddings). */
export function topChunks(queryEmbedding: number[], corpus: Chunk[], k = 8): Chunk[] {
  return corpus
    .map((c) => ({ c, score: cosine(queryEmbedding, c.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((x) => x.c);
}

// --- Lexikalische Suche (keyless Fallback) ---

const STOP = new Set([
  'und', 'oder', 'aber', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem',
  'einer', 'eines', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'dein', 'sein', 'für',
  'mit', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'nach', 'über', 'unter', 'wie', 'was',
  'wer', 'wann', 'warum', 'wieso', 'welche', 'welcher', 'welches', 'man', 'mir', 'mich',
  'dir', 'dich', 'sich', 'nicht', 'auch', 'noch', 'schon', 'denn', 'dass', 'weil', 'wenn', 'als',
  'also', 'mal', 'gibt', 'haben', 'habe', 'hat', 'ist', 'sind', 'war', 'werden', 'wird',
  'soll', 'sollte', 'muss', 'gern', 'bitte', 'meine', 'meiner', 'einige', 'etwas', 'immer',
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-zäöüß][a-zäöüß0-9]{2,}/g) || []).filter((t) => !STOP.has(t));
}

/**
 * Die k besten Häppchen per Stichwort-Treffer (ohne externe API).
 * TF-IDF-artig: seltene, spezifische Begriffe (z. B. „Stimme") zählen mehr als
 * Allerweltswörter (z. B. „Lehrer", „Schüler"), die fast überall vorkommen.
 */
export function lexicalTop(query: string, corpus: Chunk[], k = 8): Chunk[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return corpus.slice(0, k);

  const N = corpus.length;
  const df = terms.map(() => 0);
  const counts = corpus.map((c) => {
    const hay = (c.text || '').toLowerCase();
    return terms.map((t, ti) => {
      let idx = hay.indexOf(t);
      let n = 0;
      while (idx !== -1) {
        n++;
        idx = hay.indexOf(t, idx + t.length);
      }
      if (n > 0) df[ti]++;
      return n;
    });
  });
  const idf = df.map((d) => Math.log(1 + N / (1 + d)));

  const scored = corpus
    .map((c, ci) => {
      let score = 0;
      const cnt = counts[ci];
      for (let ti = 0; ti < terms.length; ti++) {
        if (cnt[ti] > 0) score += idf[ti] * (1 + Math.log(1 + cnt[ti]));
      }
      if (score === 0) return { c, score: 0 };
      // lange Roh-Häppchen nicht bevorzugen; destillierte Karten leicht boosten
      score /= Math.sqrt(Math.max(80, (c.text || '').length) / 140);
      if (c.kind === 'insight') score *= 1.4;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map((x) => x.c);
}

/**
 * Baut den Kontext-Block für den System-Prompt — inkl. Quelle, Zeitmarke,
 * Sprecher/Rolle und fertigem „Reinhören"-Link, damit der Mentor exakt und
 * minutengenau zitieren kann.
 */
export function buildContext(chunks: Chunk[]): string {
  if (chunks.length === 0) return '';
  return chunks
    .map((c, i) => {
      const ep = c.ep ? `Folge ${c.ep}, ` : '';
      const head = `[${i + 1}] Podcast „${c.show}" — ${ep}„${c.episodeTitle}"`;
      const ts = c.tsDisplay ? ` (Zeitmarke ${c.tsDisplay})` : '';
      const link = c.deeplink || c.url || '';
      const bodyText =
        c.kind === 'insight'
          ? `${c.speaker || '?'}${c.role ? ` [${c.role}]` : ''}: ${c.insight}\n   O-Ton: »${c.quote}«`
          : c.text;
      return `${head}${ts}\n   ${bodyText}${link ? `\n   Reinhören-Link: ${link}` : ''}`;
    })
    .join('\n\n');
}
