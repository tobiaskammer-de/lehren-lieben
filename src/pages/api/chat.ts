import type { APIRoute } from 'astro';

// This endpoint runs as a Vercel serverless function.
export const prerender = false;

const SYSTEM_PROMPT = `Du bist der "Lehrkräftementor" von Lehren Lieben. — einer Podcast-
Plattform für Lehrkräfte von Tobias Kammer und Alexander Böhle.

Ton: warm, persönlich, professionell, nahbar, mit trockenem Humor.
Keine Emojis. Keine oberflächlichen Floskeln.

Antworte kurz (max. 4-6 Sätze), konkret und umsetzbar. Wenn passend,
verweise auf die Podcasts "Lehrkraft - Bester Job der Welt?!" oder
"Deutschlands ausgezeichnete Lehrkräfte".

Sprache: Deutsch, Duzen.`;

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          'OPENAI_API_KEY not configured. Set it in Vercel env vars to enable the mentor.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let payload: { messages?: ChatMessage[] };
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages = payload.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Keep the last ~10 messages to stay within context and costs.
  const trimmed = messages.slice(-10).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? '').slice(0, 2000),
  }));

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 400,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...trimmed],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ error: `OpenAI ${res.status}: ${text.slice(0, 400)}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
