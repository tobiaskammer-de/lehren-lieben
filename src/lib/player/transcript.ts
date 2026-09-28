// Podigee-Transkripte (JSON mit Zeitstempeln) für "Mitlesen".

export type Segment = { start: number; end: number; text: string };

const cache = new Map<string, Promise<Segment[]>>();

function normalize(raw: unknown): Segment[] {
  // Podigee liefert ein Array; der Podcasting-2.0-Standard ein { segments: [] }.
  const list: any[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).segments)
      ? (raw as any).segments
      : [];
  return list
    .map((s) => ({
      start: Number(s.start ?? s.startTime),
      end: Number(s.end ?? s.endTime),
      text: String(s.text ?? s.body ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => Number.isFinite(s.start) && s.text)
    .sort((a, b) => a.start - b.start);
}

export function loadTranscript(url: string): Promise<Segment[]> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Transkript HTTP ${r.status}`);
        return r.json();
      })
      .then(normalize);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Index des Satzes, der zur Zeit t läuft (letzter Satz mit start ≤ t), sonst -1. */
export function segmentAt(segs: Segment[], t: number): number {
  let lo = 0;
  let hi = segs.length - 1;
  let found = -1;
  const x = t + 0.15;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= x) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
