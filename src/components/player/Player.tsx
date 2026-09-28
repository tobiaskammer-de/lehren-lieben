import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  BACK,
  FORWARD,
  close,
  cycleRate,
  getServerState,
  getState,
  init,
  retry,
  seek,
  setExpanded,
  skip,
  subscribe,
  toggle,
  type PlayerState,
  type Status,
} from '~/lib/player/store';
import { loadTranscript, segmentAt, type Segment } from '~/lib/player/transcript';
import type { CatalogEpisode } from '~/lib/player/catalog';
import { asset } from '~/lib/url';

/* ── Formatierung ───────────────────────────────────────────── */

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function spoken(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${h === 1 ? 'Stunde' : 'Stunden'}`);
  if (h || m) parts.push(`${m} ${m === 1 ? 'Minute' : 'Minuten'}`);
  parts.push(`${r} ${r === 1 ? 'Sekunde' : 'Sekunden'}`);
  return parts.join(' ');
}

const rateLabel = (r: number) => `${String(r).replace('.', ',')}×`;
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Icons ──────────────────────────────────────────────────── */

function Svg({ children, className }: { children: ReactNode; className: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      {children}
    </svg>
  );
}

const IconPlay = () => (
  <Svg className="i-fill">
    <path d="M8.5 5.9v12.2c0 .8.9 1.3 1.6.9l9.3-6.1a1 1 0 0 0 0-1.7L10.1 5c-.7-.4-1.6.1-1.6.9z" />
  </Svg>
);
const IconPause = () => (
  <Svg className="i-fill">
    <rect x="6.2" y="5" width="4.2" height="14" rx="1.3" />
    <rect x="13.6" y="5" width="4.2" height="14" rx="1.3" />
  </Svg>
);
const IconBack = () => (
  <Svg className="i-line">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.4" />
    <path d="M3.5 3.6v4.8h4.8" />
    <text x="12.6" y="15.4" textAnchor="middle" className="i-num">
      {BACK}
    </text>
  </Svg>
);
const IconForward = () => (
  <Svg className="i-line">
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.5" />
    <path d="M20.5 3.6v4.8h-4.8" />
    <text x="11.4" y="15.4" textAnchor="middle" className="i-num">
      {FORWARD}
    </text>
  </Svg>
);
const IconRetry = () => (
  <Svg className="i-line">
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.5" />
    <path d="M20.5 3.6v4.8h-4.8" />
  </Svg>
);
const IconUp = () => (
  <Svg className="i-line">
    <path d="m6 15 6-6 6 6" />
  </Svg>
);
const IconDown = () => (
  <Svg className="i-line">
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
const IconClose = () => (
  <Svg className="i-line">
    <path d="M17 7 7 17M7 7l10 10" />
  </Svg>
);

/* ── Bausteine ──────────────────────────────────────────────── */

function PlayToggle({ status, size }: { status: Status; size: 'md' | 'lg' }) {
  const busy = status === 'playing' || status === 'loading';
  const label = status === 'error' ? 'Erneut versuchen' : busy ? 'Pause' : 'Abspielen';
  return (
    <button
      type="button"
      className={`pl-play pl-play--${size}`}
      data-status={status}
      aria-label={label}
      onClick={() => (status === 'error' ? retry() : toggle())}
    >
      {status === 'loading' ? (
        <span className="pl-spin" aria-hidden="true" />
      ) : status === 'error' ? (
        <IconRetry />
      ) : busy ? (
        <IconPause />
      ) : (
        <IconPlay />
      )}
    </button>
  );
}

function Scrubber({
  time,
  duration,
  buffered,
  variant,
}: {
  time: number;
  duration: number;
  buffered: number;
  variant: 'dock' | 'sheet';
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const d = duration || 0;
  const shown = drag ?? time;
  const pct = (v: number) => (d ? Math.min(100, Math.max(0, (v / d) * 100)) : 0);

  const at = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d));
  };

  const keys: Record<string, number> = {
    ArrowLeft: -5,
    ArrowDown: -5,
    ArrowRight: 5,
    ArrowUp: 5,
    PageDown: -60,
    PageUp: 60,
  };

  const tip = drag ?? hover;

  return (
    <div className={`pl-scrub pl-scrub--${variant}`}>
      <span className="pl-time">{clock(shown)}</span>
      <div
        ref={trackRef}
        className={`pl-slider${drag !== null ? ' is-drag' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="Position in der Folge"
        aria-valuemin={0}
        aria-valuemax={Math.round(d)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${spoken(shown)} von ${spoken(d)}`}
        onPointerDown={(e) => {
          if (!d) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(at(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!d) return;
          if (drag !== null) setDrag(at(e.clientX));
          else if (e.pointerType === 'mouse') setHover(at(e.clientX));
        }}
        onPointerUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key in keys) {
            e.preventDefault();
            seek(time + keys[e.key]);
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            seek(e.key === 'Home' ? 0 : d);
          }
        }}
      >
        <div className="pl-track">
          <div className="pl-buffered" style={{ width: `${pct(buffered)}%` }} />
          <div className="pl-fill" style={{ width: `${pct(shown)}%` }} />
        </div>
        <div className="pl-thumb" style={{ left: `${pct(shown)}%` }} />
        {tip !== null && (
          <span className="pl-tip" style={{ left: `clamp(22px, ${pct(tip)}%, calc(100% - 22px))` }}>
            {clock(tip)}
          </span>
        )}
      </div>
      <span className="pl-time pl-time--left">−{clock(Math.max(0, d - shown))}</span>
    </div>
  );
}

/* ── Mitlesen ───────────────────────────────────────────────── */

type TextState = 'idle' | 'loading' | 'ready' | 'error';

// Die Liste rendert nur einmal pro Transkript; der aktuelle Satz wird per
// Klasse markiert, damit timeupdate nicht hunderte Zeilen neu zeichnet.
const Lines = memo(function Lines({
  segs,
  onPick,
}: {
  segs: Segment[];
  onPick: (t: number) => void;
}) {
  return (
    <ol className="pl-lines">
      {segs.map((sg, i) => (
        <li key={i} data-i={i}>
          <button type="button" onClick={() => onPick(sg.start)}>
            {sg.text}
          </button>
        </li>
      ))}
    </ol>
  );
});

function Transcript({ segs, state, idx }: { segs: Segment[] | null; state: TextState; idx: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const first = useRef(true);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !segs) return;
    box.querySelector('.is-now')?.classList.remove('is-now');
    box.classList.toggle('no-now', idx < 0);
    if (idx < 0) return;
    const li = box.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    if (!li) return;
    li.classList.add('is-now');
    if (follow) {
      box.scrollTo({
        top: li.offsetTop - box.clientHeight / 2 + li.offsetHeight / 2,
        behavior: first.current || prefersReducedMotion() ? 'auto' : 'smooth',
      });
      first.current = false;
    }
  }, [idx, segs, follow]);

  const pick = useCallback((t: number) => {
    seek(t);
    setFollow(true);
    const { status } = getState();
    if (status !== 'playing' && status !== 'loading') toggle();
  }, []);

  if (state === 'error') {
    return (
      <p className="pl-note">
        Das Transkript lässt sich gerade nicht laden. Unter „Über die Folge" steht die Beschreibung.
      </p>
    );
  }
  if (!segs) return <p className="pl-note">Transkript wird geladen …</p>;

  const stopFollowing = () => setFollow(false);
  return (
    <div className="pl-read-wrap">
      <div
        className="pl-read"
        ref={boxRef}
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onKeyDown={(e) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) stopFollowing();
        }}
      >
        <Lines segs={segs} onPick={pick} />
      </div>
      {!follow && (
        <button type="button" className="pl-follow" onClick={() => setFollow(true)}>
          Zur aktuellen Stelle
        </button>
      )}
    </div>
  );
}

/* ── Über die Folge ─────────────────────────────────────────── */

let detailsPromise: Promise<Record<string, string>> | null = null;

function loadDetails(): Promise<Record<string, string>> {
  detailsPromise ??= fetch(asset('player-details.json'))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => {
      detailsPromise = null;
      return {};
    });
  return detailsPromise;
}

function withLinks(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      // data-play-link: zeigt der Link auf eine Folge, spielt der Player sie direkt ab.
      <a key={i} href={part} target="_blank" rel="noopener" data-play-link>
        {part.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
    ) : (
      part
    ),
  );
}

function About({ ep }: { ep: CatalogEpisode }) {
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSummary(null);
    loadDetails().then((m) => {
      if (alive) setSummary(m[ep.id] || ep.desc);
    });
    return () => {
      alive = false;
    };
  }, [ep.id, ep.desc]);

  return (
    <div className="pl-about">
      {(summary ?? ep.desc)
        .split('\n')
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{withLinks(p)}</p>
        ))}
    </div>
  );
}

/* ── Mini-Player ────────────────────────────────────────────── */

function Dock({ s, caption, captionKey }: { s: PlayerState; caption: string | null; captionKey: number }) {
  const ep = s.ep!;
  const sub = s.status === 'error' ? 'Die Folge lässt sich gerade nicht laden.' : caption ?? ep.show;
  return (
    <div
      className={`pl-dock${s.expanded ? ' pl-dock--under' : ''}`}
      role="region"
      aria-label="Podcast-Player"
      inert={s.expanded}
    >
      <button
        type="button"
        className="pl-dock-main"
        onClick={() => setExpanded(true)}
        aria-label={`Player öffnen: ${ep.title}`}
      >
        <img className="pl-art" src={ep.image} alt="" width={44} height={44} />
        <span className="pl-dock-text">
          <span className="pl-dock-title">{ep.title}</span>
          <span className={`pl-dock-sub${caption ? ' is-live' : ''}`} key={captionKey}>
            {sub}
          </span>
        </span>
      </button>
      <div className="pl-dock-controls">
        <button type="button" className="pl-ic pl-skip" onClick={() => skip(-BACK)} aria-label={`${BACK} Sekunden zurück`}>
          <IconBack />
        </button>
        <PlayToggle status={s.status} size="md" />
        <button type="button" className="pl-ic pl-skip" onClick={() => skip(FORWARD)} aria-label={`${FORWARD} Sekunden vor`}>
          <IconForward />
        </button>
        <button type="button" className="pl-rate" onClick={cycleRate} aria-label={`Wiedergabetempo ${rateLabel(s.rate)}`}>
          {rateLabel(s.rate)}
        </button>
        <button type="button" className="pl-ic pl-open" onClick={() => setExpanded(true)} aria-label="Player öffnen">
          <IconUp />
        </button>
        <button type="button" className="pl-ic pl-x" onClick={close} aria-label="Player schließen">
          <IconClose />
        </button>
      </div>
      <Scrubber time={s.time} duration={s.duration} buffered={s.buffered} variant="dock" />
    </div>
  );
}

/* ── Ausgeklappter Player ───────────────────────────────────── */

function Sheet({
  s,
  segs,
  textState,
  idx,
}: {
  s: PlayerState;
  segs: Segment[] | null;
  textState: TextState;
  idx: number;
}) {
  const ep = s.ep!;
  const hasText = Boolean(ep.transcript);
  const [tab, setTab] = useState<'read' | 'about'>(hasText ? 'read' : 'about');
  const collapseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setTab(ep.transcript ? 'read' : 'about'), [ep.id, ep.transcript]);
  useEffect(() => collapseRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const minutes = Math.max(1, Math.round((s.duration || ep.dur) / 60));

  return (
    <div className="pl-sheet" role="dialog" aria-modal="true" aria-labelledby="pl-sheet-title">
      <div className="pl-sheet-head">
        <img className="pl-art pl-art--lg" src={ep.image} alt="" width={96} height={96} />
        <div className="pl-sheet-meta">
          <p className="pl-sheet-show">{ep.show}</p>
          <h2 className="pl-sheet-title" id="pl-sheet-title">
            {ep.title}
          </h2>
          <p className="pl-sheet-facts">
            {ep.ep && <span>Folge {ep.ep.replace('#', '')}</span>}
            <span>{minutes} Minuten</span>
            <span>{dateFmt.format(new Date(ep.date))}</span>
          </p>
        </div>
        <div className="pl-sheet-actions">
          <button ref={collapseRef} type="button" className="pl-ic" onClick={() => setExpanded(false)} aria-label="Player einklappen">
            <IconDown />
          </button>
          <button type="button" className="pl-ic" onClick={close} aria-label="Player schließen">
            <IconClose />
          </button>
        </div>
      </div>

      {hasText && (
        <div className="pl-tabs" role="tablist" aria-label="Ansicht">
          <button type="button" role="tab" aria-selected={tab === 'read'} aria-controls="pl-panel" onClick={() => setTab('read')}>
            Mitlesen
          </button>
          <button type="button" role="tab" aria-selected={tab === 'about'} aria-controls="pl-panel" onClick={() => setTab('about')}>
            Über die Folge
          </button>
        </div>
      )}

      <div className="pl-sheet-body" id="pl-panel" role={hasText ? 'tabpanel' : undefined}>
        {tab === 'read' ? <Transcript segs={segs} state={textState} idx={idx} /> : <About ep={ep} />}
      </div>

      <div className="pl-sheet-foot">
        <Scrubber time={s.time} duration={s.duration} buffered={s.buffered} variant="sheet" />
        <div className="pl-sheet-controls">
          <button type="button" className="pl-rate" onClick={cycleRate} aria-label={`Wiedergabetempo ${rateLabel(s.rate)}`}>
            {rateLabel(s.rate)}
          </button>
          <div className="pl-transport">
            <button type="button" className="pl-ic pl-ic--lg" onClick={() => skip(-BACK)} aria-label={`${BACK} Sekunden zurück`}>
              <IconBack />
            </button>
            <PlayToggle status={s.status} size="lg" />
            <button type="button" className="pl-ic pl-ic--lg" onClick={() => skip(FORWARD)} aria-label={`${FORWARD} Sekunden vor`}>
              <IconForward />
            </button>
          </div>
          <a className="pl-shownotes" href={ep.url} target="_blank" rel="noopener">
            Shownotes
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Wurzel ─────────────────────────────────────────────────── */

export default function Player() {
  const s = useSyncExternalStore(subscribe, getState, getServerState);
  const ep = s.ep;
  const transcriptUrl = ep?.transcript ?? '';
  const wantText = Boolean(transcriptUrl) && (s.expanded || s.status === 'playing' || s.status === 'loading');

  const [segs, setSegs] = useState<Segment[] | null>(null);
  const [textState, setTextState] = useState<TextState>('idle');

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    setSegs(null);
    setTextState('idle');
  }, [transcriptUrl]);

  useEffect(() => {
    if (!wantText) return;
    let alive = true;
    loadTranscript(transcriptUrl).then(
      (list) => {
        if (!alive) return;
        setSegs(list);
        setTextState('ready');
      },
      () => {
        if (alive) setTextState('error');
      },
    );
    return () => {
      alive = false;
    };
  }, [wantText, transcriptUrl]);

  // Fokus nach dem Einklappen zurück in den Mini-Player.
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (wasExpanded.current && !s.expanded) {
      document.querySelector<HTMLElement>('.pl-dock-main')?.focus();
    }
    wasExpanded.current = s.expanded;
  }, [s.expanded]);

  if (!ep) return null;

  const idx = segs ? segmentAt(segs, s.time) : -1;
  const caption = segs && idx >= 0 ? segs[idx].text : null;

  return (
    <div className={`pl pl--${ep.cls}`}>
      <Dock s={s} caption={caption} captionKey={idx} />
      {s.expanded && (
        <>
          <div className="pl-backdrop" aria-hidden="true" onClick={() => setExpanded(false)} />
          <Sheet s={s} segs={segs} textState={textState} idx={idx} />
        </>
      )}
    </div>
  );
}
