// Wiedergabe-Kern: besitzt das eine <audio>-Element der Seite und den Zustand.
// Framework-frei, damit Klicks auch vor dem Hydrieren der React-Oberfläche
// greifen. Die UI liest den Zustand über subscribe()/getState().

import { catalog, type CatalogEpisode } from './catalog';

export type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type PlayerState = {
  ep: CatalogEpisode | null;
  status: Status;
  time: number;
  duration: number;
  buffered: number;
  rate: number;
  expanded: boolean;
};

export type Progress = { t: number; d: number; done?: boolean };
type Persisted = { last: string | null; rate: number; progress: Record<string, Progress> };

export const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];
export const BACK = 15;
export const FORWARD = 30;

const KEY = 'll.player.v1';
/** Ab diesem Anteil gilt eine Folge als gehört. */
const DONE_RATIO = 0.97;

const IDLE: PlayerState = {
  ep: null,
  status: 'idle',
  time: 0,
  duration: 0,
  buffered: 0,
  rate: 1,
  expanded: false,
};

/* ── Persistenz ─────────────────────────────────────────────── */

let persisted: Persisted | null = null;

function P(): Persisted {
  if (persisted) return persisted;
  persisted = { last: null, rate: 1, progress: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      persisted = {
        last: typeof p.last === 'string' ? p.last : null,
        rate: RATES.includes(p.rate) ? p.rate : 1,
        progress: p.progress && typeof p.progress === 'object' ? p.progress : {},
      };
    }
  } catch {
    /* privater Modus / blockiert — dann eben ohne Gedächtnis */
  }
  return persisted;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(P()));
  } catch {
    /* ignorieren */
  }
}

export function getProgress(id: string): Progress | undefined {
  return P().progress[id];
}

/* ── Zustand ────────────────────────────────────────────────── */

let state: PlayerState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getState = () => state;
export const getServerState = () => IDLE;

/* ── Audio ──────────────────────────────────────────────────── */

let audio: HTMLAudioElement | null = null;
let attachedId: string | null = null;
let pendingSeek: number | null = null;
/** Während eines Quellwechsels feuert das alte Element noch "pause" — ignorieren. */
let switching = false;
let lastSave = 0;
let lastPositionSync = 0;

const finite = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);

function media(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'none';

  a.addEventListener('loadstart', () => {
    switching = false;
  });
  a.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) {
      try {
        a.currentTime = pendingSeek;
      } catch {
        /* Browser ohne Seek vor dem Puffern */
      }
      pendingSeek = null;
    }
    a.playbackRate = a.defaultPlaybackRate = state.rate;
    set({ duration: finite(a.duration, state.duration) });
  });
  a.addEventListener('durationchange', () => set({ duration: finite(a.duration, state.duration) }));
  a.addEventListener('playing', () => {
    set({ status: 'playing' });
    sessionState('playing');
  });
  a.addEventListener('waiting', () => {
    if (!a.paused) set({ status: 'loading' });
  });
  a.addEventListener('pause', () => {
    if (switching) return;
    if (state.status !== 'error') set({ status: 'paused' });
    saveProgress(true);
    sessionState('paused');
  });
  a.addEventListener('timeupdate', () => {
    if (pendingSeek !== null || attachedId !== state.ep?.id) return;
    set({ time: a.currentTime });
    saveProgress(false);
    positionState(false);
  });
  a.addEventListener('progress', () => {
    const b = a.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= a.currentTime + 1) end = Math.max(end, b.end(i));
    }
    set({ buffered: end });
  });
  a.addEventListener('ended', () => {
    markDone();
    set({ status: 'paused', time: 0 });
  });
  a.addEventListener('error', () => {
    if (attachedId && !switching) set({ status: 'error' });
  });

  audio = a;
  return a;
}

function saveProgress(force: boolean) {
  const ep = state.ep;
  const a = audio;
  if (!ep || !a || attachedId !== ep.id) return;
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;

  const d = finite(a.duration, ep.dur);
  const t = a.currentTime;
  const p = P();
  const prev = p.progress[ep.id];
  if (t < 1 && !prev) return;
  const done = Boolean(prev?.done) || (d > 0 && t / d >= DONE_RATIO);
  p.progress[ep.id] = { t: Math.floor(t), d: Math.round(d), ...(done ? { done: true } : {}) };
  p.last = ep.id;
  write();
}

function markDone() {
  const ep = state.ep;
  if (!ep) return;
  const p = P();
  p.progress[ep.id] = { t: 0, d: Math.round(finite(audio?.duration ?? 0, ep.dur)), done: true };
  write();
}

function attachAndPlay(start: number) {
  const ep = state.ep;
  if (!ep) return;
  const a = media();
  if (attachedId !== ep.id) {
    switching = true;
    a.pause();
    a.preload = 'auto';
    a.src = ep.audio;
    attachedId = ep.id;
    pendingSeek = start > 0.5 ? start : null;
  }
  a.playbackRate = a.defaultPlaybackRate = state.rate;
  set({ status: 'loading' });
  sessionMeta(ep);
  a.play()?.catch((err: DOMException) => {
    if (err?.name === 'AbortError') return;
    set({ status: err?.name === 'NotAllowedError' ? 'paused' : 'error' });
  });
}

