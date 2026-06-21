// Einfaches Tageslimit pro IP (Schutz vor Missbrauch / Kosten-Explosion).
//
// Serverless-Funktionen teilen keinen Speicher zwischen Aufrufen, daher liegt der
// Zähler in Upstash Redis (kostenlos). Ohne konfiguriertes Upstash läuft die
// Funktion weiter — dann allerdings OHNE Limit (fail-open). Sobald in Vercel die
// Variablen UPSTASH_REDIS_REST_URL und UPSTASH_REDIS_REST_TOKEN gesetzt sind
// (passiert automatisch über die Upstash-Integration), greift das Limit.

import { Redis } from '@upstash/redis';

// Die Vercel-Upstash-Integration legt die Variablen unter KV_*-Namen an;
// direkt bei Upstash heißen sie UPSTASH_*. Beide werden unterstützt.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

let warnedMissing = false;

export type RateResult = { ok: boolean; remaining: number; configured: boolean };

/** Ermittelt die Client-IP aus den Vercel-Proxy-Headern. */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const xff = headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = raw?.split(',')[0]?.trim();
  if (first) return first;
  const real = headers['x-real-ip'];
  return (Array.isArray(real) ? real[0] : real) || 'unknown';
}

/**
 * Zählt die Anfrage dieser IP für den heutigen (UTC-)Tag hoch.
 * Gibt ok=false zurück, sobald das Limit überschritten ist.
 */
export async function checkRateLimit(ip: string, limit: number): Promise<RateResult> {
  if (!redis) {
    if (!warnedMissing) {
      console.warn('Rate-Limit inaktiv: weder UPSTASH_* noch KV_REST_API_* gesetzt (fail-open).');
      warnedMissing = true;
    }
    return { ok: true, remaining: limit, configured: false };
  }

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = `rl:${ip}:${day}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // Schlüssel nach ~25 h verfallen lassen (räumt alte Tage auf).
      await redis.expire(key, 90_000);
    }
    return { ok: count <= limit, remaining: Math.max(0, limit - count), configured: true };
  } catch (err) {
    // Speicher nicht erreichbar → Chat nicht blockieren (Limit ist Kostenschutz, keine Auth).
    console.warn('Rate-Limit-Prüfung fehlgeschlagen (fail-open):', err);
    return { ok: true, remaining: limit, configured: true };
  }
}
