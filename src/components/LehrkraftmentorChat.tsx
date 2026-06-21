import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { asset } from '../lib/url';

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };
type EpisodeLink = { title: string; ep: string; url: string };
type Props = { fullscreen?: boolean; episodes?: EpisodeLink[] };

const SUGGESTIONS = [
  'Wie kann ich einen guten Draht zu meiner Klasse aufbauen?',
  'Welche Unterrichtsrituale sind sinnvoll?',
  'Welche Fortbildungen sind zu empfehlen?',
  'Wie beugen Preisträger Burnout vor?',
];

const INITIAL_MESSAGES: Message[] = [
  { role: 'assistant', content: 'Hallo! Wie kann ich dir heute helfen?' },
];

/**
 * Wandelt Verweise auf Folgen im Antworttext in klickbare Links um:
 * jeder Folgentitel und jedes "Folge #N", das zu einer echten Folge passt,
 * wird zu einem Link auf die Podigee-Seite der Folge.
 */
function linkifyEpisodes(text: string, episodes: EpisodeLink[]): ReactNode {
  if (!episodes.length) return text;

  const urlByNeedle = new Map<string, string>();
  const needles: string[] = [];
  const add = (needle: string, url: string) => {
    const key = needle.toLowerCase();
    if (needle && url && !urlByNeedle.has(key)) {
      urlByNeedle.set(key, url);
      needles.push(needle);
    }
  };

  for (const e of episodes) {
    if (!e.url) continue;
    if (e.title && e.title.length >= 6) add(e.title, e.url);
    if (e.ep) {
      const num = e.ep.replace(/^#/, '');
      add(`Folge ${e.ep}`, e.url);
      add(`Folge ${num}`, e.url);
    }
  }
  if (!needles.length) return text;

  // Längste Treffer zuerst, damit Titel nicht von Teilstücken überlagert werden.
  needles.sort((a, b) => b.length - a.length);
  const escaped = needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');

  return text.split(re).map((part, i) => {
    const url = urlByNeedle.get(part.toLowerCase());
    return url ? (
      <a
        key={i}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mentor-link"
      >
        {part}
      </a>
    ) : (
      part
    );
  });
}

export default function LehrkraftmentorChat({ fullscreen = false, episodes = [] }: Props) {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const next: Message[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setSending(true);

    try {
      // Die Chat-Funktion läuft separat (Vercel). URL wird beim Build über
      // PUBLIC_MENTOR_API_URL gesetzt; lokal fällt sie auf /api/chat zurück.
      const endpoint = import.meta.env.PUBLIC_MENTOR_API_URL || '/api/chat';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok) {
        let serverMsg = '';
        try {
          serverMsg = ((await res.json()) as { error?: string }).error || '';
        } catch {
          /* kein JSON-Body */
        }
        if (res.status === 429) {
          // Tageslimit erreicht — freundlich anzeigen, kein "Fehler".
          setMessages((m) => [
            ...m,
            {
              role: 'assistant',
              content:
                serverMsg ||
                'Du hast das heutige Fragenlimit erreicht. Schau morgen gern wieder vorbei!',
            },
          ]);
          return;
        }
        throw new Error(serverMsg || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { reply: string };
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: 'Hm, gerade klappt der Draht zum Mentor nicht. Versuch es bitte gleich nochmal.',
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  // Öffnet denselben Chat in einem etwas größeren Popup-Fenster.
  function openFullscreen() {
    const base = import.meta.env.BASE_URL || '/';
    const url = (base.endsWith('/') ? base : base + '/') + 'mentor';
    window.open(
      url,
      'lehrkraftmentor',
      'popup=yes,width=460,height=820,resizable=yes,scrollbars=yes',
    );
  }

  const header = (
    <div className="mentor-hd">
      <img className="mentor-logo" src={asset('uploads/Transparent Logo.png')} alt="Lehren Lieben" />
      <div>
        <div className="mentor-name">Lehrkraftmentor</div>
        <div className="mentor-tagline">
          Powered by Claude · basiert auf echten Podcastgesprächen
        </div>
      </div>
      {!fullscreen && (
        <button
          type="button"
          onClick={openFullscreen}
          className="btn btn-soft"
          style={{ marginLeft: 'auto', fontSize: 11, padding: '8px 16px', borderRadius: 100 }}
        >
          Vollbild
        </button>
      )}
    </div>
  );

  const body = (
    <div
      className={`chat-body${fullscreen ? ' chat-body--full' : ''}`}
      ref={bodyRef}
      aria-live="polite"
    >
      {messages.map((m, i) => (
        <div
          key={i}
          className={`bubble ${m.role === 'user' ? 'bubble-user' : 'bubble-bot'}`}
        >
          {m.role === 'user' ? m.content : linkifyEpisodes(m.content, episodes)}
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
  );

  const form = (
    <form className="chat-input-row" onSubmit={handleSubmit}>
      <input
        className="chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Frag mich etwas..."
        disabled={sending}
        aria-label="Deine Frage an den Lehrkraftmentor"
      />
      <button
        type="submit"
        className="btn btn-amber"
        style={{ fontSize: 13, padding: '11px 20px' }}
        disabled={sending || !input.trim()}
      >
        {sending ? '…' : "Los geht's"}
      </button>
    </form>
  );

  // Vollbild-Popup: nur der Chat-Frame, fülle das Fenster.
  if (fullscreen) {
    return (
      <div className="mentor-frame mentor-frame--full">
        {header}
        {body}
        {form}
      </div>
    );
  }

  return (
    <div className="mentor-layout">
      <div className="reveal">
        <span className="eyebrow amber">KI-gestütztes Tool</span>
        <h2 className="s-title" style={{ marginTop: 12 }}>
          Der<br />Lehrkraftmentor
        </h2>
        <p className="s-sub">
          Auf Basis der Transkripte aller Podcastfolgen ist ein KI-Mentor entstanden. Die
          Antworten stammen aus dem geballten Wissen der Preisträgerinnen und weiterer
          vorbildlicher Lehrkräfte. Und mit jeder neuen Folge wächst sein Wissen.
        </p>
        <div className="mentor-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="mentor-chip" onClick={() => setInput(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mentor-frame reveal reveal-d1">
        {header}
        {body}
        {form}
      </div>
    </div>
  );
}
