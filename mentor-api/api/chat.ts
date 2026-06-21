import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
// ESM-Pflicht auf Vercel: relative Importe mit .js-Endung, JSON mit Import-Attribut.
import { SYSTEM_PROMPT } from '../prompt.js';
import {
  embedQuery,
  topChunks,
  lexicalTop,
  buildContext,
  hasEmbeddings,
  type Chunk,
} from '../lib/rag.js';
import { checkRateLimit, clientIp } from '../lib/ratelimit.js';
import corpusData from '../corpus.json' with { type: 'json' };

const MODEL = 'claude-sonnet-4-6';
const DAILY_LIMIT = 20; // max. Anfragen pro IP und Tag (Missbrauchsschutz)

// Von welchen Seiten darf das Widget die Funktion aufrufen (CORS).
const ALLOWED_ORIGINS = new Set([
  'https://lehrenlieben.de',
  'https://www.lehrenlieben.de',
  'http://localhost:4321',
]);

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function setCors(res: VercelResponse, origin: string | undefined): void {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Missbrauchsschutz: max. DAILY_LIMIT Anfragen pro IP und Tag.
  const ip = clientIp(req.headers);
  const rate = await checkRateLimit(ip, DAILY_LIMIT);
  if (!rate.ok) {
    res.setHeader('Retry-After', '3600');
    res.status(429).json({
      error: `Tageslimit von ${DAILY_LIMIT} Fragen erreicht. Schau morgen gern wieder vorbei.`,
    });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    res.status(503).json({
      error: 'ANTHROPIC_API_KEY ist nicht gesetzt. Bitte in den Vercel-Env-Vars hinterlegen.',
    });
    return;
  }

  const body = (req.body ?? {}) as { messages?: unknown };
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    res.status(400).json({ error: 'No messages provided' });
    return;
  }

  // Auf die letzten ~10 Nachrichten kürzen und je Nachricht begrenzen.
  let convo: ChatMessage[] = rawMessages.slice(-10).map((m) => {
    const msg = m as { role?: unknown; content?: unknown };
    return {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: String(msg.content ?? '').slice(0, 2000),
    };
  });

  // Claude verlangt eine User-Nachricht als ersten Eintrag — die Begrüßung des
  // Widgets ist eine Assistant-Nachricht, daher führende Assistant-Turns entfernen.
  while (convo.length > 0 && convo[0].role === 'assistant') {
    convo = convo.slice(1);
  }
  if (convo.length === 0) {
    res.status(400).json({ error: 'Keine Nutzerfrage gefunden' });
    return;
  }

  // RAG: solange der Corpus gefüllt ist, wird immer abgerufen.
  //  - Mit Embeddings + OpenAI-Key: semantische Vektor-Suche.
  //  - Sonst: keyless lexikalische Stichwort-Suche (Fallback).
  let context = '';
  const corpus = corpusData as unknown as Chunk[];
  const openaiKey = process.env.OPENAI_API_KEY;
  const lastUser = [...convo].reverse().find((m) => m.role === 'user');
  if (corpus.length > 0 && lastUser) {
    try {
      if (hasEmbeddings(corpus) && openaiKey) {
        const queryEmbedding = await embedQuery(lastUser.content, openaiKey);
        context = buildContext(topChunks(queryEmbedding, corpus, 8));
      } else {
        context = buildContext(lexicalTop(lastUser.content, corpus, 8));
      }
    } catch (err) {
      // Retrieval-Fehler darf den Chat nicht blockieren — lexikalisch weiterversuchen.
      console.warn('RAG retrieval failed, fallback lexical:', err);
      try {
        context = buildContext(lexicalTop(lastUser.content, corpus, 8));
      } catch {
        /* zur Not ganz ohne Kontext weiter */
      }
    }
  }

  const system = context
    ? `${SYSTEM_PROMPT}\n\n--- TRANSKRIPT-AUSZÜGE (Wissensbasis für genau diese Frage) ---\n${context}\n--- ENDE AUSZÜGE ---\n\nAntworte ausschließlich auf Basis dieser Auszüge, ohne Zwischenüberschriften. Schreibe Tipps der richtigen Person zu (Moderator vs. Preisträger:in). Setze unter JEDEN Tipp direkt (eigene Zeile) seinen Reinhören-Link in der Form „🎧 Folge #N „Titel" ab MM:SS — URL" und übernimm die URL (mit #t=) unverändert aus dem Auszug — sammle die Links NICHT am Ende. Steht die Antwort nicht in den Auszügen, sag das ehrlich.`
    : SYSTEM_PROMPT;

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system,
      messages: convo,
    });

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    res.status(200).json({ reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(502).json({ error: `Claude: ${msg}` });
  }
}
