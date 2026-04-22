import { useEffect, useRef, useState } from 'react';

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };

const SUGGESTIONS = [
  'Wie kann ich einen guten Draht zu meiner Klasse aufbauen?',
  'Welche Unterrichtsrituale sind sinnvoll?',
  'Welche Fortbildungen sind zu empfehlen?',
  'Wie beugen Preisträger Burnout vor?',
];

const INITIAL_MESSAGES: Message[] = [
  { role: 'assistant', content: 'Hallo! Wie kann ich dir heute helfen?' },
];

export default function LehrkraftmentorChat() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setError(null);
    const next: Message[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { reply: string };
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(msg);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            'Hm, gerade klappt der Draht zum Mentor nicht. Versuch es gleich nochmal oder öffne den Vollbild-Mentor über den Button oben rechts.',
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleChipClick(text: string) {
    setInput(text);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="mentor-layout">
      <div className="reveal">
        <span className="eyebrow amber">KI-gestütztes Tool</span>
        <h2 className="s-title" style={{ marginTop: 12 }}>
          Der<br />Lehrkräftementor
        </h2>
        <p className="s-sub">
          Auf Basis der Transkripte aller Podcastfolgen ist ein KI-Mentor
          entstanden. Die Antworten stammen aus dem geballten Wissen der
          Preisträgerinnen und weiterer vorbildlicher Lehrkräfte. Und mit jeder
          neuen Folge wächst sein Wissen.
        </p>
        <div className="mentor-chips">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="mentor-chip"
              onClick={() => handleChipClick(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mentor-frame reveal reveal-d1">
        <div className="mentor-hd">
          <div className="mentor-icon">L</div>
          <div>
            <div className="mentor-name">Lehrkräftementor</div>
            <div className="mentor-tagline">
              Powered by ChatGPT · basiert auf echten Podcastgesprächen
            </div>
          </div>
          <a
            href="https://gemini.google.com/gem/1CAzvlRUi0MIu5oh-AW66edGvG49J7KfB?usp=sharing"
            target="_blank"
            rel="noopener"
            className="btn btn-soft"
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              padding: '8px 16px',
              borderRadius: 100,
            }}
          >
            Vollbild
          </a>
        </div>

        <div className="chat-body" ref={bodyRef} aria-live="polite">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`bubble ${m.role === 'user' ? 'bubble-user' : 'bubble-bot'}`}
            >
              {m.content}
            </div>
          ))}
          {sending && (
            <div className="bubble bubble-bot">
              <span className="bubble-typing" aria-label="Mentor tippt">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          )}
        </div>

        <form className="chat-input-row" onSubmit={handleSubmit}>
          <input
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Frag mich etwas..."
            disabled={sending}
            aria-label="Deine Frage an den Lehrkräftementor"
          />
          <button
            type="submit"
            className="btn btn-amber"
            style={{ fontSize: 13, padding: '11px 20px' }}
            disabled={sending || !input.trim()}
          >
            {sending ? '…' : 'Senden'}
          </button>
        </form>

        <div className="mentor-note">
          {error
            ? 'Hinweis: Backend nicht erreichbar — läuft vermutlich nur auf Vercel.'
            : (
              <>
                Direkt zum Mentor:{' '}
                <a
                  href="https://gemini.google.com/gem/1CAzvlRUi0MIu5oh-AW66edGvG49J7KfB?usp=sharing"
                  target="_blank"
                  rel="noopener"
                >
                  Vollbild öffnen
                </a>
              </>
            )}
        </div>
      </div>
    </div>
  );
}
