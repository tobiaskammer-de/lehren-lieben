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

const URL_RE = 'https?:\\/\\/[^\\s)»"]+';

/**
 * Inline-Verlinkung: rohe URLs (inkl. „?t="-Deeplink zur Minute) und
 * Folgentitel / „Folge #N" werden zu klickbaren Links.
 */
function linkifyInline(text: string, episodes: EpisodeLink[], keyBase: string): ReactNode[] {
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

  // Längste Treffer zuerst, damit Titel nicht von Teilstücken überlagert werden.
  needles.sort((a, b) => b.length - a.length);
  const escaped = needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${[URL_RE, ...escaped].join('|')})`, 'gi');

  return text.split(re).map((part, i) => {
    if (!part) return part;
    if (/^https?:\/\//i.test(part)) {
      // Rohe URL -> kompakter Reinhören-Link (springt bei „?t=" zur Minute).
      const href = part.replace(/[.,;:!?»")]+$/, '');
      const label = /[?&]t=/.test(href) ? '▶ an dieser Stelle anhören' : '▶ zur Folge';
      return (
        <a key={`${keyBase}-${i}`} href={href} target="_blank" rel="noopener noreferrer" className="mentor-link">
          {label}
        </a>
      );
    }
    const url = urlByNeedle.get(part.toLowerCase());
    return url ? (
      <a key={`${keyBase}-${i}`} href={url} target="_blank" rel="noopener noreferrer" className="mentor-link">
        {part}
      </a>
    ) : (
      part
    );
  });
}

/** Inline-Markdown (**fett**, *kursiv*, _kursiv_) plus Links. */
function renderInline(text: string, episodes: EpisodeLink[], keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(...linkifyInline(text.slice(last, m.index), episodes, `${keyBase}-t${i}`));
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{linkifyInline(m[1], episodes, `${keyBase}-b${i}`)}</strong>);
    } else {
      const content = (m[2] ?? m[3]) as string;
      nodes.push(<em key={`${keyBase}-i${i}`}>{linkifyInline(content, episodes, `${keyBase}-i${i}`)}</em>);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(...linkifyInline(text.slice(last), episodes, `${keyBase}-t${i}`));
  return nodes;
}

/**
 * Rendert die Markdown-Antwort des Mentors (Absätze, Überschriften, Listen,
 * Trennlinien, fett/kursiv) — damit keine rohen „**"/„#" mehr stehen bleiben.
 */
function renderMarkdown(text: string, episodes: EpisodeLink[]): ReactNode {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let k = 0;
  const flush = () => {
    if (para.length) {
      blocks.push(
        <p key={`p${k++}`} className="mentor-p">
          {renderInline(para.join(' '), episodes, `p${k}`)}
        </p>,
      );
      para = [];
    }
  };

  for (let i = 0; i < lines.length; ) {
    const t = lines[i].trim();
    if (!t) {
      flush();
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      blocks.push(<hr key={`hr${k++}`} className="mentor-hr" />);
      i++;
      continue;
    }
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      blocks.push(
        <div key={`h${k++}`} className="mentor-h">
          {renderInline(h[1], episodes, `h${k}`)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul${k++}`} className="mentor-ul">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, episodes, `ul${k}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol${k++}`} className="mentor-ol">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, episodes, `ol${k}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    para.push(t);
    i++;
  }
  flush();
  return blocks;
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
        <div className="mentor-tagline">ein Projekt von LehrenLieben</div>
      </div>
      {!fullscreen && (
        <button
          type="button"
          onClick={openFullscreen}
          className="mentor-fs-btn"
          style={{ marginLeft: 'auto' }}
          aria-label="Vollbild öffnen"
          title="Vollbild öffnen"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
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
          {m.role === 'user' ? (
            m.content
          ) : (
            <div className="mentor-md">{renderMarkdown(m.content, episodes)}</div>
          )}
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
      <textarea
        className="chat-input"
        rows={2}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // Enter sendet, Shift+Enter macht eine neue Zeile.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send(input);
          }
        }}
        placeholder="Frag mich etwas..."
        disabled={sending}
        aria-label="Deine Frage an den Lehrkraftmentor"
      />
      <button
        type="submit"
        className="btn btn-amber mentor-send-btn"
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
        <p className="mentor-lead">
          „Stell die Fragen, die du <span className="mentor-lead-em">schon immer</span>{' '}
          stellen wolltest."
        </p>
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
