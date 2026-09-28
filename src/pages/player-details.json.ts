// Ausführliche Folgenbeschreibungen für den Player ("Über die Folge").
// Wird beim Build als statische Datei erzeugt und erst beim Aufklappen geladen,
// damit nicht jede Seite ~80 KB Text mitschleppt.
import type { APIRoute } from 'astro';
import { episodes } from '~/data/episodes';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(Object.fromEntries(episodes.map((e) => [e.id, e.summary]))), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
