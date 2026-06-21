// Retrieval-Helfer für den Lehrkraftmentor.
// Die Embedding-Parameter MÜSSEN mit scripts/build-corpus.ts übereinstimmen,
// sonst passen die Vektoren der Frage nicht zu denen im corpus.json.

export type Chunk = {
  text: string;
  episodeTitle: string;
  show: string;
  ep: string;
  url: string;
  embedding: number[];
};

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 512; // muss zu build-corpus.ts passen

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

/** Die k ähnlichsten Transkript-Häppchen zur Frage (Brute-Force-Cosine). */
export function topChunks(queryEmbedding: number[], corpus: Chunk[], k = 8): Chunk[] {
  return corpus
    .map((c) => ({ c, score: cosine(queryEmbedding, c.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((x) => x.c);
}

/** Baut den Kontext-Block für den System-Prompt aus den gefundenen Häppchen. */
export function buildContext(chunks: Chunk[]): string {
  if (chunks.length === 0) return '';
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] Aus „${c.episodeTitle}"${c.ep ? ` (${c.ep})` : ''} (${c.show}):\n${c.text}`,
    )
    .join('\n\n');
}
