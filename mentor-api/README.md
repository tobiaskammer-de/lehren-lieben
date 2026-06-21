# Lehrkraftmentor – API-Funktion

Kleine, eigenständige Serverless-Funktion für den Chat auf lehrenlieben.de.
Die Hauptseite bleibt unverändert auf **GitHub Pages**; nur diese Funktion läuft
separat auf **Vercel** und wird vom Chat-Widget per fester URL aufgerufen (CORS).

## Was sie tut

`POST /api/chat` mit `{ "messages": [{ "role": "user", "content": "..." }] }`
→ antwortet mit `{ "reply": "..." }`.

1. Findet die relevantesten Transkript-Häppchen zur Frage (`corpus.json`, Cosine-Suche).
2. Schickt sie zusammen mit dem Mentor-Prompt an **Claude Sonnet 4.6**.
3. Solange `corpus.json` leer ist, antwortet der Mentor ohne Transkript-Suche
   (nur auf Basis des Prompts) — funktioniert also schon vor der „Datenbank".

## Dateien

- `api/chat.ts` – die Funktion (RAG + Claude + CORS)
- `prompt.ts` – **Platzhalter-Prompt** (später durch den finalen ersetzen)
- `corpus.json` – die „Datenbank" (Vektoren). Wird von `../scripts/build-corpus.ts` erzeugt.
- `lib/rag.ts` – Embedding der Frage + Ähnlichkeitssuche

## Deployment auf Vercel (einmalig)

1. Auf [vercel.com](https://vercel.com) einloggen → **Add New… → Project** → dieses GitHub-Repo importieren.
2. **Root Directory** auf `mentor-api` setzen (wichtig — nicht das Repo-Root!).
3. Unter **Environment Variables** eintragen:
   - `ANTHROPIC_API_KEY` (Pflicht)
   - `OPENAI_API_KEY` (sobald die Transkript-Suche genutzt wird)
4. **Missbrauchsschutz aktivieren (empfohlen):** im Vercel-Projekt unter **Storage**
   eine **Upstash Redis**-Datenbank hinzufügen (kostenloser Free-Tier). Vercel setzt
   dann automatisch `UPSTASH_REDIS_REST_URL` und `UPSTASH_REDIS_REST_TOKEN`. Damit
   greift das Limit von **20 Anfragen pro IP und Tag** (in `api/chat.ts` als
   `DAILY_LIMIT` einstellbar). Ohne Upstash läuft der Chat ohne Limit.
5. **Deploy**. Vercel liefert eine URL wie `https://<projekt>.vercel.app`.
   Die Funktion ist dann unter `https://<projekt>.vercel.app/api/chat` erreichbar.
6. Diese URL als `PUBLIC_MENTOR_API_URL` im Build der Hauptseite hinterlegen
   (siehe Repo-Root `.env.example`), damit das Widget sie aufruft.

Die Hauptseite (GitHub Pages) und das DNS bleiben dabei unangetastet.

## Lokaler Test

```bash
cd mentor-api
npm install
# Funktion lokal: npx vercel dev   (Vercel CLI), dann an http://localhost:3000/api/chat
```