function open(ep: CatalogEpisode, at?: number) {
  if (state.ep && state.ep.id !== ep.id) saveProgress(true);
  const saved = P().progress[ep.id];
  const start = at ?? (saved && !saved.done ? saved.t : 0);
  set({
    ep,
    status: 'loading',
    time: start,
    duration: ep.dur || saved?.d || 0,
    buffered: 0,
  });
  P().last = ep.id;
  write();
  attachAndPlay(start);
}

function resume() {
  const ep = state.ep;
  if (!ep) return;
  if (attachedId !== ep.id || state.status === 'error') {
    attachedId = null;
    attachAndPlay(state.time);
    return;
  }
  set({ status: 'loading' });
  media()
    .play()
    ?.catch((err: DOMException) => {
      if (err?.name !== 'AbortError') set({ status: 'paused' });
    });
}

/* ── Öffentliche Aktionen ───────────────────────────────────── */

/** Play/Pause. Mit id einer anderen Folge: diese Folge starten. */
export function toggle(id?: string) {
  init();
  if (id && id !== state.ep?.id) {
    const ep = catalog().byId.get(id);
    if (ep?.audio) open(ep);
    return;
  }
  if (!state.ep) return;
  const a = audio;
  if (!a || attachedId !== state.ep.id || a.paused || state.status === 'error') resume();
  else a.pause();
}

/** Folge abspielen, optional ab Sekunde `at` (z. B. aus einem Mentor-Link). */
export function play(id: string, at?: number) {
  init();
  const ep = catalog().byId.get(id);
  if (!ep?.audio) return;
  if (state.ep?.id !== id) {
    open(ep, at);
    return;
  }
  if (at !== undefined) seek(at);
  if (!audio || attachedId !== id || audio.paused) resume();
}

export function seek(t: number) {
  const ep = state.ep;
  if (!ep) return;
  const d = state.duration || ep.dur;
  const target = Math.max(0, d ? Math.min(t, d - 0.5) : t);
  if (audio && attachedId === ep.id) {
    if (audio.readyState >= 1) audio.currentTime = target;
    else pendingSeek = target;
  } else {
    // Wiederhergestellte, noch nicht geladene Folge: Position merken.
    const p = P();
    p.progress[ep.id] = { ...p.progress[ep.id], t: Math.floor(target), d: Math.round(d) };
    write();
  }
  set({ time: target });
  positionState(true);
}

export const skip = (dt: number) => seek(state.time + dt);

export function setRate(rate: number) {
  set({ rate });
  if (audio) audio.playbackRate = audio.defaultPlaybackRate = rate;
  P().rate = rate;
  write();
}

export function cycleRate() {
  const i = RATES.indexOf(state.rate);
  setRate(RATES[(i + 1) % RATES.length]);
}

export function setExpanded(expanded: boolean) {
  if (state.ep) set({ expanded });
}

export function retry() {
  if (!state.ep) return;
  attachedId = null;
  attachAndPlay(state.time);
}

export function close() {
  saveProgress(true);
  if (audio) {
    switching = true;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  attachedId = null;
  pendingSeek = null;
  P().last = null;
  write();
  set({ ...IDLE, rate: state.rate });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}

/* ── Start: zuletzt gehörte Folge wiederherstellen ──────────── */

let inited = false;

export function init() {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  const p = P();
  let restored: Partial<PlayerState> = {};
  if (p.last) {
    const ep = catalog().byId.get(p.last);
    const prog = p.progress[p.last];
    if (ep?.audio && prog && !prog.done && prog.t > 0) {
      restored = { ep, status: 'paused', time: prog.t, duration: prog.d || ep.dur };
    }
  }
  set({ rate: p.rate, ...restored });
  window.addEventListener('pagehide', () => saveProgress(true));
}

/* ── Sperrbildschirm / Medientasten ─────────────────────────── */

let handlersSet = false;

function sessionMeta(ep: CatalogEpisode) {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      title: ep.title,
      artist: ep.show,
      album: 'Lehren Lieben.',
      artwork: ep.image ? [{ src: new URL(ep.image, window.location.href).href, sizes: '400x400' }] : [],
    });
  } catch {
    /* ältere Browser */
  }
  if (handlersSet) return;
  handlersSet = true;
  const on = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* Aktion nicht unterstützt */
    }
  };
  on('play', () => resume());
  on('pause', () => audio?.pause());
  on('stop', () => audio?.pause());
  on('seekbackward', (d) => skip(-(d.seekOffset || BACK)));
  on('seekforward', (d) => skip(d.seekOffset || FORWARD));
  on('seekto', (d) => {
    if (d.seekTime != null) seek(d.seekTime);
  });
}

function sessionState(s: MediaSessionPlaybackState) {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s;
}

function positionState(force: boolean) {
  if (!audio || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const now = Date.now();
  if (!force && now - lastPositionSync < 1000) return;
  lastPositionSync = now;
  const d = finite(audio.duration, 0);
  if (!d) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: audio.playbackRate,
      position: Math.min(audio.currentTime, d),
    });
  } catch {
    /* ungültige Werte während des Ladens */
  }
}
